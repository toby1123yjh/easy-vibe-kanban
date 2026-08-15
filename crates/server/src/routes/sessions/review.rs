use std::path::PathBuf;

use axum::{Extension, Json, extract::State, response::Json as ResponseJson};
use db::models::{
    session::Session,
    workspace::{Workspace, WorkspaceError},
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::{
    actions::review::RepoReviewContext as ExecutorRepoReviewContext,
    executors::build_review_prompt,
    profile::ExecutorConfig,
    runtime::{AgentRunIntent, AgentRunPortSnapshot, RunAttemptMode},
};
use serde::{Deserialize, Serialize};
use services::services::container::ContainerService;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct StartReviewRequest {
    pub executor_config: ExecutorConfig,
    pub additional_prompt: Option<String>,
    #[serde(default)]
    pub use_all_workspace_commits: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum ReviewError {
    ProcessAlreadyRunning,
}

#[axum::debug_handler]
pub async fn start_review(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<StartReviewRequest>,
) -> Result<ResponseJson<ApiResponse<AgentRunPortSnapshot, ReviewError>>, ApiError> {
    let pool = &deployment.db().pool;

    let workspace = Workspace::find_by_id(pool, session.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    if super::agent_run::has_active_agent_run_for_workspace(pool, workspace.id).await? {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            ReviewError::ProcessAlreadyRunning,
        )));
    }

    let container_ref = deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;

    super::agent_run::validate_session_executor(pool, &session, &payload.executor_config).await?;
    let provider = super::agent_run::direct_provider(&payload.executor_config)?;
    let runtime_profile_id = payload.executor_config.profile_id().cache_key();
    let provider_session =
        super::agent_run::latest_provider_session(pool, session.id, provider, &runtime_profile_id)
            .await?;

    let context: Option<Vec<ExecutorRepoReviewContext>> = if payload.use_all_workspace_commits {
        let repos =
            WorkspaceRepo::find_repos_with_target_branch_for_workspace(pool, workspace.id).await?;
        let workspace_path = PathBuf::from(container_ref.as_str());

        let mut contexts = Vec::new();
        for repo in repos {
            let worktree_path = workspace_path.join(&repo.repo.name);
            if let Ok(base_commit) = deployment.git().get_fork_point(
                &worktree_path,
                &repo.target_branch,
                &workspace.branch,
            ) {
                contexts.push(ExecutorRepoReviewContext {
                    repo_id: repo.repo.id,
                    repo_name: repo.repo.display_name,
                    base_commit,
                });
            }
        }
        if contexts.is_empty() {
            None
        } else {
            Some(contexts)
        }
    } else {
        None
    };

    let prompt = build_review_prompt(context.as_deref(), payload.additional_prompt.as_deref());
    let resumed_session = provider_session.is_some();
    let agent_run = super::agent_run::create_agent_run(
        &deployment,
        &session,
        &workspace,
        container_ref,
        super::agent_run::AgentRunLaunch {
            intent: AgentRunIntent::Review,
            mode: RunAttemptMode::Launch,
            prompt,
            selected_skills: None,
            executor_config: payload.executor_config.clone(),
            provider_session,
        },
        super::agent_run::AgentRunDispatch::Immediate,
    )
    .await?;

    deployment
        .track_if_analytics_allowed(
            "review_started",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
                "session_id": session.id.to_string(),
                "executor": payload.executor_config.executor.to_string(),
                "variant": payload.executor_config.variant,
                "resumed_session": resumed_session,
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(agent_run)))
}
