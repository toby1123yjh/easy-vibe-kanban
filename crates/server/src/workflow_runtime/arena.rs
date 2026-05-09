use async_trait::async_trait;
use db::models::{
    arena_group::{ArenaGroup, ArenaMode, ArenaStatus, CreateArenaGroup},
    requests::WorkspaceRepoInput,
    workspace::{CreateWorkspace, Workspace, WorkspaceError},
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::profile::{ExecutorConfig, ExecutorConfigs};
use serde_json::Value;
use services::services::container::ContainerService;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const WORKFLOW_ARENA_MIN_ATTEMPTS: usize = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct ArenaNodeAttemptRequest {
    pub attempt_id: Option<String>,
    pub display_name: Option<String>,
    pub branch_name: String,
    pub prompt: String,
    pub executor_config: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArenaNodeRequest {
    pub run_id: Uuid,
    pub node_id: String,
    pub issue_id: Uuid,
    pub main_workspace_id: Uuid,
    pub prompt: String,
    pub attempts: Vec<ArenaNodeAttemptRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArenaNodeExecution {
    pub arena_group_id: Uuid,
}

#[async_trait]
pub trait WorkflowArenaCreator: Send + Sync {
    async fn create_arena(&self, request: ArenaNodeRequest)
    -> Result<ArenaNodeExecution, ApiError>;
}

#[derive(Debug, Clone, Copy)]
pub struct NoopWorkflowArenaCreator;

#[async_trait]
impl WorkflowArenaCreator for NoopWorkflowArenaCreator {
    async fn create_arena(
        &self,
        _request: ArenaNodeRequest,
    ) -> Result<ArenaNodeExecution, ApiError> {
        Err(ApiError::BadRequest(
            "Workflow arena nodes require an arena creator".to_string(),
        ))
    }
}

#[derive(Clone)]
pub struct DeploymentWorkflowArenaCreator {
    deployment: DeploymentImpl,
}

impl DeploymentWorkflowArenaCreator {
    pub fn new(deployment: DeploymentImpl) -> Self {
        Self { deployment }
    }
}

#[async_trait]
impl WorkflowArenaCreator for DeploymentWorkflowArenaCreator {
    async fn create_arena(
        &self,
        request: ArenaNodeRequest,
    ) -> Result<ArenaNodeExecution, ApiError> {
        create_deployment_arena(&self.deployment, request).await
    }
}

async fn create_deployment_arena(
    deployment: &DeploymentImpl,
    request: ArenaNodeRequest,
) -> Result<ArenaNodeExecution, ApiError> {
    if request.attempts.len() < WORKFLOW_ARENA_MIN_ATTEMPTS {
        return Err(ApiError::BadRequest(format!(
            "Workflow arena requires at least {WORKFLOW_ARENA_MIN_ATTEMPTS} attempts, got {}",
            request.attempts.len()
        )));
    }
    if request.prompt.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Workflow arena prompt must not be empty.".to_string(),
        ));
    }

    let pool = &deployment.db().pool;
    let project_id = issue_project_id(pool, request.issue_id).await?;
    let main_workspace = Workspace::find_by_id(pool, request.main_workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::WorkspaceNotFound))?;
    let base_repos = WorkspaceRepo::find_by_workspace_id(pool, main_workspace.id).await?;
    if base_repos.is_empty() {
        return Err(ApiError::BadRequest(
            "Workflow arena requires the main workflow workspace to have at least one repository"
                .to_string(),
        ));
    }

    if ArenaGroup::find_active_by_issue_id(pool, request.issue_id)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(format!(
            "issue {} already has an active arena group; close, adopt, promote, or dissolve it first",
            request.issue_id
        )));
    }

    let group = ArenaGroup::create(
        pool,
        &CreateArenaGroup {
            issue_id: request.issue_id,
            project_id,
            prompt: request.prompt.clone(),
            base_branch: main_workspace.branch.clone(),
            mode: ArenaMode::Implementation,
        },
    )
    .await?;

    for (idx, attempt) in request.attempts.into_iter().enumerate() {
        spawn_workflow_arena_attempt(
            deployment,
            pool,
            &group,
            project_id,
            request.issue_id,
            &main_workspace,
            &base_repos,
            attempt,
            idx,
        )
        .await?;
    }

    deployment
        .track_if_analytics_allowed(
            "workflow_arena_group_created",
            serde_json::json!({
                "arena_group_id": group.id.to_string(),
                "issue_id": request.issue_id.to_string(),
                "run_id": request.run_id.to_string(),
                "node_id": request.node_id,
            }),
        )
        .await;

    Ok(ArenaNodeExecution {
        arena_group_id: group.id,
    })
}

