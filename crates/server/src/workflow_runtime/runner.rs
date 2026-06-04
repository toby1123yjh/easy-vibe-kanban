use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use async_trait::async_trait;
use db::models::{
    coding_agent_turn::CodingAgentTurn,
    execution_process::{ExecutionProcess, ExecutionProcessStatus},
    session::{CreateSession, Session},
    workflow::{NodeExecutionStatus as DbNodeExecutionStatus, WorkflowRunStatus},
    workspace::{Workspace, WorkspaceError},
    workspace_repo::{CreateWorkspaceRepo, WorkspaceRepo},
};
use deployment::Deployment;
use executors::profile::{ExecutorConfig, ExecutorConfigs};
use git::GitCli;
use serde_json::{Value, json};
use services::services::container::ContainerService;
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use thiserror::Error;
use tokio::sync::broadcast;
use uuid::Uuid;
use workflow::{
    WorkflowGraph,
    events::WorkflowEvent,
    graph::{WorkflowEdge, WorkflowNode, WorkflowNodeKind},
    handlers::{NodeHandlerContext, NodeHandlerStatus, UpstreamOutput, handle_pure_node},
    planner::{
        NodeExecutionSnapshot, NodeExecutionStatus as PlannerNodeExecutionStatus, RunSnapshot,
    },
    runner::WorkflowRunner,
    validation::validate_graph_for_run,
};

use crate::{
    DeploymentImpl,
    error::ApiError,
    routes::{
        sessions::start_coding_agent_execution_for_session,
        workflows::{
            TriggerWorkflowRequest, WorkflowNodeExecutionResponse, WorkflowRunResponse,
            ensure_agent_node_sessions, get_workflow_template, persist_workflow_graph,
        },
    },
    workflow_runtime::{
        arena::{
            ArenaNodeAttemptRequest, ArenaNodeExecution, ArenaNodeRequest, ArenaWinnerExecution,
            ArenaWinnerRequest, NoopWorkflowArenaCreator, WorkflowArenaCreator,
            WorkflowArenaWinnerApplier,
        },
        condition_router::{
            ConditionRouterCompletion, RouterUpstreamNode, build_manual_route, build_router_prompt,
            evaluate_router_output, output_has_router_mutation_warning,
        },
        workspace::{main_workflow_branch_name, short_run_id},
    },
};

#[derive(Debug, Error)]
enum WorkflowRuntimeError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("{0}")]
    BadRequest(String),
}

