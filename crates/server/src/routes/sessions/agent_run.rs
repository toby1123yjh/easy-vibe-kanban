use chrono::{DateTime, Utc};
use db::models::{
    session::{Session, SessionError},
    workspace::{Workspace, WorkspaceKind},
};
use executors::{
    actions::SelectedSkill,
    executors::provider_adapter::DirectProvider,
    profile::ExecutorConfig,
    provider_policy::direct_provider_capability_snapshot,
    runtime::{
        AGENT_REQUEST_PAYLOAD_VERSION, AGENT_REQUEST_SCHEMA_VERSION, AgentCapability,
        AgentRunIntent, AgentRunPort, AgentRunPortError, AgentRunPortSnapshot,
        AgentRunRequestEnvelope, AgentRuntimeMessageRole, CanonicalMessage, CapabilitySnapshot,
        CapabilityState, PROVIDER_SESSION_REFERENCE_SCHEMA_VERSION, ProviderSessionReference,
        RunAttemptMode, RunAttemptRequest, WorkspaceMode, WorkspaceReference,
    },
};
use sqlx::{SqlitePool, types::Json};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

pub(super) struct AgentRunLaunch {
    pub intent: AgentRunIntent,
    pub mode: RunAttemptMode,
    pub prompt: String,
    pub selected_skills: Option<Vec<SelectedSkill>>,
    pub executor_config: ExecutorConfig,
    pub provider_session: Option<ProviderSessionReference>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AgentRunDispatch {
    Immediate,
    Reserved,
}

pub(super) async fn has_active_agent_run_for_session(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM agent_runs
            WHERE session_id = ?
              AND status NOT IN ('succeeded', 'failed', 'cancelled', 'crashed', 'audit_failed')
        )
        "#,
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
}

pub(super) async fn has_active_agent_run_for_workspace(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM agent_runs
            WHERE workspace_id = ?
              AND status NOT IN ('succeeded', 'failed', 'cancelled', 'crashed', 'audit_failed')
        )
        "#,
    )
    .bind(workspace_id)
    .fetch_one(pool)
    .await
}

pub(super) async fn validate_session_executor(
    pool: &SqlitePool,
    session: &Session,
    executor_config: &ExecutorConfig,
) -> Result<(), ApiError> {
    let requested = executor_config.executor.to_string();
    if let Some(expected) = session.executor.as_ref()
        && expected != &requested
    {
        return Err(ApiError::Session(SessionError::ExecutorMismatch {
            expected: expected.clone(),
            actual: requested,
        }));
    }
    if session.executor.is_none() {
        Session::update_executor(pool, session.id, &requested).await?;
    }
    Ok(())
}

pub(super) fn direct_provider(
    executor_config: &ExecutorConfig,
) -> Result<DirectProvider, ApiError> {
    DirectProvider::from_base_agent(executor_config.executor).ok_or_else(|| {
        ApiError::BadRequest(format!(
            "{} is not a V1 direct Agent Runtime provider",
            executor_config.executor
        ))
    })
}

pub(super) async fn latest_provider_session(
    pool: &SqlitePool,
    session_id: Uuid,
    provider: DirectProvider,
    runtime_profile_id: &str,
) -> Result<Option<ProviderSessionReference>, sqlx::Error> {
    let reference = sqlx::query_scalar::<_, Json<ProviderSessionReference>>(
        r#"
        SELECT session_reference
        FROM agent_provider_sessions
        WHERE session_id = ? AND provider_id = ? AND runtime_profile_id = ?
        LIMIT 1
        "#,
    )
    .bind(session_id)
    .bind(provider.id())
    .bind(runtime_profile_id)
    .fetch_optional(pool)
    .await?;
    Ok(reference.map(|reference| reference.0))
}

pub(super) fn explicit_provider_session(
    provider: DirectProvider,
    runtime_profile_id: &str,
    provider_session_id: Option<&str>,
    observed_at: DateTime<Utc>,
) -> Option<ProviderSessionReference> {
    provider_session_id
        .map(str::trim)
        .filter(|session_id| !session_id.is_empty())
        .map(|session_id| ProviderSessionReference {
            schema_version: PROVIDER_SESSION_REFERENCE_SCHEMA_VERSION,
            provider_id: provider.id().to_string(),
            runtime_profile_id: runtime_profile_id.to_string(),
            provider_session_id: session_id.to_string(),
            observed_at,
            metadata: Some(serde_json::json!({ "source": "explicit_native_resume" })),
        })
}

