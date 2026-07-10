mod native_history;
pub mod queue;
pub mod review;

use std::{collections::HashSet, path::PathBuf};

use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{get, post},
};
use chrono::{Duration, Utc};
use db::models::{
    arena_group::{ArenaLifecycleStatus, ArenaMode},
    coding_agent_turn::{CodingAgentResumeInfo, CodingAgentTurn, ResumableAgentSession},
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessView},
    requests::UpdateSession,
    scratch::{Scratch, ScratchType},
    session::{CreateSession, Session, SessionError},
    workspace::{Workspace, WorkspaceError},
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType, SelectedSkill,
        coding_agent_follow_up::{
            CodingAgentFollowUpRequest, CodingAgentTranscriptBackfillEntry,
            CodingAgentTranscriptBackfillRole,
        },
    },
    profile::ExecutorConfig,
};
pub use native_history::{NativeAgentSessionPreview, NativeSessionPreviewEntry};
use serde::Deserialize;
use services::services::container::ContainerService;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{
    DeploymentImpl, error::ApiError, middleware::load_session_middleware,
    routes::workspaces::execution::RunScriptError,
};

fn design_arena_prompt(prompt: &str) -> String {
    format!(
        "You are in AI Arena Design Mode.\n\
         Focus on design reasoning, tradeoffs, risks, and decision support.\n\
         Do not create commits, push branches, open PRs, or treat code changes as the final output unless the user explicitly asks to start implementation.\n\n\
         User request:\n{}",
        prompt
    )
}

async fn is_open_design_arena_workspace(
    pool: &sqlx::SqlitePool,
    workspace_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let group = Workspace::find_arena_group_for_workspace(pool, workspace_id).await?;

    Ok(matches!(
        group.map(|g| (g.mode, g.lifecycle_status)),
        Some((ArenaMode::Design, ArenaLifecycleStatus::Open))
    ))
}

fn should_block_direct_follow_up_while_running(
    retry_process_id: Option<Uuid>,
    has_running_coding_agent: bool,
) -> bool {
    retry_process_id.is_none() && has_running_coding_agent
}