impl From<WorkflowRuntimeError> for ApiError {
    fn from(error: WorkflowRuntimeError) -> Self {
        match error {
            WorkflowRuntimeError::Database(err) => ApiError::Database(err),
            WorkflowRuntimeError::BadRequest(message) => ApiError::BadRequest(message),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowWorkspaceRequest {
    pub issue_id: Uuid,
    pub run_id: Uuid,
    pub project_id: Option<Uuid>,
    pub existing_workspace_id: Option<Uuid>,
    pub repo_overrides: Vec<CreateWorkspaceRepo>,
    pub branch_name: String,
}

#[derive(Debug)]
pub struct WorkflowRunStartRequest {
    pub workflow_id: Uuid,
    pub attempt_id: Option<Uuid>,
    pub trigger: TriggerWorkflowRequest,
    pub repo_overrides: Vec<CreateWorkspaceRepo>,
}

#[async_trait]
pub trait WorkflowWorkspaceResolver: Send + Sync {
    async fn create_or_bind_main_workspace(
        &self,
        request: WorkflowWorkspaceRequest,
    ) -> Result<Uuid, ApiError>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentNodeRequest {
    pub run_id: Uuid,
    pub node_id: String,
    pub session_id: Option<Uuid>,
    pub workspace_id: Uuid,
    pub prompt: String,
    pub executor_config: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentNodeExecution {
    Completed {
        session_id: Uuid,
        execution_process_id: Uuid,
        output_text: String,
    },
    Started {
        session_id: Uuid,
        execution_process_id: Uuid,
        output_text: Option<String>,
    },
}

#[async_trait]
pub trait WorkflowAgentExecutor: Send + Sync {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError>;
}

#[async_trait]
pub trait WorkflowRunCanceller: Send + Sync {
    async fn cancel_session(&self, session_id: Uuid) -> Result<(), ApiError>;
}

#[derive(Clone)]
pub struct DeploymentWorkflowRunCanceller {
    deployment: DeploymentImpl,
}

impl DeploymentWorkflowRunCanceller {
    pub fn new(deployment: DeploymentImpl) -> Self {
        Self { deployment }
    }
}

#[async_trait]
impl WorkflowRunCanceller for DeploymentWorkflowRunCanceller {
    async fn cancel_session(&self, session_id: Uuid) -> Result<(), ApiError> {
        let processes =
            ExecutionProcess::find_by_session_id(&self.deployment.db().pool, session_id, false)
                .await?;
        for process in processes
            .iter()
            .filter(|process| process.status == ExecutionProcessStatus::Running)
        {
            self.deployment
                .container()
                .stop_execution(process, ExecutionProcessStatus::Killed)
                .await?;
        }

        Ok(())
    }
}

static WORKFLOW_EVENT_HUB: LazyLock<WorkflowRuntimeEventHub> =
    LazyLock::new(WorkflowRuntimeEventHub::new);

const MAX_WORKFLOW_EVENT_HISTORY: usize = 4096;

#[derive(Debug)]
struct WorkflowRuntimeEventHub {
    inner: Mutex<WorkflowRuntimeEventHubInner>,
    sender: broadcast::Sender<WorkflowEvent>,
}

#[derive(Debug, Default)]
struct WorkflowRuntimeEventHubInner {
    next_sequence: u64,
    events: Vec<WorkflowEvent>,
}

impl WorkflowRuntimeEventHub {
    fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self {
            inner: Mutex::new(WorkflowRuntimeEventHubInner::default()),
            sender,
        }
    }

    fn publish(&self, mut event: WorkflowEvent) -> WorkflowEvent {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.next_sequence += 1;
        event.sequence = inner.next_sequence;
        inner.events.push(event.clone());
        if inner.events.len() > MAX_WORKFLOW_EVENT_HISTORY {
            let excess = inner.events.len() - MAX_WORKFLOW_EVENT_HISTORY;
            inner.events.drain(0..excess);
        }
        let _ = self.sender.send(event.clone());
        event
    }

    fn history(&self, run_id: Uuid) -> Vec<WorkflowEvent> {
        let run_id = run_id.to_string();
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .events
            .iter()
            .filter(|event| event.run_id == run_id)
            .cloned()
            .collect()
    }

    fn subscribe(&self) -> broadcast::Receiver<WorkflowEvent> {
        self.sender.subscribe()
    }
}

pub fn workflow_event_history(run_id: Uuid) -> Vec<WorkflowEvent> {
    WORKFLOW_EVENT_HUB.history(run_id)
}

pub fn subscribe_workflow_events() -> broadcast::Receiver<WorkflowEvent> {
    WORKFLOW_EVENT_HUB.subscribe()
}

#[derive(Clone)]
pub struct DeploymentWorkflowAgentExecutor {
    deployment: DeploymentImpl,
}

impl DeploymentWorkflowAgentExecutor {
    pub fn new(deployment: DeploymentImpl) -> Self {
        Self { deployment }
    }
}

#[async_trait]
impl WorkflowAgentExecutor for DeploymentWorkflowAgentExecutor {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError> {
        let pool = &self.deployment.db().pool;
        let workspace = Workspace::find_by_id(pool, request.workspace_id)
            .await?
            .ok_or(ApiError::Workspace(WorkspaceError::WorkspaceNotFound))?;
        let executor_config = executor_config_from_node(request.executor_config).await?;

        let session = if let Some(session_id) = request.session_id {
            let session =
                Session::find_by_id(pool, session_id)
                    .await?
                    .ok_or(ApiError::BadRequest(format!(
                        "Workflow node `{}` session `{session_id}` not found",
                        request.node_id
                    )))?;
            if session.workspace_id != workspace.id {
                return Err(ApiError::BadRequest(format!(
                    "Workflow node `{}` session `{session_id}` belongs to workspace `{}` instead of `{}`",
                    request.node_id, session.workspace_id, workspace.id
                )));
            }
            session
        } else {
            Session::create(
                pool,
                &CreateSession {
                    executor: Some(executor_config.profile_id().executor.to_string()),
                    name: Some(format!("Workflow {}", request.node_id)),
                },
                Uuid::new_v4(),
                workspace.id,
            )
            .await?
        };

        let execution_process = start_coding_agent_execution_for_session(
            &self.deployment,
            session.clone(),
            request.prompt,
            None,
            executor_config,
            None,
            None,
            None,
        )
        .await?;

        Ok(AgentNodeExecution::Started {
            session_id: session.id,
            execution_process_id: execution_process.id,
            output_text: Some(format!(
                "Started workflow agent execution {}",
                execution_process.id
            )),
        })
    }
}

pub async fn trigger_workflow_run<W, A>(
    pool: &SqlitePool,
    workflow_id: Uuid,
    request: TriggerWorkflowRequest,
    workspace_resolver: &W,
    agent_executor: &A,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
{
    let arena_creator = NoopWorkflowArenaCreator;
    trigger_workflow_run_with_arena(
        pool,
        workflow_id,
        request,
        workspace_resolver,
        agent_executor,
        &arena_creator,
    )
    .await
}

pub async fn trigger_workflow_run_with_arena<W, A, R>(
    pool: &SqlitePool,
    workflow_id: Uuid,
    request: TriggerWorkflowRequest,
    workspace_resolver: &W,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    trigger_workflow_run_for_attempt_with_arena(
        pool,
        workflow_id,
        None,
        request,
        workspace_resolver,
        agent_executor,
        arena_creator,
    )
    .await
}

pub async fn trigger_workflow_run_for_attempt_with_arena<W, A, R>(
    pool: &SqlitePool,
    workflow_id: Uuid,
    attempt_id: Option<Uuid>,
    request: TriggerWorkflowRequest,
    workspace_resolver: &W,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    trigger_workflow_run_for_attempt_with_repos(
        pool,
        WorkflowRunStartRequest {
            workflow_id,
            attempt_id,
            trigger: request,
            repo_overrides: Vec::new(),
        },
        workspace_resolver,
        agent_executor,
        arena_creator,
    )
    .await
}

pub async fn trigger_workflow_run_for_attempt_with_repos<W, A, R>(
    pool: &SqlitePool,
    request: WorkflowRunStartRequest,
    workspace_resolver: &W,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let WorkflowRunStartRequest {
        workflow_id,
        attempt_id,
        trigger,
        repo_overrides,
    } = request;
    let workflow = get_workflow_template(pool, workflow_id).await?;
    let mut graph: WorkflowGraph = serde_json::from_str(&workflow.graph_json)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}")))?;
    validate_graph_for_run(&graph)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph: {err}")))?;

    let run_id = Uuid::new_v4();
    let project_id = workflow
        .project_id
        .or(resolve_issue_project_id(pool, trigger.issue_id).await?);
    let workspace_id = workspace_resolver
        .create_or_bind_main_workspace(WorkflowWorkspaceRequest {
            issue_id: trigger.issue_id,
            run_id,
            project_id,
            existing_workspace_id: trigger.workspace_id,
            repo_overrides,
            branch_name: main_workflow_branch_name(trigger.issue_id, run_id),
        })
        .await?;

    if ensure_agent_node_sessions(pool, workspace_id, &mut graph).await? {
        persist_workflow_graph(pool, workflow_id, &graph).await?;
    }

    insert_workflow_run(
        pool,
        run_id,
        workflow_id,
        attempt_id,
        workspace_id,
        &trigger,
    )
    .await?;
    initialize_node_executions(pool, run_id, &graph).await?;
    drive_workflow_run(
        pool,
        run_id,
        &graph,
        trigger.issue_id,
        workspace_id,
        &trigger.input_text,
        agent_executor,
        arena_creator,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

async fn resolve_issue_project_id(
    pool: &SqlitePool,
    issue_id: Uuid,
) -> Result<Option<Uuid>, ApiError> {
    let has_local_issues: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'local_issues'",
    )
    .fetch_one(pool)
    .await?;

    if has_local_issues == 0 {
        return Ok(None);
    }

    Ok(
        sqlx::query_scalar("SELECT project_id FROM local_issues WHERE id = ?")
            .bind(issue_id)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn get_workflow_run_response(
    pool: &SqlitePool,
    run_id: Uuid,
) -> Result<WorkflowRunResponse, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, workflow_id, attempt_id, issue_id, workspace_id, trigger_source, input_text,
               output_text, status, started_at, finished_at, error_text, created_at, updated_at
        FROM workflow_runs
        WHERE id = ?
        "#,
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Workflow run not found".to_string()))?;

    let nodes = node_execution_responses(pool, run_id).await?;

    Ok(WorkflowRunResponse {
        id: row.try_get("id")?,
        workflow_id: row.try_get("workflow_id")?,
        attempt_id: row.try_get("attempt_id")?,
        issue_id: row.try_get("issue_id")?,
        workspace_id: row.try_get("workspace_id")?,
        trigger_source: row.try_get("trigger_source")?,
        input_text: row.try_get("input_text")?,
        output_text: row.try_get("output_text")?,
        status: workflow_run_status_from_str(&row.try_get::<String, _>("status")?)?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        error_text: row.try_get("error_text")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        nodes,
    })
}

pub async fn approve_human_node<A>(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    agent_executor: &A,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
{
    let arena_creator = NoopWorkflowArenaCreator;
    approve_human_node_with_arena(pool, run_id, node_id, agent_executor, &arena_creator).await
}

pub async fn approve_human_node_with_arena<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let run = load_runtime_run(pool, run_id).await?;
    let node = run
        .graph
        .nodes
        .iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| ApiError::BadRequest(format!("Workflow node `{node_id}` not found")))?;
    if node.kind != WorkflowNodeKind::HumanGate {
        return Err(ApiError::BadRequest(format!(
            "Workflow node `{node_id}` is not a human gate"
        )));
    }
    ensure_node_status(pool, run_id, node_id, DbNodeExecutionStatus::AwaitingHuman).await?;

    let context = node_context(pool, &run.graph, run_id, node, &run.input_text).await?;
    let approval_output = context.upstream_text();
    mark_node_succeeded(pool, run_id, node_id, 0, Some(&approval_output), None, None).await?;
    update_run_status(pool, run_id, WorkflowRunStatus::Running, None, None, false).await?;
    drive_workflow_run(
        pool,
        run_id,
        &run.graph,
        run.issue_id,
        run.workspace_id,
        &run.input_text,
        agent_executor,
        arena_creator,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

pub async fn select_condition_branch_with_arena<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    selected_target_node_ids: Vec<String>,
    reason: Option<String>,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let run = load_runtime_run(pool, run_id).await?;
    let node = run
        .graph
        .nodes
        .iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| ApiError::BadRequest(format!("Workflow node `{node_id}` not found")))?;
    if node.kind != WorkflowNodeKind::Condition {
        return Err(ApiError::BadRequest(format!(
            "Workflow node `{node_id}` is not a condition"
        )));
    }
    let iteration =
        node_iteration_with_status(pool, run_id, node_id, DbNodeExecutionStatus::AwaitingHuman)
            .await?;

    let existing_output = node_execution_output_text(pool, run_id, node_id, iteration).await?;
    let manual_route = build_manual_route(
        &run.graph,
        node,
        &selected_target_node_ids,
        reason.as_deref(),
        output_has_router_mutation_warning(existing_output.as_deref()),
    )
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    mark_node_succeeded(
        pool,
        run_id,
        node_id,
        iteration,
        Some(&manual_route.output_text),
        None,
        None,
    )
    .await?;
    mark_skipped_targets(pool, run_id, &manual_route.skipped_target_node_ids).await?;
    update_run_status(pool, run_id, WorkflowRunStatus::Running, None, None, false).await?;
    drive_workflow_run(
        pool,
        run_id,
        &run.graph,
        run.issue_id,
        run.workspace_id,
        &run.input_text,
        agent_executor,
        arena_creator,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

pub async fn select_arena_winner_with_arena<A, R, W>(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    winner_workspace_id: Uuid,
    agent_executor: &A,
    arena_creator: &R,
    winner_applier: &W,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
    W: WorkflowArenaWinnerApplier,
{
    let run = load_runtime_run(pool, run_id).await?;
    let node = run
        .graph
        .nodes
        .iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| ApiError::BadRequest(format!("Workflow node `{node_id}` not found")))?;
    if node.kind != WorkflowNodeKind::Arena {
        return Err(ApiError::BadRequest(format!(
            "Workflow node `{node_id}` is not an arena node"
        )));
    }
    ensure_node_status(pool, run_id, node_id, DbNodeExecutionStatus::AwaitingArena).await?;
    let arena_group_id = arena_group_id_for_node(pool, run_id, node_id).await?;

    match winner_applier
        .apply_winner(ArenaWinnerRequest {
            run_id,
            node_id: node_id.to_string(),
            arena_group_id,
            main_workspace_id: run.workspace_id,
            winner_workspace_id,
        })
        .await
    {
        Ok(ArenaWinnerExecution { output_text }) => {
            mark_node_succeeded(pool, run_id, node_id, 0, Some(&output_text), None, None).await?;
            update_run_status(pool, run_id, WorkflowRunStatus::Running, None, None, false).await?;
            drive_workflow_run(
                pool,
                run_id,
                &run.graph,
                run.issue_id,
                run.workspace_id,
                &run.input_text,
                agent_executor,
                arena_creator,
            )
            .await?;
        }
        Err(err) => {
            let message = format!("{err}; winner workspace: {winner_workspace_id}");
            mark_node_failed(pool, run_id, node_id, 0, &message).await?;
            mark_pending_nodes_skipped(pool, run_id).await?;
            update_run_status(
                pool,
                run_id,
                WorkflowRunStatus::Failed,
                None,
                Some(&message),
                true,
            )
            .await?;
        }
    }

    get_workflow_run_response(pool, run_id).await
}

pub async fn reject_human_node(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
) -> Result<WorkflowRunResponse, ApiError> {
    ensure_node_status(pool, run_id, node_id, DbNodeExecutionStatus::AwaitingHuman).await?;

    let message = "Human gate rejected";
    mark_node_failed(pool, run_id, node_id, 0, message).await?;
    mark_pending_nodes_skipped(pool, run_id).await?;
    update_run_status(
        pool,
        run_id,
        WorkflowRunStatus::Failed,
        None,
        Some(message),
        true,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

pub async fn cancel_workflow_run_runtime<C>(
    pool: &SqlitePool,
    run_id: Uuid,
    canceller: &C,
) -> Result<WorkflowRunResponse, ApiError>
where
    C: WorkflowRunCanceller,
{
    ensure_run_exists(pool, run_id).await?;
    let session_ids = running_node_session_ids(pool, run_id).await?;
    for session_id in session_ids {
        canceller.cancel_session(session_id).await?;
    }

    fail_active_nodes(pool, run_id, "Workflow run canceled").await?;
    mark_pending_nodes_skipped(pool, run_id).await?;
    update_run_status(
        pool,
        run_id,
        WorkflowRunStatus::Canceled,
        None,
        Some("Workflow run canceled"),
        true,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

pub async fn retry_workflow_node<A>(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    agent_executor: &A,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
{
    let arena_creator = NoopWorkflowArenaCreator;
    retry_workflow_node_with_arena(pool, run_id, node_id, agent_executor, &arena_creator).await
}

pub async fn retry_workflow_node_with_arena<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let run = load_runtime_run(pool, run_id).await?;
    let node = run
        .graph
        .nodes
        .iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| ApiError::BadRequest(format!("Workflow node `{node_id}` not found")))?;
    if !matches!(
        node.kind,
        WorkflowNodeKind::Agent | WorkflowNodeKind::Condition | WorkflowNodeKind::Transform
    ) {
        return Err(ApiError::BadRequest(format!(
            "Workflow node `{node_id}` cannot be retried"
        )));
    }
    ensure_node_status(pool, run_id, node_id, DbNodeExecutionStatus::Failed).await?;

    reset_node_for_retry(pool, run_id, node_id).await?;
    reset_downstream_skipped_nodes(pool, run_id, &run.graph, node_id).await?;
    update_run_status(pool, run_id, WorkflowRunStatus::Running, None, None, false).await?;
    drive_workflow_run(
        pool,
        run_id,
        &run.graph,
        run.issue_id,
        run.workspace_id,
        &run.input_text,
        agent_executor,
        arena_creator,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

pub async fn reconcile_workflow_run<A>(
    pool: &SqlitePool,
    run_id: Uuid,
    agent_executor: &A,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
{
    let arena_creator = NoopWorkflowArenaCreator;
    reconcile_workflow_run_with_arena(pool, run_id, agent_executor, &arena_creator).await
}

pub async fn reconcile_workflow_run_with_arena<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let current = get_workflow_run_response(pool, run_id).await?;
    if !matches!(
        current.status,
        WorkflowRunStatus::Pending | WorkflowRunStatus::Running
    ) {
        return Ok(current);
    }

    let run = load_runtime_run(pool, run_id).await?;
    let outcome =
        reconcile_running_workflow_nodes(pool, run_id, &run.graph, run.workspace_id).await?;

    if outcome.failed {
        mark_pending_nodes_skipped(pool, run_id).await?;
        update_run_status(
            pool,
            run_id,
            WorkflowRunStatus::Failed,
            None,
            Some("Workflow agent execution failed"),
            true,
        )
        .await?;
    } else if outcome.awaiting_human {
        update_run_status(
            pool,
            run_id,
            WorkflowRunStatus::AwaitingHuman,
            None,
            None,
            false,
        )
        .await?;
    } else if outcome.completed {
        update_run_status(pool, run_id, WorkflowRunStatus::Running, None, None, false).await?;
        drive_workflow_run(
            pool,
            run_id,
            &run.graph,
            run.issue_id,
            run.workspace_id,
            &run.input_text,
            agent_executor,
            arena_creator,
        )
        .await?;
    }

    get_workflow_run_response(pool, run_id).await
}

pub async fn recover_stale_workflow_runs(pool: &SqlitePool) -> Result<u64, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT run_id
        FROM node_executions
        WHERE status = 'running'
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut recovered = 0;
    for row in rows {
        let run_id: Uuid = row.try_get("run_id")?;
        let message =
            "Workflow run was interrupted while nodes were running; retry failed nodes to recover";
        fail_nodes_with_status(pool, run_id, &[DbNodeExecutionStatus::Running], message).await?;
        update_run_status(
            pool,
            run_id,
            WorkflowRunStatus::Failed,
            None,
            Some(message),
            true,
        )
        .await?;
        sqlx::query(
            r#"
            UPDATE workflow_attempts
            SET status = 'failed',
                updated_at = datetime('now', 'subsec')
            WHERE latest_run_id = ?
               OR id = (SELECT attempt_id FROM workflow_runs WHERE id = ?)
            "#,
        )
        .bind(run_id)
        .bind(run_id)
        .execute(pool)
        .await?;
        recovered += 1;
    }

    Ok(recovered)
}

#[derive(Debug, Default)]
struct ReconcileOutcome {
    completed: bool,
    failed: bool,
    awaiting_human: bool,
}

async fn reconcile_running_workflow_nodes(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
    workspace_id: Uuid,
) -> Result<ReconcileOutcome, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT ne.node_id, ne.node_type, ne.iteration, ne.execution_process_id, ne.output_text,
               ep.status, ep.exit_code
        FROM node_executions ne
        JOIN execution_processes ep ON ep.id = ne.execution_process_id
        WHERE ne.run_id = ?
          AND ne.node_type IN ('agent', 'condition')
          AND ne.status = 'running'
          AND ne.execution_process_id IS NOT NULL
        ORDER BY ne.rowid ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    let mut outcome = ReconcileOutcome::default();
    for row in rows {
        let node_id: String = row.try_get("node_id")?;
        let node_type: String = row.try_get("node_type")?;
        let iteration: i64 = row.try_get("iteration")?;
        let execution_process_id: Uuid = row.try_get("execution_process_id")?;
        let node_output_text: Option<String> = row.try_get("output_text")?;
        let status: ExecutionProcessStatus = row.try_get("status")?;
        let exit_code: Option<i64> = row.try_get("exit_code")?;

        match status {
            ExecutionProcessStatus::Running => {}
            ExecutionProcessStatus::Completed => {
                if node_type == "condition" {
                    let raw_output = router_summary_for_execution(pool, execution_process_id)
                        .await?
                        .unwrap_or_default();
                    let completed = complete_condition_router(
                        pool,
                        run_id,
                        graph,
                        workspace_id,
                        &node_id,
                        iteration,
                        execution_process_id,
                        node_output_text.as_deref(),
                        &raw_output,
                    )
                    .await?;
                    if completed.should_pause() {
                        outcome.awaiting_human = true;
                    } else {
                        outcome.completed = true;
                    }
                } else {
                    let output =
                        format!("Completed workflow agent execution {execution_process_id}");
                    mark_node_succeeded(
                        pool,
                        run_id,
                        &node_id,
                        iteration,
                        Some(&output),
                        None,
                        Some(execution_process_id),
                    )
                    .await?;
                    outcome.completed = true;
                }
            }
            ExecutionProcessStatus::Failed | ExecutionProcessStatus::Killed => {
                let message = match exit_code {
                    Some(code) => format!(
                        "Workflow agent execution {execution_process_id} {status:?} with exit code {code}"
                    ),
                    None => {
                        format!("Workflow agent execution {execution_process_id} {status:?}")
                    }
                };
                mark_node_failed(pool, run_id, &node_id, iteration, &message).await?;
                outcome.failed = true;
            }
        }
    }

    Ok(outcome)
}

#[derive(Debug)]
struct RuntimeRun {
    graph: WorkflowGraph,
    issue_id: Uuid,
    workspace_id: Uuid,
    input_text: String,
}

async fn load_runtime_run(pool: &SqlitePool, run_id: Uuid) -> Result<RuntimeRun, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT wr.workflow_id, wr.issue_id, wr.workspace_id, wr.input_text, w.graph_json
        FROM workflow_runs wr
        JOIN workflows w ON w.id = wr.workflow_id
        WHERE wr.id = ?
        "#,
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Workflow run not found".to_string()))?;

    let graph_json: String = row.try_get("graph_json")?;
    let graph: WorkflowGraph = serde_json::from_str(&graph_json)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}")))?;
    validate_graph_for_run(&graph)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph: {err}")))?;

    Ok(RuntimeRun {
        graph,
        issue_id: row.try_get("issue_id")?,
        workspace_id: row
            .try_get::<Option<Uuid>, _>("workspace_id")?
            .ok_or_else(|| ApiError::BadRequest("Workflow run has no workspace".to_string()))?,
        input_text: row.try_get("input_text")?,
    })
}

async fn insert_workflow_run(
    pool: &SqlitePool,
    run_id: Uuid,
    workflow_id: Uuid,
    attempt_id: Option<Uuid>,
    workspace_id: Uuid,
    request: &TriggerWorkflowRequest,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, attempt_id, issue_id, workspace_id, trigger_source, input_text, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', datetime('now', 'subsec'))
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(attempt_id)
    .bind(request.issue_id)
    .bind(workspace_id)
    .bind(&request.trigger_source)
    .bind(&request.input_text)
    .execute(pool)
    .await?;

    emit_run_status(run_id, WorkflowRunStatus::Running, None, None);

    Ok(())
}

async fn initialize_node_executions(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
) -> Result<(), ApiError> {
    for node in &graph.nodes {
        sqlx::query(
            r#"
            INSERT INTO node_executions (id, run_id, node_id, node_type, iteration, status)
            VALUES (?, ?, ?, ?, 0, 'pending')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(run_id)
        .bind(&node.id)
        .bind(node_kind_value(&node.kind))
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn ensure_triggered_node_iterations(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
) -> Result<(), ApiError> {
    let succeeded_counts = succeeded_execution_counts(pool, run_id).await?;
    let existing_counts = existing_execution_counts(pool, run_id).await?;
    let mut max_iterations = max_execution_iterations(pool, run_id).await?;

    for node in graph
        .nodes
        .iter()
        .filter(|node| node.kind != WorkflowNodeKind::Start)
    {
        let desired_count = graph
            .edges
            .iter()
            .filter(|edge| edge.target == node.id)
            .map(|edge| {
                succeeded_counts
                    .get(edge.source.as_str())
                    .copied()
                    .unwrap_or(0)
            })
            .sum::<i64>();
        let existing_count = existing_counts
            .get(node.id.as_str())
            .copied()
            .unwrap_or_default();

        for _ in existing_count..desired_count {
            let next_iteration = max_iterations
                .entry(node.id.clone())
                .and_modify(|iteration| *iteration += 1)
                .or_insert(0);
            insert_node_execution(pool, run_id, node, *next_iteration).await?;
        }
    }

    Ok(())
}

async fn succeeded_execution_counts(
    pool: &SqlitePool,
    run_id: Uuid,
) -> Result<HashMap<String, i64>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT node_id, COUNT(*) AS count
        FROM node_executions
        WHERE run_id = ? AND status = 'succeeded'
        GROUP BY node_id
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| Ok((row.try_get("node_id")?, row.try_get("count")?)))
        .collect::<Result<HashMap<_, _>, ApiError>>()
}

async fn existing_execution_counts(
    pool: &SqlitePool,
    run_id: Uuid,
) -> Result<HashMap<String, i64>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT node_id, COUNT(*) AS count
        FROM node_executions
        WHERE run_id = ? AND status != 'skipped'
        GROUP BY node_id
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| Ok((row.try_get("node_id")?, row.try_get("count")?)))
        .collect::<Result<HashMap<_, _>, ApiError>>()
}

async fn max_execution_iterations(
    pool: &SqlitePool,
    run_id: Uuid,
) -> Result<HashMap<String, i64>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT node_id, MAX(iteration) AS max_iteration
        FROM node_executions
        WHERE run_id = ?
        GROUP BY node_id
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok((
                row.try_get("node_id")?,
                row.try_get::<Option<i64>, _>("max_iteration")?
                    .unwrap_or_default(),
            ))
        })
        .collect::<Result<HashMap<_, _>, ApiError>>()
}

async fn insert_node_execution(
    pool: &SqlitePool,
    run_id: Uuid,
    node: &WorkflowNode,
    iteration: i64,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO node_executions (id, run_id, node_id, node_type, iteration, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(run_id)
    .bind(&node.id)
    .bind(node_kind_value(&node.kind))
    .bind(iteration)
    .execute(pool)
    .await?;

    emit_node_status(
        run_id,
        &node.id,
        DbNodeExecutionStatus::Pending,
        json!({ "status": "pending", "iteration": iteration }),
    );

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn drive_workflow_run<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
    issue_id: Uuid,
    workspace_id: Uuid,
    run_input_text: &str,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<(), ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let runner = WorkflowRunner::from_graph(graph.clone());

    loop {
        ensure_triggered_node_iterations(pool, run_id, graph).await?;
        let snapshot = load_run_snapshot(pool, run_id).await?;
        if all_nodes_terminal(&snapshot) {
            let output_text = final_run_output(pool, run_id, graph).await?;
            update_run_status(
                pool,
                run_id,
                WorkflowRunStatus::Succeeded,
                output_text,
                None,
                true,
            )
            .await?;
            return Ok(());
        }

        let ready_plan = runner.ready_plan(&snapshot);
        if ready_plan.ready_nodes.is_empty() {
            return Ok(());
        }

        let mut should_pause = false;
        for ready_node in ready_plan.ready_nodes {
            let Some(node) = graph
                .nodes
                .iter()
                .find(|node| node.id == ready_node.node_id)
            else {
                continue;
            };
            let step = execute_ready_node(
                pool,
                run_id,
                graph,
                node,
                ready_node.iteration,
                issue_id,
                workspace_id,
                run_input_text,
                agent_executor,
                arena_creator,
            )
            .await?;
            match step {
                RunStep::Continue => {}
                RunStep::Pause => should_pause = true,
                RunStep::Stop => return Ok(()),
            }
        }

        if should_pause {
            return Ok(());
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunStep {
    Continue,
    Pause,
    Stop,
}

#[allow(clippy::too_many_arguments)]
async fn execute_ready_node<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
    node: &WorkflowNode,
    iteration: i64,
    issue_id: Uuid,
    workspace_id: Uuid,
    run_input_text: &str,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<RunStep, ApiError>
where
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let context = node_context(pool, graph, run_id, node, run_input_text).await?;
    match node.kind {
        WorkflowNodeKind::Agent => {
            let prompt = render_agent_prompt(node, &context);
            let session_id = node_session_id(node).map_err(ApiError::BadRequest)?;
            mark_node_running(pool, run_id, &node.id, iteration, Some(&prompt)).await?;
            match agent_executor
                .run_agent(AgentNodeRequest {
                    run_id,
                    node_id: node.id.clone(),
                    session_id,
                    workspace_id,
                    prompt,
                    executor_config: node.data.executor_config.clone(),
                })
                .await
            {
                Ok(AgentNodeExecution::Completed {
                    session_id,
                    execution_process_id,
                    output_text,
                }) => {
                    mark_node_succeeded(
                        pool,
                        run_id,
                        &node.id,
                        iteration,
                        Some(&output_text),
                        Some(session_id),
                        Some(execution_process_id),
                    )
                    .await?;
                    Ok(RunStep::Continue)
                }
                Ok(AgentNodeExecution::Started {
                    session_id,
                    execution_process_id,
                    output_text,
                }) => {
                    update_node_execution(
                        pool,
                        run_id,
                        &node.id,
                        iteration,
                        NodeExecutionUpdate {
                            status: DbNodeExecutionStatus::Running,
                            input_text: None,
                            output_text: output_text.as_deref(),
                            session_id: Some(session_id),
                            execution_process_id: Some(execution_process_id),
                            arena_group_id: None,
                            error_text: None,
                            finished: false,
                        },
                    )
                    .await?;
                    Ok(RunStep::Pause)
                }
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, iteration, &message).await?;
                    mark_pending_nodes_skipped(pool, run_id).await?;
                    update_run_status(
                        pool,
                        run_id,
                        WorkflowRunStatus::Failed,
                        None,
                        Some(&message),
                        true,
                    )
                    .await?;
                    Ok(RunStep::Stop)
                }
            }
        }
        WorkflowNodeKind::Condition => {
            let pre_worktree_snapshot = workflow_worktree_snapshot(pool, workspace_id).await?;
            let upstream_nodes = router_upstream_nodes(pool, graph, run_id, node).await?;
            let prompt = build_router_prompt(
                &run_id.to_string(),
                graph,
                node,
                run_input_text,
                &upstream_nodes,
                pre_worktree_snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.summary.as_str()),
            )
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            let router_session_id =
                router_session_id_for_run(pool, run_id, workspace_id, graph).await?;
            let router_executor_config = graph.router_executor_config.clone().ok_or_else(|| {
                ApiError::BadRequest(
                    "Workflow with Condition nodes requires router executor config".to_string(),
                )
            })?;

            mark_node_running(pool, run_id, &node.id, iteration, Some(&prompt)).await?;
            match agent_executor
                .run_agent(AgentNodeRequest {
                    run_id,
                    node_id: node.id.clone(),
                    session_id: Some(router_session_id),
                    workspace_id,
                    prompt,
                    executor_config: Some(router_executor_config),
                })
                .await
            {
                Ok(AgentNodeExecution::Completed {
                    session_id,
                    execution_process_id,
                    output_text,
                }) => {
                    let started_output = router_started_output_payload(
                        execution_process_id,
                        pre_worktree_snapshot.as_ref(),
                    );
                    update_node_execution(
                        pool,
                        run_id,
                        &node.id,
                        iteration,
                        NodeExecutionUpdate {
                            status: DbNodeExecutionStatus::Running,
                            input_text: None,
                            output_text: Some(&started_output),
                            session_id: Some(session_id),
                            execution_process_id: Some(execution_process_id),
                            arena_group_id: None,
                            error_text: None,
                            finished: false,
                        },
                    )
                    .await?;
                    let completion = complete_condition_router(
                        pool,
                        run_id,
                        graph,
                        workspace_id,
                        &node.id,
                        iteration,
                        execution_process_id,
                        Some(&started_output),
                        &output_text,
                    )
                    .await?;
                    if completion.should_pause() {
                        Ok(RunStep::Pause)
                    } else {
                        Ok(RunStep::Continue)
                    }
                }
                Ok(AgentNodeExecution::Started {
                    session_id,
                    execution_process_id,
                    output_text: _,
                }) => {
                    let output_text = router_started_output_payload(
                        execution_process_id,
                        pre_worktree_snapshot.as_ref(),
                    );
                    update_node_execution(
                        pool,
                        run_id,
                        &node.id,
                        iteration,
                        NodeExecutionUpdate {
                            status: DbNodeExecutionStatus::Running,
                            input_text: None,
                            output_text: Some(&output_text),
                            session_id: Some(session_id),
                            execution_process_id: Some(execution_process_id),
                            arena_group_id: None,
                            error_text: None,
                            finished: false,
                        },
                    )
                    .await?;
                    Ok(RunStep::Pause)
                }
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, iteration, &message).await?;
                    mark_pending_nodes_skipped(pool, run_id).await?;
                    update_run_status(
                        pool,
                        run_id,
                        WorkflowRunStatus::Failed,
                        None,
                        Some(&message),
                        true,
                    )
                    .await?;
                    Ok(RunStep::Stop)
                }
            }
        }
        WorkflowNodeKind::Arena => {
            let prompt = render_arena_prompt(node, &context);
            mark_node_running(pool, run_id, &node.id, iteration, Some(&prompt)).await?;
            match arena_creator
                .create_arena(ArenaNodeRequest {
                    run_id,
                    node_id: node.id.clone(),
                    issue_id,
                    main_workspace_id: workspace_id,
                    prompt: prompt.clone(),
                    attempts: arena_attempt_requests(issue_id, run_id, node, &context, &prompt),
                })
                .await
            {
                Ok(ArenaNodeExecution { arena_group_id }) => {
                    update_node_execution(
                        pool,
                        run_id,
                        &node.id,
                        iteration,
                        NodeExecutionUpdate {
                            status: DbNodeExecutionStatus::AwaitingArena,
                            input_text: Some(&prompt),
                            output_text: None,
                            session_id: None,
                            execution_process_id: None,
                            arena_group_id: Some(arena_group_id),
                            error_text: None,
                            finished: false,
                        },
                    )
                    .await?;
                    update_run_status(
                        pool,
                        run_id,
                        WorkflowRunStatus::AwaitingArena,
                        None,
                        None,
                        false,
                    )
                    .await?;
                    Ok(RunStep::Pause)
                }
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, iteration, &message).await?;
                    mark_pending_nodes_skipped(pool, run_id).await?;
                    update_run_status(
                        pool,
                        run_id,
                        WorkflowRunStatus::Failed,
                        None,
                        Some(&message),
                        true,
                    )
                    .await?;
                    Ok(RunStep::Stop)
                }
            }
        }
        _ => {
            let input_text = context.upstream_text();
            mark_node_running(pool, run_id, &node.id, iteration, Some(&input_text)).await?;
            let outgoing_edges = outgoing_edges(graph, &node.id);
            match handle_pure_node(node, &outgoing_edges, &context) {
                Ok(outcome) => match outcome.status {
                    NodeHandlerStatus::Succeeded => {
                        mark_node_succeeded(
                            pool,
                            run_id,
                            &node.id,
                            iteration,
                            outcome.output_text.as_deref(),
                            None,
                            None,
                        )
                        .await?;
                        mark_skipped_targets(pool, run_id, &outcome.skipped_target_node_ids)
                            .await?;
                        Ok(RunStep::Continue)
                    }
                    NodeHandlerStatus::AwaitingHuman => {
                        update_node_execution(
                            pool,
                            run_id,
                            &node.id,
                            iteration,
                            NodeExecutionUpdate {
                                status: DbNodeExecutionStatus::AwaitingHuman,
                                input_text: outcome.prompt.as_deref(),
                                output_text: None,
                                session_id: None,
                                execution_process_id: None,
                                arena_group_id: None,
                                error_text: None,
                                finished: false,
                            },
                        )
                        .await?;
                        update_run_status(
                            pool,
                            run_id,
                            WorkflowRunStatus::AwaitingHuman,
                            None,
                            None,
                            false,
                        )
                        .await?;
                        Ok(RunStep::Pause)
                    }
                    NodeHandlerStatus::AwaitingArena => {
                        update_node_execution(
                            pool,
                            run_id,
                            &node.id,
                            iteration,
                            NodeExecutionUpdate {
                                status: DbNodeExecutionStatus::AwaitingArena,
                                input_text: outcome.prompt.as_deref(),
                                output_text: None,
                                session_id: None,
                                execution_process_id: None,
                                arena_group_id: None,
                                error_text: None,
                                finished: false,
                            },
                        )
                        .await?;
                        update_run_status(
                            pool,
                            run_id,
                            WorkflowRunStatus::AwaitingArena,
                            None,
                            None,
                            false,
                        )
                        .await?;
                        Ok(RunStep::Pause)
                    }
                },
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, iteration, &message).await?;
                    mark_pending_nodes_skipped(pool, run_id).await?;
                    update_run_status(
                        pool,
                        run_id,
                        WorkflowRunStatus::Failed,
                        None,
                        Some(&message),
                        true,
                    )
                    .await?;
                    Ok(RunStep::Stop)
                }
            }
        }
    }
}