pub(super) async fn create_agent_run(
    deployment: &DeploymentImpl,
    session: &Session,
    workspace: &Workspace,
    workspace_path: String,
    launch: AgentRunLaunch,
    dispatch: AgentRunDispatch,
) -> Result<AgentRunPortSnapshot, ApiError> {
    let provider = direct_provider(&launch.executor_config)?;
    let runtime_profile_id = launch.executor_config.profile_id().cache_key();
    let capability_snapshot =
        direct_provider_capability_snapshot(provider, runtime_profile_id.clone());
    validate_required_capabilities(
        launch.intent,
        launch.provider_session.is_some(),
        &capability_snapshot,
    )?;

    let request_id = Uuid::new_v4();
    let agent_run_id = Uuid::new_v4();
    let turn_id = Uuid::new_v4();
    let run_attempt_id = Uuid::new_v4();
    let correlation_id = Uuid::new_v4();
    let created_at = Utc::now();
    let idempotency_key = format!("session:{}:request:{request_id}:create", session.id);
    let workspace = WorkspaceReference {
        workspace_id: workspace.id,
        mode: match workspace.workspace_kind {
            WorkspaceKind::DirectFolder => WorkspaceMode::SharedWorkspace,
            WorkspaceKind::Worktree => WorkspaceMode::IsolatedWorktree,
        },
        path: workspace_path,
    };
    let request = AgentRunRequestEnvelope {
        schema_version: AGENT_REQUEST_SCHEMA_VERSION,
        payload_version: AGENT_REQUEST_PAYLOAD_VERSION,
        request_id,
        idempotency_key: idempotency_key.clone(),
        session_id: session.id,
        agent_run_id,
        turn_id,
        correlation_id,
        intent: launch.intent,
        runtime_profile_id: runtime_profile_id.clone(),
        provider_id: provider.id().to_string(),
        workspace: workspace.clone(),
        input: CanonicalMessage {
            message_id: Uuid::new_v4(),
            role: AgentRuntimeMessageRole::User,
            content: launch.prompt,
        },
        created_at,
    };
    let attempt = RunAttemptRequest {
        schema_version: AGENT_REQUEST_SCHEMA_VERSION,
        payload_version: AGENT_REQUEST_PAYLOAD_VERSION,
        request_id,
        idempotency_key: format!("{idempotency_key}:attempt:1"),
        session_id: session.id,
        agent_run_id,
        turn_id,
        run_attempt_id,
        attempt_number: 1,
        correlation_id,
        mode: launch.mode,
        transport: provider.transport(),
        runtime_profile_id,
        provider_id: provider.id().to_string(),
        workspace,
        capability_snapshot,
        executor_config: launch.executor_config,
        selected_skills: launch.selected_skills.filter(|skills| !skills.is_empty()),
        reset_to_message_id: None,
        provider_session: launch.provider_session,
        created_at,
    };

    let port = deployment.agent_run_port();
    let persisted_agent_run_id = match dispatch {
        AgentRunDispatch::Immediate => port.create(request, attempt).await,
        AgentRunDispatch::Reserved => port.reserve(request, attempt).await,
    }
    .map_err(agent_run_port_error)?;
    port.query(persisted_agent_run_id)
        .await
        .map_err(agent_run_port_error)
}

fn validate_required_capabilities(
    intent: AgentRunIntent,
    has_provider_session: bool,
    snapshot: &CapabilitySnapshot,
) -> Result<(), ApiError> {
    if matches!(intent, AgentRunIntent::FollowUp) {
        if !has_provider_session {
            return Err(ApiError::BadRequest(
                "A canonical follow-up requires an observed or explicitly selected native session"
                    .to_string(),
            ));
        }
        require_native_capability(snapshot, AgentCapability::SessionResume)?;
    }
    if matches!(intent, AgentRunIntent::Review) {
        require_native_capability(snapshot, AgentCapability::Review)?;
    }
    Ok(())
}