#[derive(Debug, Deserialize)]
pub struct SessionQuery {
    pub workspace_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ResumableAgentSessionQuery {
    pub workspace_id: Option<Uuid>,
    pub scope_path: Option<String>,
    pub executor: String,
    pub days: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct NativeAgentSessionPreviewQuery {
    pub workspace_id: Option<Uuid>,
    pub scope_path: Option<String>,
    pub executor: String,
    pub session_id: String,
    pub turns: Option<i64>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateSessionRequest {
    pub workspace_id: Uuid,
    pub executor: Option<String>,
    pub name: Option<String>,
}

pub async fn get_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<SessionQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<Session>>>, ApiError> {
    let pool = &deployment.db().pool;
    let sessions = Session::find_by_workspace_id(pool, query.workspace_id).await?;
    Ok(ResponseJson(ApiResponse::success(sessions)))
}

pub async fn get_session(
    Extension(session): Extension<Session>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn get_resumable_agent_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ResumableAgentSessionQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ResumableAgentSession>>>, ApiError> {
    let pool = &deployment.db().pool;
    let days = query.days.unwrap_or(3).clamp(1, 30);
    let limit = query.limit.unwrap_or(10).clamp(1, 50);
    let since = Utc::now() - Duration::days(days);
    let executor = query.executor.trim();
    let explicit_scope_path = query
        .scope_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let workspace_scope = workspace_scope_paths(pool, query.workspace_id).await?;
    let native_history_scope = native_history_scope_paths(workspace_scope, explicit_scope_path);

    // The resume picker intentionally reflects the agent's native history only.
    // It should not mix in sessions merely because Vibe Kanban has previously
    // observed the same executor/session pair.
    let sessions = native_history::list_native_resumable_agent_sessions(
        executor,
        since,
        limit as usize,
        &native_history_scope,
        explicit_scope_path.is_none(),
    );

    Ok(ResponseJson(ApiResponse::success(sessions)))
}

pub async fn get_native_agent_session_preview(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<NativeAgentSessionPreviewQuery>,
) -> Result<ResponseJson<ApiResponse<Option<NativeAgentSessionPreview>>>, ApiError> {
    let pool = &deployment.db().pool;
    let turn_limit = query
        .turns
        .unwrap_or(native_history::DEFAULT_NATIVE_SESSION_PREVIEW_TURNS as i64);
    let turn_limit = turn_limit.clamp(1, native_history::MAX_NATIVE_SESSION_PREVIEW_TURNS as i64);
    let explicit_scope_path = query
        .scope_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let workspace_scope = workspace_scope_paths(pool, query.workspace_id).await?;
    let native_history_scope = native_history_scope_paths(workspace_scope, explicit_scope_path);

    let preview = native_history::get_native_agent_session_preview(
        query.executor.trim(),
        &query.session_id,
        turn_limit as usize,
        &native_history_scope,
        explicit_scope_path.is_none(),
    );

    Ok(ResponseJson(ApiResponse::success(preview)))
}

pub(crate) async fn native_resume_transcript_backfill(
    pool: &sqlx::SqlitePool,
    workspace_id: Option<Uuid>,
    executor: &str,
    resume_session_id: Option<&str>,
) -> Result<Option<Vec<CodingAgentTranscriptBackfillEntry>>, ApiError> {
    let Some(resume_session_id) = resume_session_id
        .map(str::trim)
        .filter(|session_id| !session_id.is_empty())
    else {
        return Ok(None);
    };

    let workspace_scope = workspace_scope_paths(pool, workspace_id).await?;
    let native_history_scope = native_history_scope_paths(workspace_scope, None);
    let Some(preview) = native_history::get_native_agent_session_preview(
        executor,
        resume_session_id,
        native_history::DEFAULT_NATIVE_SESSION_PREVIEW_TURNS,
        &native_history_scope,
        true,
    ) else {
        return Ok(None);
    };

    let entries = preview
        .entries
        .into_iter()
        .filter_map(native_preview_entry_to_transcript_backfill)
        .collect::<Vec<_>>();

    Ok((!entries.is_empty()).then_some(entries))
}

fn native_preview_entry_to_transcript_backfill(
    entry: NativeSessionPreviewEntry,
) -> Option<CodingAgentTranscriptBackfillEntry> {
    let role = match entry.role.as_str() {
        "user" => CodingAgentTranscriptBackfillRole::User,
        "assistant" => CodingAgentTranscriptBackfillRole::Assistant,
        _ => return None,
    };

    let content = entry.content.trim();
    if content.is_empty() {
        return None;
    }

    Some(CodingAgentTranscriptBackfillEntry {
        role,
        content: content.to_string(),
        timestamp: entry.timestamp.map(|timestamp| timestamp.to_rfc3339()),
    })
}

async fn workspace_scope_paths(
    pool: &sqlx::SqlitePool,
    workspace_id: Option<Uuid>,
) -> Result<Vec<PathBuf>, ApiError> {
    let Some(workspace_id) = workspace_id else {
        return Ok(Vec::new());
    };

    let Some(workspace) = Workspace::find_by_id(pool, workspace_id).await? else {
        return Ok(Vec::new());
    };

    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let mut paths = Vec::new();

    if let Some(container_ref) = workspace
        .container_ref
        .as_deref()
        .map(str::trim)
        .filter(|container_ref| !container_ref.is_empty())
    {
        let container_path = PathBuf::from(container_ref);
        paths.push(container_path.clone());

        for repo in &repos {
            paths.push(container_path.join(&repo.name));
        }
    }

    paths.extend(repos.into_iter().map(|repo| repo.path));

    Ok(dedupe_paths(paths))
}

fn native_history_scope_paths(
    workspace_scope: Vec<PathBuf>,
    scope_path: Option<&str>,
) -> Vec<PathBuf> {
    let mut paths = workspace_scope;

    if let Some(scope_path) = scope_path.map(str::trim).filter(|path| !path.is_empty()) {
        paths.push(PathBuf::from(scope_path));
    }

    dedupe_paths(paths)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for path in paths {
        let key = path
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase();
        if seen.insert(key) {
            deduped.push(path);
        }
    }

    deduped
}

pub async fn create_session(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateSessionRequest>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    let pool = &deployment.db().pool;

    // Verify workspace exists
    let _workspace = Workspace::find_by_id(pool, payload.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    let session = Session::create(
        pool,
        &CreateSession {
            executor: payload.executor,
            name: payload.name,
        },
        Uuid::new_v4(),
        payload.workspace_id,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn update_session(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<UpdateSession>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    let pool = &deployment.db().pool;

    Session::update(pool, session.id, request.name.as_deref()).await?;

    let updated = Session::find_by_id(pool, session.id)
        .await?
        .ok_or(ApiError::Session(SessionError::NotFound))?;

    Ok(ResponseJson(ApiResponse::success(updated)))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateFollowUpAttempt {
    pub prompt: String,
    #[serde(default)]
    #[ts(optional)]
    pub selected_skills: Option<Vec<SelectedSkill>>,
    pub executor_config: ExecutorConfig,
    #[serde(default)]
    #[ts(optional)]
    pub resume_session_id: Option<String>,
    pub retry_process_id: Option<Uuid>,
    pub force_when_dirty: Option<bool>,
    pub perform_git_reset: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
pub struct ResetProcessRequest {
    pub process_id: Uuid,
    pub force_when_dirty: Option<bool>,
    pub perform_git_reset: Option<bool>,
}

pub async fn follow_up(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateFollowUpAttempt>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcessView>>, ApiError> {
    let execution_process = start_coding_agent_execution_for_session(
        &deployment,
        session,
        payload.prompt,
        payload.selected_skills,
        payload.executor_config,
        payload.resume_session_id,
        payload.retry_process_id,
        payload.force_when_dirty,
        payload.perform_git_reset,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(
        ExecutionProcessView::from_process(execution_process),
    )))
}

#[allow(clippy::too_many_arguments)]
pub async fn start_coding_agent_execution_for_session(
    deployment: &DeploymentImpl,
    session: Session,
    prompt: String,
    selected_skills: Option<Vec<SelectedSkill>>,
    executor_config: ExecutorConfig,
    resume_session_id: Option<String>,
    retry_process_id: Option<Uuid>,
    force_when_dirty: Option<bool>,
    perform_git_reset: Option<bool>,
) -> Result<ExecutionProcess, ApiError> {
    let pool = &deployment.db().pool;

    let workspace = Workspace::find_by_id(pool, session.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    tracing::info!("{:?}", workspace);

    if should_block_direct_follow_up_while_running(
        retry_process_id,
        ExecutionProcess::has_running_coding_agent_for_session(pool, session.id).await?,
    ) {
        return Err(ApiError::BadRequest(
            "A coding agent is already running for this session. Queue the follow-up instead."
                .to_string(),
        ));
    }

    deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;

    let executor_profile_id = executor_config.profile_id();

    let requested_executor = executor_profile_id.executor.to_string();
    let expected_executor: Option<String> =
        ExecutionProcess::latest_executor_profile_for_session(pool, session.id)
            .await?
            .map(|profile| profile.executor.to_string())
            .or_else(|| session.executor.clone());

    if let Some(expected) = expected_executor {
        if expected != requested_executor {
            return Err(ApiError::Session(SessionError::ExecutorMismatch {
                expected,
                actual: requested_executor.clone(),
            }));
        }
    }

    if session.executor.is_none() {
        Session::update_executor(pool, session.id, &requested_executor).await?;
    }

    if let Some(proc_id) = retry_process_id {
        let force_when_dirty = force_when_dirty.unwrap_or(false);
        let perform_git_reset = perform_git_reset.unwrap_or(true);
        deployment
            .container()
            .reset_session_to_process(session.id, proc_id, perform_git_reset, force_when_dirty)
            .await?;
    }

    let explicit_resume_session_id = resume_session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .filter(|_| retry_process_id.is_none());

    let native_transcript_backfill = native_resume_transcript_backfill(
        pool,
        Some(workspace.id),
        &requested_executor,
        explicit_resume_session_id.as_deref(),
    )
    .await?;

    let latest_session_info = match explicit_resume_session_id {
        Some(session_id) => Some(CodingAgentResumeInfo {
            session_id,
            message_id: None,
        }),
        None => CodingAgentTurn::find_latest_session_info(pool, session.id).await?,
    };

    let mut prompt = prompt;
    if is_open_design_arena_workspace(pool, workspace.id).await? {
        prompt = design_arena_prompt(&prompt);
    }

    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let cleanup_action = deployment.container().cleanup_actions_for_repos(&repos);

    let working_dir = session
        .agent_working_dir
        .as_ref()
        .filter(|dir| !dir.is_empty())
        .cloned();

    let action_type = if let Some(info) = latest_session_info {
        let is_reset = retry_process_id.is_some();
        ExecutorActionType::CodingAgentFollowUpRequest(CodingAgentFollowUpRequest {
            prompt: prompt.clone(),
            selected_skills: selected_skills.clone(),
            session_id: info.session_id,
            reset_to_message_id: if is_reset { info.message_id } else { None },
            executor_config: executor_config.clone(),
            working_dir: working_dir.clone(),
            transcript_backfill: native_transcript_backfill.clone(),
        })
    } else {
        ExecutorActionType::CodingAgentInitialRequest(
            executors::actions::coding_agent_initial::CodingAgentInitialRequest {
                prompt,
                selected_skills: selected_skills.clone(),
                executor_config: executor_config.clone(),
                working_dir,
            },
        )
    };

    let action = ExecutorAction::new(action_type, cleanup_action.map(Box::new));

    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &action,
            &ExecutionProcessRunReason::CodingAgent,
        )
        .await?;

    if let Err(e) = Scratch::delete(pool, session.id, &ScratchType::DraftFollowUp).await {
        tracing::debug!(
            "Failed to delete draft follow-up scratch for session {}: {}",
            session.id,
            e
        );
    }

    Ok(execution_process)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use uuid::Uuid;

    use super::{native_history_scope_paths, should_block_direct_follow_up_while_running};

    #[test]
    fn blocks_direct_follow_up_when_session_agent_is_running() {
        assert!(should_block_direct_follow_up_while_running(None, true));
    }

    #[test]
    fn allows_retry_path_even_when_session_agent_is_running() {
        assert!(!should_block_direct_follow_up_while_running(
            Some(Uuid::new_v4()),
            true
        ));
    }

    #[test]
    fn allows_direct_follow_up_when_session_agent_is_idle() {
        assert!(!should_block_direct_follow_up_while_running(None, false));
    }

    #[test]
    fn native_history_scope_includes_explicit_scope_path() {
        let paths =
            native_history_scope_paths(vec![PathBuf::from("C:/repo")], Some("F:/another-repo"));

        assert_eq!(
            paths,
            vec![PathBuf::from("C:/repo"), PathBuf::from("F:/another-repo")]
        );
    }

    #[test]
    fn native_history_scope_ignores_blank_scope_path_and_dedupes() {
        let paths = native_history_scope_paths(
            vec![PathBuf::from("F:/repo"), PathBuf::from("f:/repo/")],
            Some("  "),
        );

        assert_eq!(paths, vec![PathBuf::from("F:/repo")]);
    }
}

pub async fn reset_process(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ResetProcessRequest>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let force_when_dirty = payload.force_when_dirty.unwrap_or(false);
    let perform_git_reset = payload.perform_git_reset.unwrap_or(true);

    deployment
        .container()
        .reset_session_to_process(
            session.id,
            payload.process_id,
            perform_git_reset,
            force_when_dirty,
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn run_setup_script(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcessView, RunScriptError>>, ApiError> {
    let pool = &deployment.db().pool;

    let workspace = Workspace::find_by_id(pool, session.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    if ExecutionProcess::has_running_non_dev_server_processes_for_workspace(pool, workspace.id)
        .await?
    {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            RunScriptError::ProcessAlreadyRunning,
        )));
    }

    deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;

    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let executor_action = match deployment.container().setup_actions_for_repos(&repos) {
        Some(action) => action,
        None => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                RunScriptError::NoScriptConfigured,
            )));
        }
    };

    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &executor_action,
            &ExecutionProcessRunReason::SetupScript,
        )
        .await?;

    deployment
        .track_if_analytics_allowed(
            "setup_script_executed",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(
        ExecutionProcessView::from_process(execution_process),
    )))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let session_id_router = Router::new()
        .route("/", get(get_session).put(update_session))
        .route("/follow-up", post(follow_up))
        .route("/reset", post(reset_process))
        .route("/setup", post(run_setup_script))
        .route("/review", post(review::start_review))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_session_middleware,
        ));

    let sessions_router = Router::new()
        .route("/", get(get_sessions).post(create_session))
        .route("/resumable", get(get_resumable_agent_sessions))
        .route("/native-preview", get(get_native_agent_session_preview))
        .nest("/{session_id}", session_id_router)
        .nest("/{session_id}/queue", queue::router(deployment));

    Router::new().nest("/sessions", sessions_router)
}