async fn node_context(
    pool: &SqlitePool,
    graph: &WorkflowGraph,
    run_id: Uuid,
    node: &WorkflowNode,
    run_input_text: &str,
) -> Result<NodeHandlerContext, ApiError> {
    let mut upstream_outputs = Vec::new();

    for edge in graph.edges.iter().filter(|edge| edge.target == node.id) {
        if let Some(output_text) = sqlx::query_scalar::<_, Option<String>>(
            r#"
            SELECT output_text
            FROM node_executions
            WHERE run_id = ? AND node_id = ? AND status = 'succeeded'
            ORDER BY iteration ASC
            LIMIT 1
            "#,
        )
        .bind(run_id)
        .bind(&edge.source)
        .fetch_optional(pool)
        .await?
        .flatten()
        {
            upstream_outputs.push(UpstreamOutput {
                node_id: edge.source.clone(),
                output_text,
            });
        }
    }

    Ok(NodeHandlerContext::with_upstream_outputs(
        run_input_text.to_string(),
        upstream_outputs,
    ))
}

fn render_agent_prompt(node: &WorkflowNode, context: &NodeHandlerContext) -> String {
    render_prompt_template(
        node.data.prompt_template.as_deref().unwrap_or_default(),
        context,
    )
}

fn render_arena_prompt(node: &WorkflowNode, context: &NodeHandlerContext) -> String {
    render_prompt_template(
        node.data.prompt_template.as_deref().unwrap_or_default(),
        context,
    )
}

