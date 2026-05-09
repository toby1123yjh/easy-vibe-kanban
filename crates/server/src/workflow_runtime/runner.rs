use std::sync::{LazyLock, Mutex};

use async_trait::async_trait;
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus},
    session::{CreateSession, Session},
    workflow::{NodeExecutionStatus as DbNodeExecutionStatus, WorkflowRunStatus},
    workspace::{Workspace, WorkspaceError},
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType, coding_agent_initial::CodingAgentInitialRequest,
    },
    profile::{ExecutorConfig, ExecutorConfigs},
};
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
    validation::validate_graph,
};

use crate::{
    DeploymentImpl,
    error::ApiError,
    routes::workflows::{
        TriggerWorkflowRequest, WorkflowNodeExecutionResponse, WorkflowRunResponse,
        get_workflow_template,
    },
    workflow_runtime::{
        arena::{
            ArenaNodeAttemptRequest, ArenaNodeExecution, ArenaNodeRequest,
            NoopWorkflowArenaCreator, WorkflowArenaCreator,
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
    pub existing_workspace_id: Option<Uuid>,
    pub branch_name: String,
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
    pub workspace_id: Uuid,
    pub prompt: String,
    pub executor_config: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentNodeExecution {
    Completed {
        session_id: Uuid,
        output_text: String,
    },
    Started {
        session_id: Uuid,
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

        self.deployment
            .container()
            .ensure_container_exists(&workspace)
            .await?;

        let session = Session::create(
            pool,
            &CreateSession {
                executor: Some(executor_config.profile_id().executor.to_string()),
                name: Some(format!("Workflow {}", request.node_id)),
            },
            Uuid::new_v4(),
            workspace.id,
        )
        .await?;

        let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
        let cleanup_action = self
            .deployment
            .container()
            .cleanup_actions_for_repos(&repos);
        let working_dir = session
            .agent_working_dir
            .as_ref()
            .filter(|dir| !dir.is_empty())
            .cloned();

        let action = ExecutorAction::new(
            ExecutorActionType::CodingAgentInitialRequest(CodingAgentInitialRequest {
                prompt: request.prompt,
                selected_skills: None,
                executor_config,
                working_dir,
            }),
            cleanup_action.map(Box::new),
        );

        let execution_process = self
            .deployment
            .container()
            .start_execution(
                &workspace,
                &session,
                &action,
                &ExecutionProcessRunReason::CodingAgent,
            )
            .await?;

        Ok(AgentNodeExecution::Started {
            session_id: session.id,
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
    let workflow = get_workflow_template(pool, workflow_id).await?;
    let graph: WorkflowGraph = serde_json::from_str(&workflow.graph_json)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}")))?;
    validate_graph(&graph)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph: {err}")))?;

    let run_id = Uuid::new_v4();
    let workspace_id = workspace_resolver
        .create_or_bind_main_workspace(WorkflowWorkspaceRequest {
            issue_id: request.issue_id,
            run_id,
            existing_workspace_id: request.workspace_id,
            branch_name: main_workflow_branch_name(request.issue_id, run_id),
        })
        .await?;

    insert_workflow_run(pool, run_id, workflow_id, workspace_id, &request).await?;
    initialize_node_executions(pool, run_id, &graph).await?;
    drive_workflow_run(
        pool,
        run_id,
        &graph,
        request.issue_id,
        workspace_id,
        &request.input_text,
        agent_executor,
        arena_creator,
    )
    .await?;

    get_workflow_run_response(pool, run_id).await
}

pub async fn get_workflow_run_response(
    pool: &SqlitePool,
    run_id: Uuid,
) -> Result<WorkflowRunResponse, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, workflow_id, issue_id, workspace_id, trigger_source, input_text,
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
    mark_node_succeeded(pool, run_id, node_id, Some(&approval_output), None).await?;
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

pub async fn reject_human_node(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
) -> Result<WorkflowRunResponse, ApiError> {
    ensure_node_status(pool, run_id, node_id, DbNodeExecutionStatus::AwaitingHuman).await?;

    let message = "Human gate rejected";
    mark_node_failed(pool, run_id, node_id, message).await?;
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
        recovered += 1;
    }

    Ok(recovered)
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
    validate_graph(&graph)
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
    workspace_id: Uuid,
    request: &TriggerWorkflowRequest,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, issue_id, workspace_id, trigger_source, input_text, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now', 'subsec'))
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
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
                issue_id,
                workspace_id,
                run_input_text,
                agent_executor,
                arena_creator,
            )
            .await?;
            if step == RunStep::Wait {
                return Ok(());
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunStep {
    Continue,
    Wait,
}

async fn execute_ready_node<A, R>(
    pool: &SqlitePool,
    run_id: Uuid,
    graph: &WorkflowGraph,
    node: &WorkflowNode,
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
            mark_node_running(pool, run_id, &node.id, Some(&prompt)).await?;
            match agent_executor
                .run_agent(AgentNodeRequest {
                    run_id,
                    node_id: node.id.clone(),
                    workspace_id,
                    prompt,
                    executor_config: node.data.executor_config.clone(),
                })
                .await
            {
                Ok(AgentNodeExecution::Completed {
                    session_id,
                    output_text,
                }) => {
                    mark_node_succeeded(
                        pool,
                        run_id,
                        &node.id,
                        Some(&output_text),
                        Some(session_id),
                    )
                    .await?;
                    Ok(RunStep::Continue)
                }
                Ok(AgentNodeExecution::Started {
                    session_id,
                    output_text,
                }) => {
                    update_node_execution(
                        pool,
                        run_id,
                        &node.id,
                        NodeExecutionUpdate {
                            status: DbNodeExecutionStatus::Running,
                            input_text: None,
                            output_text: output_text.as_deref(),
                            session_id: Some(session_id),
                            arena_group_id: None,
                            error_text: None,
                            finished: false,
                        },
                    )
                    .await?;
                    Ok(RunStep::Wait)
                }
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, &message).await?;
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
                    Ok(RunStep::Wait)
                }
            }
        }
        WorkflowNodeKind::Arena => {
            let prompt = render_arena_prompt(node, &context);
            mark_node_running(pool, run_id, &node.id, Some(&prompt)).await?;
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
                        NodeExecutionUpdate {
                            status: DbNodeExecutionStatus::AwaitingArena,
                            input_text: Some(&prompt),
                            output_text: None,
                            session_id: None,
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
                    Ok(RunStep::Wait)
                }
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, &message).await?;
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
                    Ok(RunStep::Wait)
                }
            }
        }
        _ => {
            let input_text = context.upstream_text();
            mark_node_running(pool, run_id, &node.id, Some(&input_text)).await?;
            let outgoing_edges = outgoing_edges(graph, &node.id);
            match handle_pure_node(node, &outgoing_edges, &context) {
                Ok(outcome) => match outcome.status {
                    NodeHandlerStatus::Succeeded => {
                        mark_node_succeeded(
                            pool,
                            run_id,
                            &node.id,
                            outcome.output_text.as_deref(),
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
                            NodeExecutionUpdate {
                                status: DbNodeExecutionStatus::AwaitingHuman,
                                input_text: outcome.prompt.as_deref(),
                                output_text: None,
                                session_id: None,
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
                        Ok(RunStep::Wait)
                    }
                    NodeHandlerStatus::AwaitingArena => {
                        update_node_execution(
                            pool,
                            run_id,
                            &node.id,
                            NodeExecutionUpdate {
                                status: DbNodeExecutionStatus::AwaitingArena,
                                input_text: outcome.prompt.as_deref(),
                                output_text: None,
                                session_id: None,
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
                        Ok(RunStep::Wait)
                    }
                },
                Err(err) => {
                    let message = err.to_string();
                    mark_node_failed(pool, run_id, &node.id, &message).await?;
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
                    Ok(RunStep::Wait)
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
            WHERE run_id = ? AND node_id = ? AND iteration = 0
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
        node.data
            .prompt_template
            .as_deref()
            .unwrap_or("{{upstream}}"),
        context,
    )
}

fn render_arena_prompt(node: &WorkflowNode, context: &NodeHandlerContext) -> String {
    render_prompt_template(
        node.data
            .prompt_template
            .as_deref()
            .unwrap_or("{{upstream}}"),
        context,
    )
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
        SELECT node_id, status, output_text, error_text
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
    input_text: Option<&str>,
) -> Result<(), ApiError> {
    update_node_execution(
        pool,
        run_id,
        node_id,
        NodeExecutionUpdate {
            status: DbNodeExecutionStatus::Running,
            input_text,
            output_text: None,
            session_id: None,
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
    output_text: Option<&str>,
    session_id: Option<Uuid>,
) -> Result<(), ApiError> {
    update_node_execution(
        pool,
        run_id,
        node_id,
        NodeExecutionUpdate {
            status: DbNodeExecutionStatus::Succeeded,
            input_text: None,
            output_text,
            session_id,
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
    error_text: &str,
) -> Result<(), ApiError> {
    update_node_execution(
        pool,
        run_id,
        node_id,
        NodeExecutionUpdate {
            status: DbNodeExecutionStatus::Failed,
            input_text: None,
            output_text: None,
            session_id: None,
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
        let result = sqlx::query(
            r#"
            UPDATE node_executions
            SET status = 'skipped',
                finished_at = datetime('now', 'subsec'),
                updated_at = datetime('now', 'subsec')
            WHERE run_id = ? AND node_id = ? AND iteration = 0 AND status = 'pending'
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
                DbNodeExecutionStatus::Skipped,
                json!({ "status": "skipped" }),
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
            SELECT node_id
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
            mark_node_failed(pool, run_id, &node_id, message).await?;
        }
    }

    Ok(())
}

async fn mark_pending_nodes_skipped(pool: &SqlitePool, run_id: Uuid) -> Result<(), ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT node_id
        FROM node_executions
        WHERE run_id = ? AND status = 'pending'
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    let node_ids = rows
        .iter()
        .map(|row| row.try_get("node_id"))
        .collect::<Result<Vec<String>, _>>()?;
    mark_skipped_targets(pool, run_id, &node_ids).await
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
    arena_group_id: Option<Uuid>,
    error_text: Option<&'a str>,
    finished: bool,
}

async fn update_node_execution(
    pool: &SqlitePool,
    run_id: Uuid,
    node_id: &str,
    update: NodeExecutionUpdate<'_>,
) -> Result<(), ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE node_executions
        SET status = ?,
            input_text = COALESCE(?, input_text),
            output_text = COALESCE(?, output_text),
            session_id = COALESCE(?, session_id),
            arena_group_id = COALESCE(?, arena_group_id),
            error_text = ?,
            started_at = COALESCE(started_at, datetime('now', 'subsec')),
            finished_at = CASE WHEN ? THEN datetime('now', 'subsec') ELSE finished_at END,
            updated_at = datetime('now', 'subsec')
        WHERE run_id = ? AND node_id = ? AND iteration = 0
        "#,
    )
    .bind(node_status_value(update.status))
    .bind(update.input_text)
    .bind(update.output_text)
    .bind(update.session_id)
    .bind(update.arena_group_id)
    .bind(update.error_text)
    .bind(update.finished)
    .bind(run_id)
    .bind(node_id)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        emit_node_update(run_id, node_id, update);
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
    .bind(output_text)
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

fn emit_node_update(run_id: Uuid, node_id: &str, update: NodeExecutionUpdate<'_>) {
    let status_value = node_status_value(update.status);
    emit_node_status(
        run_id,
        node_id,
        update.status,
        json!({
            "status": status_value,
            "input_text": update.input_text,
            "output_text": update.output_text,
            "session_id": update.session_id,
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
               session_id, arena_group_id, tokens_used, cost_estimate, started_at, finished_at,
               error_text, created_at, updated_at
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