async fn issue_project_id(pool: &SqlitePool, issue_id: Uuid) -> Result<Uuid, ApiError> {
    sqlx::query_scalar::<_, Uuid>("SELECT project_id FROM local_issues WHERE id = ?")
        .bind(issue_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::BadRequest(format!("issue {issue_id} was not found")))
}

#[allow(clippy::too_many_arguments)]
async fn spawn_workflow_arena_attempt(
    deployment: &DeploymentImpl,
    pool: &SqlitePool,
    group: &ArenaGroup,
    project_id: Uuid,
    issue_id: Uuid,
    main_workspace: &Workspace,
    base_repos: &[WorkspaceRepo],
    attempt: ArenaNodeAttemptRequest,
    attempt_index: usize,
) -> Result<(), ApiError> {
    let prompt = attempt.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "Workflow arena attempt {} prompt must not be empty.",
            attempt_index + 1
        )));
    }

    let workspace_name = attempt.display_name.clone().unwrap_or_else(|| {
        attempt
            .attempt_id
            .clone()
            .unwrap_or_else(|| format!("Arena Candidate {}", attempt_index + 1))
    });
    let executor_config = executor_config_from_value(attempt.executor_config).await?;
    let workspace_id = Uuid::new_v4();
    let workspace = Workspace::create(
        pool,
        &CreateWorkspace {
            branch: attempt.branch_name,
            name: Some(workspace_name),
        },
        workspace_id,
    )
    .await?;

    let mut managed_workspace = deployment
        .workspace_manager()
        .load_managed_workspace(workspace)
        .await?;
    for repo in base_repos {
        let repo_input = WorkspaceRepoInput {
            repo_id: repo.repo_id,
            target_branch: main_workspace.branch.clone(),
        };
        managed_workspace
            .add_repository(&repo_input, deployment.git())
            .await
            .map_err(ApiError::from)?;
    }

    let workspace = managed_workspace.workspace.clone();
    Workspace::set_arena_group_id(pool, workspace.id, Some(group.id)).await?;
    Workspace::set_arena_status(pool, workspace.id, ArenaStatus::Active).await?;
    insert_workspace_link(pool, workspace.id, project_id, issue_id).await?;

    deployment
        .container()
        .start_workspace(&workspace, executor_config, prompt)
        .await?;

    Ok(())
}

async fn executor_config_from_value(value: Option<Value>) -> Result<ExecutorConfig, ApiError> {
    if let Some(value) = value {
        return serde_json::from_value(value).map_err(|err| {
            ApiError::BadRequest(format!(
                "Invalid workflow arena attempt executor config: {err}"
            ))
        });
    }

    let profile_id = ExecutorConfigs::get_cached()
        .get_recommended_executor_profile()
        .await
        .map_err(|err| {
            ApiError::BadRequest(format!(
                "No available executor profile for workflow arena attempt: {err}"
            ))
        })?;
    Ok(ExecutorConfig::from(profile_id))
}

async fn insert_workspace_link(
    pool: &SqlitePool,
    workspace_id: Uuid,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"INSERT INTO local_workspace_links
               (workspace_id, project_id, issue_id)
           VALUES (?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE
               SET project_id = excluded.project_id,
                   issue_id   = excluded.issue_id,
                   updated_at = datetime('now', 'subsec')"#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(issue_id)
    .execute(pool)
    .await?;
    Ok(())
}