fn node_session_id(node: &WorkflowNode) -> Result<Option<Uuid>, String> {
    node.data
        .session_id
        .as_deref()
        .map(|session_id| {
            Uuid::parse_str(session_id).map_err(|err| {
                format!(
                    "Workflow node `{}` has invalid session_id `{session_id}`: {err}",
                    node.id
                )
            })
        })
        .transpose()
}

fn render_prompt_template(template: &str, context: &NodeHandlerContext) -> String {
    let upstream = context.upstream_text();
    template
        .replace("{{input}}", &context.run_input_text)
        .replace("{{run_input}}", &context.run_input_text)
        .replace("{{upstream}}", &upstream)
}

fn arena_attempt_requests(
    issue_id: Uuid,
    run_id: Uuid,
    node: &WorkflowNode,
    context: &NodeHandlerContext,
    fallback_prompt: &str,
) -> Vec<ArenaNodeAttemptRequest> {
    let attempts = node
        .data
        .attempts
        .clone()
        .filter(|attempts| !attempts.is_empty())
        .unwrap_or_else(|| vec![Default::default(), Default::default()]);

    attempts
        .into_iter()
        .enumerate()
        .map(|(idx, attempt)| {
            let prompt = attempt
                .prompt_template
                .as_deref()
                .map(|template| render_prompt_template(template, context))
                .unwrap_or_else(|| fallback_prompt.to_string());

            ArenaNodeAttemptRequest {
                attempt_id: attempt.id.clone(),
                display_name: attempt.display_name.clone(),
                branch_name: workflow_arena_branch_name(issue_id, run_id, idx + 1),
                prompt,
                executor_config: attempt.executor_config.clone(),
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorktreeSnapshot {
    summary: String,
    fingerprint: String,
}

async fn router_session_id_for_run(
    pool: &SqlitePool,
    run_id: Uuid,
    workspace_id: Uuid,
    graph: &WorkflowGraph,
) -> Result<Uuid, ApiError> {
    if let Some(session_id) = sqlx::query_scalar::<_, Option<Uuid>>(
        r#"
        SELECT session_id
        FROM node_executions
        WHERE run_id = ?
          AND node_type = 'condition'
          AND session_id IS NOT NULL
        ORDER BY rowid ASC
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?
    .flatten()
    {
        return Ok(session_id);
    }

    let router_executor_config = graph.router_executor_config.clone().ok_or_else(|| {
        ApiError::BadRequest(
            "Workflow with Condition nodes requires router executor config".to_string(),
        )
    })?;
    let executor_config = executor_config_from_node(Some(router_executor_config)).await?;
    let session = Session::create(
        pool,
        &CreateSession {
            executor: Some(executor_config.profile_id().executor.to_string()),
            name: Some("Workflow Router".to_string()),
        },
        Uuid::new_v4(),
        workspace_id,
    )
    .await?;

    Ok(session.id)
}

async fn router_upstream_nodes(
    pool: &SqlitePool,
    graph: &WorkflowGraph,
    run_id: Uuid,
    node: &WorkflowNode,
) -> Result<Vec<RouterUpstreamNode>, ApiError> {
    let mut upstream_nodes = Vec::new();
    for edge in graph.edges.iter().filter(|edge| edge.target == node.id) {
        let source_node = graph
            .nodes
            .iter()
            .find(|candidate| candidate.id == edge.source);
        let row = sqlx::query(
            r#"
            SELECT status, output_text, error_text
            FROM node_executions
            WHERE run_id = ? AND node_id = ?
            ORDER BY
              CASE WHEN status = 'succeeded' THEN 0 ELSE 1 END,
              iteration DESC,
              rowid DESC
            LIMIT 1
            "#,
        )
        .bind(run_id)
        .bind(&edge.source)
        .fetch_optional(pool)
        .await?;

        upstream_nodes.push(RouterUpstreamNode {
            node_id: edge.source.clone(),
            node_type: source_node
                .map(|source| node_kind_value(&source.kind).to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            status: row
                .as_ref()
                .map(|row| row.try_get::<String, _>("status"))
                .transpose()?
                .unwrap_or_else(|| "pending".to_string()),
            output_text: row
                .as_ref()
                .map(|row| row.try_get::<Option<String>, _>("output_text"))
                .transpose()?
                .flatten(),
            error_text: row
                .as_ref()
                .map(|row| row.try_get::<Option<String>, _>("error_text"))
                .transpose()?
                .flatten(),
        });
    }

    Ok(upstream_nodes)
}

async fn workflow_worktree_snapshot(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Option<WorktreeSnapshot>, ApiError> {
    let workspace = Workspace::find_by_id(pool, workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::WorkspaceNotFound))?;
    let Some(container_ref) = workspace
        .container_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let repos =
        WorkspaceRepo::find_repos_with_target_branch_for_workspace(pool, workspace_id).await?;
    if repos.is_empty() {
        return Ok(None);
    }

    let workspace_root = PathBuf::from(container_ref);
    let git = GitCli::new();
    let mut summary_lines = Vec::new();
    let mut fingerprint_lines = Vec::new();

    for repo in repos {
        let repo_path = workspace_root.join(&repo.repo.name);
        match git.get_worktree_status(&repo_path) {
            Ok(status) => {
                summary_lines.push(format!(
                    "{}: {} tracked change(s), {} untracked file(s)",
                    repo.repo.name, status.uncommitted_tracked, status.untracked
                ));
                fingerprint_lines.push(format!(
                    "repo={};tracked={};untracked={}",
                    repo.repo.name, status.uncommitted_tracked, status.untracked
                ));
                for entry in status.entries {
                    let path = String::from_utf8_lossy(&entry.path);
                    let orig_path = entry
                        .orig_path
                        .as_ref()
                        .map(|path| String::from_utf8_lossy(path).to_string())
                        .unwrap_or_default();
                    fingerprint_lines.push(format!(
                        "{}{}:{}:{}",
                        entry.staged, entry.unstaged, path, orig_path
                    ));
                }
            }
            Err(err) => {
                summary_lines.push(format!("{}: status unavailable ({err})", repo.repo.name));
                fingerprint_lines.push(format!("repo={};status=unavailable:{err}", repo.repo.name));
            }
        }
    }

    Ok(Some(WorktreeSnapshot {
        summary: summary_lines.join("\n"),
        fingerprint: fingerprint_lines.join("\n"),
    }))
}

fn router_started_output_payload(
    execution_process_id: Uuid,
    pre_worktree_snapshot: Option<&WorktreeSnapshot>,
) -> String {
    serde_json::to_string(&json!({
        "type": "condition_router_run",
        "source": "router",
        "status": "running",
        "schema_version": 1,
        "execution_process_id": execution_process_id,
        "pre_worktree_summary": pre_worktree_snapshot.map(|snapshot| snapshot.summary.as_str()),
        "pre_worktree_fingerprint": pre_worktree_snapshot.map(|snapshot| snapshot.fingerprint.as_str())
    }))
    .unwrap_or_else(|_| "{\"type\":\"condition_router_run\",\"status\":\"running\"}".to_string())
}

fn router_pre_worktree_fingerprint(output_text: Option<&str>) -> Option<String> {
    output_text
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| {
            value
                .get("pre_worktree_fingerprint")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

async fn router_mutation_warning(
    pool: &SqlitePool,
    workspace_id: Uuid,
    started_output_text: Option<&str>,
) -> Result<Option<String>, ApiError> {
    let Some(before) = router_pre_worktree_fingerprint(started_output_text) else {
        return Ok(None);
    };
    let Some(after) = workflow_worktree_snapshot(pool, workspace_id).await? else {
        return Ok(None);
    };
    if before == after.fingerprint {
        return Ok(None);
    }

    Ok(Some(
        "Worktree status changed while the Condition router was running".to_string(),
    ))
}

async fn router_summary_for_execution(
    pool: &SqlitePool,
    execution_process_id: Uuid,
) -> Result<Option<String>, ApiError> {
    Ok(
        CodingAgentTurn::find_by_execution_process_id(pool, execution_process_id)
            .await?
            .and_then(|turn| turn.summary),
    )
}

#[allow(clippy::too_many_arguments)]
async fn complete_condition_router(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
    workspace_id: Uuid,
    node_id: &str,
    iteration: i64,
    execution_process_id: Uuid,
    started_output_text: Option<&str>,
    raw_output: &str,
) -> Result<ConditionRouterCompletion, ApiError> {
    let condition_node = graph
        .nodes
        .iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| ApiError::BadRequest(format!("Workflow node `{node_id}` not found")))?;
    if condition_node.kind != WorkflowNodeKind::Condition {
        return Err(ApiError::BadRequest(format!(
            "Workflow node `{node_id}` is not a condition"
        )));
    }

    let mutation_warning = router_mutation_warning(pool, workspace_id, started_output_text).await?;
    let completion = evaluate_router_output(raw_output, graph, condition_node, mutation_warning);
    if completion.should_pause() {
        update_node_execution(
            pool,
            run_id,
            node_id,
            iteration,
            NodeExecutionUpdate {
                status: DbNodeExecutionStatus::AwaitingHuman,
                input_text: completion.pause_prompt.as_deref(),
                output_text: Some(&completion.output_text),
                session_id: None,
                execution_process_id: Some(execution_process_id),
                arena_group_id: None,
                error_text: None,
                finished: false,
            },
        )
        .await?;
        update_run_status(
            pool,
            run_id,
            WorkflowRunStatus::AwaitingHuman,
            None,
            None,
            false,
        )
        .await?;
    } else {
        mark_node_succeeded(
            pool,
            run_id,
            node_id,
            iteration,
            Some(&completion.output_text),
            None,
            Some(execution_process_id),
        )
        .await?;
        mark_skipped_targets(pool, run_id, &completion.skipped_target_node_ids).await?;
    }

    Ok(completion)
}

fn workflow_arena_branch_name(issue_id: Uuid, run_id: Uuid, attempt_index: usize) -> String {
    format!(
        "vk/{issue_id}-wf-{}-arena-{attempt_index}",
        short_run_id(run_id)
    )
}

fn outgoing_edges(graph: &WorkflowGraph, node_id: &str) -> Vec<WorkflowEdge> {
    graph
        .edges
        .iter()
        .filter(|edge| edge.source == node_id)
        .cloned()
        .collect()
}

async fn load_run_snapshot(pool: &SqlitePool, run_id: Uuid) -> Result<RunSnapshot, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT node_id, iteration, status, output_text, error_text
        FROM node_executions
        WHERE run_id = ?
        ORDER BY rowid ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    let nodes = rows
        .iter()
        .map(|row| {
            Ok(NodeExecutionSnapshot {
                node_id: row.try_get("node_id")?,
                iteration: row.try_get("iteration")?,
                status: planner_status_from_str(&row.try_get::<String, _>("status")?)?,
                output_text: row.try_get("output_text")?,
                error_text: row.try_get("error_text")?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(RunSnapshot {
        run_id: run_id.to_string(),
        nodes,
    })
}

fn all_nodes_terminal(snapshot: &RunSnapshot) -> bool {
    !snapshot.nodes.is_empty()
        && snapshot.nodes.iter().all(|node| {
            matches!(
                node.status,
                PlannerNodeExecutionStatus::Succeeded | PlannerNodeExecutionStatus::Skipped
            )
        })
}

async fn final_run_output(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
) -> Result<Option<String>, ApiError> {
    for node in graph
        .nodes
        .iter()
        .filter(|node| node.kind == WorkflowNodeKind::End)
    {
        let output = sqlx::query_scalar::<_, Option<String>>(
            r#"
            SELECT output_text
            FROM node_executions
            WHERE run_id = ? AND node_id = ? AND status = 'succeeded'
            ORDER BY rowid ASC
            LIMIT 1
            "#,
        )
        .bind(run_id)
        .bind(&node.id)
        .fetch_optional(pool)
        .await?
        .flatten();
        if output.is_some() {
            return Ok(output);
        }
    }

    Ok(sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT output_text
        FROM node_executions
        WHERE run_id = ? AND status = 'succeeded'
        ORDER BY rowid DESC
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?
    .flatten())
}

async fn mark_node_running(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    iteration: i64,
    input_text: Option<&str>,
) -> Result<(), ApiError> {
    update_node_execution(
        pool,
        run_id,
        node_id,
        iteration,
        NodeExecutionUpdate {
            status: DbNodeExecutionStatus::Running,
            input_text,
            output_text: None,
            session_id: None,
            execution_process_id: None,
            arena_group_id: None,
            error_text: None,
            finished: false,
        },
    )
    .await
}

async fn mark_node_succeeded(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    iteration: i64,
    output_text: Option<&str>,
    session_id: Option<Uuid>,
    execution_process_id: Option<Uuid>,
) -> Result<(), ApiError> {
    update_node_execution(
        pool,
        run_id,
        node_id,
        iteration,
        NodeExecutionUpdate {
            status: DbNodeExecutionStatus::Succeeded,
            input_text: None,
            output_text,
            session_id,
            execution_process_id,
            arena_group_id: None,
            error_text: None,
            finished: true,
        },
    )
    .await
}

async fn mark_node_failed(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    iteration: i64,
    error_text: &str,
) -> Result<(), ApiError> {
    update_node_execution(
        pool,
        run_id,
        node_id,
        iteration,
        NodeExecutionUpdate {
            status: DbNodeExecutionStatus::Failed,
            input_text: None,
            output_text: None,
            session_id: None,
            execution_process_id: None,
            arena_group_id: None,
            error_text: Some(error_text),
            finished: true,
        },
    )
    .await
}

async fn mark_skipped_targets(
    pool: &SqlitePool,
    run_id: Uuid,
    node_ids: &[String],
) -> Result<(), ApiError> {
    for node_id in node_ids {
        let row = sqlx::query(
            r#"
            SELECT id, iteration
            FROM node_executions
            WHERE run_id = ? AND node_id = ? AND status = 'pending'
            ORDER BY iteration ASC
            LIMIT 1
            "#,
        )
        .bind(run_id)
        .bind(node_id)
        .fetch_optional(pool)
        .await?;

        let Some(row) = row else {
            continue;
        };
        let execution_id: Uuid = row.try_get("id")?;
        let iteration: i64 = row.try_get("iteration")?;
        let result = sqlx::query(
            r#"
            UPDATE node_executions
            SET status = 'skipped',
                finished_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ? AND status = 'pending'
            "#,
        )
        .bind(execution_id)
        .execute(pool)
        .await?;
        if result.rows_affected() > 0 {
            emit_node_status(
                run_id,
                node_id,
                DbNodeExecutionStatus::Skipped,
                json!({ "status": "skipped", "iteration": iteration }),
            );
        }
    }

    Ok(())
}

async fn ensure_run_exists(pool: &SqlitePool, run_id: Uuid) -> Result<(), ApiError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_runs WHERE id = ?")
        .bind(run_id)
        .fetch_one(pool)
        .await?;
    if count == 0 {
        return Err(ApiError::BadRequest("Workflow run not found".to_string()));
    }

    Ok(())
}

async fn ensure_node_status(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    expected: DbNodeExecutionStatus,
) -> Result<(), ApiError> {
    let status = sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT status
        FROM node_executions
        WHERE run_id = ? AND node_id = ? AND iteration = 0
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .fetch_optional(pool)
    .await?
    .flatten()
    .ok_or_else(|| ApiError::BadRequest(format!("Workflow node `{node_id}` not found")))?;
    let actual = node_execution_status_from_str(&status)?;
    if actual != expected {
        return Err(ApiError::BadRequest(format!(
            "Workflow node `{node_id}` must be `{}` but is `{}`",
            node_status_value(expected),
            node_status_value(actual)
        )));
    }

    Ok(())
}

async fn node_iteration_with_status(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    expected: DbNodeExecutionStatus,
) -> Result<i64, ApiError> {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT iteration
        FROM node_executions
        WHERE run_id = ? AND node_id = ? AND status = ?
        ORDER BY iteration DESC, rowid DESC
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .bind(node_status_value(expected))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        ApiError::BadRequest(format!(
            "Workflow node `{node_id}` must have an `{}` execution",
            node_status_value(expected)
        ))
    })
}

async fn node_execution_output_text(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    iteration: i64,
) -> Result<Option<String>, ApiError> {
    Ok(sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT output_text
        FROM node_executions
        WHERE run_id = ? AND node_id = ? AND iteration = ?
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .bind(iteration)
    .fetch_optional(pool)
    .await?
    .flatten())
}

async fn arena_group_id_for_node(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
) -> Result<Uuid, ApiError> {
    sqlx::query_scalar::<_, Option<Uuid>>(
        r#"
        SELECT arena_group_id
        FROM node_executions
        WHERE run_id = ? AND node_id = ? AND iteration = 0
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .fetch_optional(pool)
    .await?
    .flatten()
    .ok_or_else(|| {
        ApiError::BadRequest(format!(
            "Workflow arena node `{node_id}` has no arena group"
        ))
    })
}

async fn running_node_session_ids(pool: &SqlitePool, run_id: Uuid) -> Result<Vec<Uuid>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT session_id
        FROM node_executions
        WHERE run_id = ? AND status = 'running' AND session_id IS NOT NULL
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| row.try_get("session_id"))
        .collect::<Result<Vec<_>, _>>()?)
}

async fn fail_active_nodes(pool: &SqlitePool, run_id: Uuid, message: &str) -> Result<(), ApiError> {
    fail_nodes_with_status(
        pool,
        run_id,
        &[
            DbNodeExecutionStatus::Running,
            DbNodeExecutionStatus::AwaitingHuman,
            DbNodeExecutionStatus::AwaitingArena,
        ],
        message,
    )
    .await
}

async fn fail_nodes_with_status(
    pool: &SqlitePool,
    run_id: Uuid,
    statuses: &[DbNodeExecutionStatus],
    message: &str,
) -> Result<(), ApiError> {
    for status in statuses {
        let rows = sqlx::query(
            r#"
            SELECT node_id, iteration
            FROM node_executions
            WHERE run_id = ? AND status = ?
            "#,
        )
        .bind(run_id)
        .bind(node_status_value(*status))
        .fetch_all(pool)
        .await?;

        for row in rows {
            let node_id: String = row.try_get("node_id")?;
            let iteration: i64 = row.try_get("iteration")?;
            mark_node_failed(pool, run_id, &node_id, iteration, message).await?;
        }
    }

    Ok(())
}

async fn mark_pending_nodes_skipped(pool: &SqlitePool, run_id: Uuid) -> Result<(), ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id, node_id, iteration
        FROM node_executions
        WHERE run_id = ? AND status = 'pending'
        ORDER BY rowid ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    for row in rows {
        let execution_id: Uuid = row.try_get("id")?;
        let node_id: String = row.try_get("node_id")?;
        let iteration: i64 = row.try_get("iteration")?;
        let result = sqlx::query(
            r#"
            UPDATE node_executions
            SET status = 'skipped',
                finished_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE id = ? AND status = 'pending'
            "#,
        )
        .bind(execution_id)
        .execute(pool)
        .await?;
        if result.rows_affected() > 0 {
            emit_node_status(
                run_id,
                &node_id,
                DbNodeExecutionStatus::Skipped,
                json!({ "status": "skipped", "iteration": iteration }),
            );
        }
    }

    Ok(())
}

async fn reset_node_for_retry(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
) -> Result<(), ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE node_executions
        SET status = 'pending',
            input_text = NULL,
            output_text = NULL,
            session_id = NULL,
            execution_process_id = NULL,
            arena_group_id = NULL,
            tokens_used = NULL,
            cost_estimate = NULL,
            started_at = NULL,
            finished_at = NULL,
            error_text = NULL,
            updated_at = datetime('now', 'subsec')
        WHERE run_id = ? AND node_id = ? AND iteration = 0
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        emit_node_status(
            run_id,
            node_id,
            DbNodeExecutionStatus::Pending,
            json!({ "status": "pending", "retry": true }),
        );
    }

    Ok(())
}

async fn reset_downstream_skipped_nodes(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
    node_id: &str,
) -> Result<(), ApiError> {
    for downstream_id in downstream_node_ids(graph, node_id) {
        let result = sqlx::query(
            r#"
            UPDATE node_executions
            SET status = 'pending',
                input_text = NULL,
                output_text = NULL,
                session_id = NULL,
                execution_process_id = NULL,
                arena_group_id = NULL,
                tokens_used = NULL,
                cost_estimate = NULL,
                started_at = NULL,
                finished_at = NULL,
                error_text = NULL,
                updated_at = datetime('now', 'subsec')
            WHERE run_id = ? AND node_id = ? AND iteration = 0 AND status = 'skipped'
            "#,
        )
        .bind(run_id)
        .bind(&downstream_id)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            emit_node_status(
                run_id,
                &downstream_id,
                DbNodeExecutionStatus::Pending,
                json!({ "status": "pending", "retry": true }),
            );
        }
    }

    Ok(())
}

fn downstream_node_ids(graph: &WorkflowGraph, node_id: &str) -> Vec<String> {
    let mut downstream = Vec::new();
    let mut stack = graph
        .edges
        .iter()
        .filter(|edge| edge.source == node_id)
        .map(|edge| edge.target.clone())
        .collect::<Vec<_>>();

    while let Some(next) = stack.pop() {
        if downstream.contains(&next) {
            continue;
        }
        stack.extend(
            graph
                .edges
                .iter()
                .filter(|edge| edge.source == next)
                .map(|edge| edge.target.clone()),
        );
        downstream.push(next);
    }

    downstream
}

#[derive(Debug, Clone, Copy)]
struct NodeExecutionUpdate<'a> {
    status: DbNodeExecutionStatus,
    input_text: Option<&'a str>,
    output_text: Option<&'a str>,
    session_id: Option<Uuid>,
    execution_process_id: Option<Uuid>,
    arena_group_id: Option<Uuid>,
    error_text: Option<&'a str>,
    finished: bool,
}

