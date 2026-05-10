use std::collections::HashMap;

use async_trait::async_trait;
use db::models::{
    arena_group::{ArenaGroup, ArenaGroupError, ArenaMode, ArenaStatus, CreateArenaGroup},
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArenaWinnerRequest {
    pub run_id: Uuid,
    pub node_id: String,
    pub arena_group_id: Uuid,
    pub main_workspace_id: Uuid,
    pub winner_workspace_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArenaWinnerExecution {
    pub output_text: String,
}

#[async_trait]
pub trait WorkflowArenaCreator: Send + Sync {
    async fn create_arena(&self, request: ArenaNodeRequest)
    -> Result<ArenaNodeExecution, ApiError>;
}

#[async_trait]
pub trait WorkflowArenaWinnerApplier: Send + Sync {
    async fn apply_winner(
        &self,
        request: ArenaWinnerRequest,
    ) -> Result<ArenaWinnerExecution, ApiError>;
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

#[derive(Clone)]
pub struct DeploymentWorkflowArenaWinnerApplier {
    deployment: DeploymentImpl,
}

impl DeploymentWorkflowArenaWinnerApplier {
    pub fn new(deployment: DeploymentImpl) -> Self {
        Self { deployment }
    }
}

#[async_trait]
impl WorkflowArenaWinnerApplier for DeploymentWorkflowArenaWinnerApplier {
    async fn apply_winner(
        &self,
        request: ArenaWinnerRequest,
    ) -> Result<ArenaWinnerExecution, ApiError> {
        apply_deployment_arena_winner(&self.deployment, request).await
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

async fn apply_deployment_arena_winner(
    deployment: &DeploymentImpl,
    request: ArenaWinnerRequest,
) -> Result<ArenaWinnerExecution, ApiError> {
    let pool = &deployment.db().pool;
    let group = ArenaGroup::find_by_id(pool, request.arena_group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;
    if group.promoted_workspace_id.is_some() {
        return Err(ApiError::from(ArenaGroupError::AlreadyPromoted {
            group_id: group.id,
        }));
    }
    let main_workspace = Workspace::find_by_id(pool, request.main_workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::WorkspaceNotFound))?;
    let winner_workspace = Workspace::find_by_id(pool, request.winner_workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::WorkspaceNotFound))?;

    if winner_workspace.arena_group_id != Some(request.arena_group_id) {
        return Err(ApiError::from(ArenaGroupError::WorkspaceNotInGroup {
            group_id: request.arena_group_id,
            workspace_id: request.winner_workspace_id,
        }));
    }

    let main_root = deployment
        .container()
        .ensure_container_exists(&main_workspace)
        .await?;
    let winner_root = deployment
        .container()
        .ensure_container_exists(&winner_workspace)
        .await?;
    let main_root = std::path::PathBuf::from(main_root);
    let winner_root = std::path::PathBuf::from(winner_root);

    let main_repos =
        WorkspaceRepo::find_repos_with_target_branch_for_workspace(pool, main_workspace.id).await?;
    let winner_repos =
        WorkspaceRepo::find_repos_with_target_branch_for_workspace(pool, winner_workspace.id)
            .await?;
    let winner_by_repo_id = winner_repos
        .iter()
        .map(|repo| (repo.repo.id, repo))
        .collect::<HashMap<_, _>>();

    let mut changed_files = 0usize;
    let mut changed_repos = Vec::new();

    for main_repo in &main_repos {
        let winner_repo = winner_by_repo_id.get(&main_repo.repo.id).ok_or_else(|| {
            ApiError::BadRequest(format!(
                "Winner workspace {} is missing repository {}",
                winner_workspace.id, main_repo.repo.name
            ))
        })?;
        let main_repo_path = main_root.join(&main_repo.repo.name);
        let winner_repo_path = winner_root.join(&winner_repo.repo.name);
        let base_commit = deployment.git().get_base_commit(
            &winner_repo_path,
            &winner_workspace.branch,
            &winner_repo.target_branch,
        )?;
        let file_paths = deployment
            .git()
            .get_diff_file_paths(&winner_repo_path, &base_commit)?;
        let patch = deployment
            .git()
            .get_diff_patch(&winner_repo_path, &base_commit)?;

        if patch.is_empty() {
            continue;
        }

        deployment.git().apply_patch(&main_repo_path, &patch)?;
        changed_files += file_paths.len();
        changed_repos.push(main_repo.repo.name.clone());
    }

    mark_arena_winner(pool, request.arena_group_id, request.winner_workspace_id).await?;

    let winner_summary = latest_workspace_summary_text(pool, request.winner_workspace_id)
        .await?
        .unwrap_or_else(|| {
            format!(
                "Selected arena winner workspace {}",
                request.winner_workspace_id
            )
        });
    let diff_summary = if changed_repos.is_empty() {
        "No file changes were applied from the winner workspace.".to_string()
    } else {
        format!(
            "Applied {changed_files} changed file(s) from {}.",
            changed_repos.join(", ")
        )
    };
    let output_text = if winner_summary.trim().is_empty() {
        diff_summary
    } else {
        format!("{winner_summary}\n\n{diff_summary}")
    };

    deployment
        .track_if_analytics_allowed(
            "workflow_arena_winner_applied",
            serde_json::json!({
                "arena_group_id": request.arena_group_id.to_string(),
                "winner_workspace_id": request.winner_workspace_id.to_string(),
                "run_id": request.run_id.to_string(),
                "node_id": request.node_id,
                "changed_files": changed_files,
            }),
        )
        .await;

    Ok(ArenaWinnerExecution { output_text })
}

async fn mark_arena_winner(
    pool: &SqlitePool,
    arena_group_id: Uuid,
    winner_workspace_id: Uuid,
) -> Result<(), ApiError> {
    let siblings = Workspace::find_by_arena_group_id(pool, arena_group_id).await?;
    if !siblings
        .iter()
        .any(|workspace| workspace.id == winner_workspace_id)
    {
        return Err(ApiError::from(ArenaGroupError::WorkspaceNotInGroup {
            group_id: arena_group_id,
            workspace_id: winner_workspace_id,
        }));
    }

    Workspace::set_arena_status(pool, winner_workspace_id, ArenaStatus::Promoted).await?;
    ArenaGroup::set_promoted(pool, arena_group_id, winner_workspace_id).await?;
    for sibling in siblings {
        if sibling.id == winner_workspace_id {
            continue;
        }
        Workspace::set_arena_status(pool, sibling.id, ArenaStatus::Archived).await?;
        Workspace::set_archived(pool, sibling.id, true).await?;
    }

    Ok(())
}

async fn latest_workspace_summary_text(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Option<String>, ApiError> {
    Ok(sqlx::query_scalar::<_, String>(
        r#"
        SELECT cat.summary
        FROM coding_agent_turns cat
        JOIN execution_processes ep ON ep.id = cat.execution_process_id
        JOIN sessions s ON s.id = ep.session_id
        WHERE s.workspace_id = ?
          AND cat.summary IS NOT NULL
        ORDER BY ep.created_at DESC, cat.updated_at DESC
        LIMIT 1
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?)
}