fn require_native_capability(
    snapshot: &CapabilitySnapshot,
    capability: AgentCapability,
) -> Result<(), ApiError> {
    match snapshot.resolve(capability) {
        CapabilityState::Native => Ok(()),
        state => Err(ApiError::BadRequest(format!(
            "Provider {} cannot perform {capability:?}: frozen capability is {state:?}",
            snapshot.provider_id
        ))),
    }
}

pub(super) fn agent_run_port_error(error: AgentRunPortError) -> ApiError {
    match error {
        AgentRunPortError::Rejected(message) => ApiError::BadRequest(message),
        AgentRunPortError::NotFound(agent_run_id) => {
            ApiError::BadRequest(format!("Canonical AgentRun {agent_run_id} was not found"))
        }
        AgentRunPortError::Unavailable(message) => ApiError::BadGateway(message),
    }
}

#[cfg(test)]
mod tests {
    use executors::{
        executors::{BaseCodingAgent, provider_adapter::DirectProvider},
        profile::ExecutorConfig,
        runtime::{AgentRunIntent, RunAttemptMode},
    };

    use super::{direct_provider, explicit_provider_session};

    async fn active_run_test_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite pool");
        sqlx::query(
            "CREATE TABLE agent_runs (session_id BLOB NOT NULL, workspace_id BLOB NOT NULL, status TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create test agent_runs table");
        pool
    }

    #[test]
    fn direct_provider_mapping_covers_the_four_v1_runtimes() {
        let cases = [
            (BaseCodingAgent::Gemini, DirectProvider::Gemini),
            (BaseCodingAgent::Codex, DirectProvider::Codex),
            (BaseCodingAgent::ClaudeCode, DirectProvider::ClaudeCode),
            (BaseCodingAgent::OhMyPi, DirectProvider::OhMyPi),
        ];
        for (agent, expected) in cases {
            assert_eq!(
                direct_provider(&ExecutorConfig::new(agent)).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn explicit_native_resume_reference_is_trimmed_and_provider_scoped() {
        let observed_at = chrono::Utc::now();
        let reference = explicit_provider_session(
            DirectProvider::Codex,
            "CODEX:DEFAULT",
            Some("  native-thread  "),
            observed_at,
        )
        .expect("provider session reference");

        assert_eq!(reference.provider_session_id, "native-thread");
        assert_eq!(reference.provider_id, "codex");
        assert_eq!(reference.runtime_profile_id, "CODEX:DEFAULT");
        assert_eq!(reference.observed_at, observed_at);
    }

    #[test]
    fn explicit_native_resume_reference_rejects_blank_ids() {
        assert!(
            explicit_provider_session(
                DirectProvider::ClaudeCode,
                "CLAUDE_CODE",
                Some("  "),
                chrono::Utc::now(),
            )
            .is_none()
        );
    }

    #[test]
    fn canonical_initial_and_resume_modes_remain_distinct() {
        assert_ne!(AgentRunIntent::Initial, AgentRunIntent::FollowUp);
        assert_ne!(RunAttemptMode::Launch, RunAttemptMode::Resume);
    }

    #[tokio::test]
    async fn active_run_guards_use_canonical_status_for_session_and_workspace() {
        let pool = active_run_test_pool().await;
        let session_id = uuid::Uuid::new_v4();
        let workspace_id = uuid::Uuid::new_v4();
        sqlx::query("INSERT INTO agent_runs (session_id, workspace_id, status) VALUES (?, ?, ?)")
            .bind(session_id)
            .bind(workspace_id)
            .bind("running")
            .execute(&pool)
            .await
            .expect("insert running AgentRun");

        assert!(
            super::has_active_agent_run_for_session(&pool, session_id)
                .await
                .unwrap()
        );
        assert!(
            super::has_active_agent_run_for_workspace(&pool, workspace_id)
                .await
                .unwrap()
        );

        sqlx::query("UPDATE agent_runs SET status = 'succeeded'")
            .execute(&pool)
            .await
            .expect("terminalize AgentRun");
        assert!(
            !super::has_active_agent_run_for_session(&pool, session_id)
                .await
                .unwrap()
        );
        assert!(
            !super::has_active_agent_run_for_workspace(&pool, workspace_id)
                .await
                .unwrap()
        );
    }
}