async fn update_node_execution(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    iteration: i64,
    update: NodeExecutionUpdate<'_>,
) -> Result<(), ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE node_executions
        SET status = ?,
            input_text = COALESCE(?, input_text),
            output_text = COALESCE(?, output_text),
            session_id = COALESCE(?, session_id),
            execution_process_id = COALESCE(?, execution_process_id),
            arena_group_id = COALESCE(?, arena_group_id),
            error_text = ?,
            started_at = COALESCE(started_at, datetime('now', 'subsec')),
            finished_at = CASE WHEN ? THEN datetime('now', 'subsec') ELSE finished_at END,
            updated_at = datetime('now', 'subsec')
        WHERE run_id = ? AND node_id = ? AND iteration = ?
        "#,
    )
    .bind(node_status_value(update.status))
    .bind(update.input_text)
    .bind(update.output_text)
    .bind(update.session_id)
    .bind(update.execution_process_id)
    .bind(update.arena_group_id)
    .bind(update.error_text)
    .bind(update.finished)
    .bind(run_id)
    .bind(node_id)
    .bind(iteration)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        emit_node_update(run_id, node_id, iteration, update);
    }

    Ok(())
}

async fn update_run_status(
    pool: &SqlitePool,
    run_id: Uuid,
    status: WorkflowRunStatus,
    output_text: Option<String>,
    error_text: Option<&str>,
    finished: bool,
) -> Result<(), ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE workflow_runs
        SET status = ?,
            output_text = ?,
            error_text = ?,
            finished_at = CASE WHEN ? THEN datetime('now', 'subsec') ELSE NULL END,
            updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(run_status_value(status))
    .bind(output_text.as_deref())
    .bind(error_text)
    .bind(finished)
    .bind(run_id)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        emit_run_status(run_id, status, output_text.as_deref(), error_text);
    }

    Ok(())
}

fn emit_run_status(
    run_id: Uuid,
    status: WorkflowRunStatus,
    output_text: Option<&str>,
    error_text: Option<&str>,
) {
    let status_value = run_status_value(status);
    WORKFLOW_EVENT_HUB.publish(WorkflowEvent::run_status(
        run_id.to_string(),
        status_value,
        json!({
            "status": status_value,
            "output_text": output_text,
            "error_text": error_text,
        }),
    ));
}

fn emit_node_update(run_id: Uuid, node_id: &str, iteration: i64, update: NodeExecutionUpdate<'_>) {
    let status_value = node_status_value(update.status);
    emit_node_status(
        run_id,
        node_id,
        update.status,
        json!({
            "status": status_value,
            "iteration": iteration,
            "input_text": update.input_text,
            "output_text": update.output_text,
            "session_id": update.session_id,
            "execution_process_id": update.execution_process_id,
            "arena_group_id": update.arena_group_id,
            "error_text": update.error_text,
        }),
    );

    if let Some(output_text) = update.output_text {
        WORKFLOW_EVENT_HUB.publish(WorkflowEvent::node_output(
            run_id.to_string(),
            node_id.to_string(),
            json!({ "output_text": output_text }),
        ));
    }
    if let Some(error_text) = update.error_text {
        WORKFLOW_EVENT_HUB.publish(WorkflowEvent::node_error(
            run_id.to_string(),
            node_id.to_string(),
            json!({ "error_text": error_text }),
        ));
    }
    if update.status == DbNodeExecutionStatus::AwaitingHuman {
        WORKFLOW_EVENT_HUB.publish(WorkflowEvent::node_waiting_human(
            run_id.to_string(),
            node_id.to_string(),
            json!({ "prompt": update.input_text }),
        ));
    }
    if update.status == DbNodeExecutionStatus::AwaitingArena {
        WORKFLOW_EVENT_HUB.publish(WorkflowEvent::node_waiting_arena(
            run_id.to_string(),
            node_id.to_string(),
            json!({
                "prompt": update.input_text,
                "arena_group_id": update.arena_group_id,
            }),
        ));
    }
}

fn emit_node_status(run_id: Uuid, node_id: &str, status: DbNodeExecutionStatus, payload: Value) {
    WORKFLOW_EVENT_HUB.publish(WorkflowEvent::node_status(
        run_id.to_string(),
        node_id.to_string(),
        node_status_value(status),
        payload,
    ));
}

async fn node_execution_responses(
    pool: &SqlitePool,
    run_id: Uuid,
) -> Result<Vec<WorkflowNodeExecutionResponse>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id, run_id, node_id, node_type, iteration, status, input_text, output_text,
               session_id, execution_process_id, arena_group_id, tokens_used, cost_estimate,
               started_at, finished_at, error_text, created_at, updated_at
        FROM node_executions
        WHERE run_id = ?
        ORDER BY rowid ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(node_execution_response_from_row)
        .collect::<Result<Vec<_>, _>>()?)
}

fn node_execution_response_from_row(
    row: &SqliteRow,
) -> Result<WorkflowNodeExecutionResponse, WorkflowRuntimeError> {
    Ok(WorkflowNodeExecutionResponse {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        node_id: row.try_get("node_id")?,
        node_type: row.try_get("node_type")?,
        iteration: row.try_get("iteration")?,
        status: node_execution_status_from_str(&row.try_get::<String, _>("status")?)?,
        input_text: row.try_get("input_text")?,
        output_text: row.try_get("output_text")?,
        session_id: row.try_get("session_id")?,
        execution_process_id: row.try_get("execution_process_id")?,
        arena_group_id: row.try_get("arena_group_id")?,
        tokens_used: row.try_get("tokens_used")?,
        cost_estimate: row.try_get("cost_estimate")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        error_text: row.try_get("error_text")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn executor_config_from_node(value: Option<Value>) -> Result<ExecutorConfig, ApiError> {
    if let Some(value) = value {
        return serde_json::from_value(value).map_err(|err| {
            ApiError::BadRequest(format!("Invalid workflow agent executor config: {err}"))
        });
    }

    let profile_id = ExecutorConfigs::get_cached()
        .get_recommended_executor_profile()
        .await
        .map_err(|err| {
            ApiError::BadRequest(format!(
                "No available executor profile for workflow agent: {err}"
            ))
        })?;
    Ok(ExecutorConfig::from(profile_id))
}

fn workflow_run_status_from_str(value: &str) -> Result<WorkflowRunStatus, WorkflowRuntimeError> {
    match value {
        "pending" => Ok(WorkflowRunStatus::Pending),
        "running" => Ok(WorkflowRunStatus::Running),
        "awaiting_human" => Ok(WorkflowRunStatus::AwaitingHuman),
        "awaiting_arena" => Ok(WorkflowRunStatus::AwaitingArena),
        "succeeded" => Ok(WorkflowRunStatus::Succeeded),
        "failed" => Ok(WorkflowRunStatus::Failed),
        "canceled" => Ok(WorkflowRunStatus::Canceled),
        other => Err(WorkflowRuntimeError::BadRequest(format!(
            "Unknown workflow run status `{other}`"
        ))),
    }
}

fn node_execution_status_from_str(
    value: &str,
) -> Result<DbNodeExecutionStatus, WorkflowRuntimeError> {
    match value {
        "pending" => Ok(DbNodeExecutionStatus::Pending),
        "running" => Ok(DbNodeExecutionStatus::Running),
        "awaiting_human" => Ok(DbNodeExecutionStatus::AwaitingHuman),
        "awaiting_arena" => Ok(DbNodeExecutionStatus::AwaitingArena),
        "succeeded" => Ok(DbNodeExecutionStatus::Succeeded),
        "failed" => Ok(DbNodeExecutionStatus::Failed),
        "skipped" => Ok(DbNodeExecutionStatus::Skipped),
        other => Err(WorkflowRuntimeError::BadRequest(format!(
            "Unknown node execution status `{other}`"
        ))),
    }
}

fn planner_status_from_str(
    value: &str,
) -> Result<PlannerNodeExecutionStatus, WorkflowRuntimeError> {
    Ok(match node_execution_status_from_str(value)? {
        DbNodeExecutionStatus::Pending => PlannerNodeExecutionStatus::Pending,
        DbNodeExecutionStatus::Running => PlannerNodeExecutionStatus::Running,
        DbNodeExecutionStatus::AwaitingHuman => PlannerNodeExecutionStatus::AwaitingHuman,
        DbNodeExecutionStatus::AwaitingArena => PlannerNodeExecutionStatus::AwaitingArena,
        DbNodeExecutionStatus::Succeeded => PlannerNodeExecutionStatus::Succeeded,
        DbNodeExecutionStatus::Failed => PlannerNodeExecutionStatus::Failed,
        DbNodeExecutionStatus::Skipped => PlannerNodeExecutionStatus::Skipped,
    })
}

fn run_status_value(status: WorkflowRunStatus) -> &'static str {
    match status {
        WorkflowRunStatus::Pending => "pending",
        WorkflowRunStatus::Running => "running",
        WorkflowRunStatus::AwaitingHuman => "awaiting_human",
        WorkflowRunStatus::AwaitingArena => "awaiting_arena",
        WorkflowRunStatus::Succeeded => "succeeded",
        WorkflowRunStatus::Failed => "failed",
        WorkflowRunStatus::Canceled => "canceled",
    }
}

fn node_status_value(status: DbNodeExecutionStatus) -> &'static str {
    match status {
        DbNodeExecutionStatus::Pending => "pending",
        DbNodeExecutionStatus::Running => "running",
        DbNodeExecutionStatus::AwaitingHuman => "awaiting_human",
        DbNodeExecutionStatus::AwaitingArena => "awaiting_arena",
        DbNodeExecutionStatus::Succeeded => "succeeded",
        DbNodeExecutionStatus::Failed => "failed",
        DbNodeExecutionStatus::Skipped => "skipped",
    }
}

fn node_kind_value(kind: &WorkflowNodeKind) -> &'static str {
    match kind {
        WorkflowNodeKind::Start => "start",
        WorkflowNodeKind::End => "end",
        WorkflowNodeKind::Agent => "agent",
        WorkflowNodeKind::Condition => "condition",
        WorkflowNodeKind::HumanGate => "human_gate",
        WorkflowNodeKind::Transform => "transform",
        WorkflowNodeKind::Arena => "arena",
    }
}
