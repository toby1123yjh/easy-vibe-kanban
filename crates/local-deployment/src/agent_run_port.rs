use std::{
    collections::{HashMap, HashSet},
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use chrono::Utc;
use command_group::AsyncGroupChild;
use db::{
    DBService,
    models::{
        agent_runtime::{
            AgentEventRecord, AgentProviderSessionRecord, AgentRunRecord, NativeAuditStreamRecord,
        },
        session::Session,
        workspace::Workspace,
        workspace_repo::WorkspaceRepo,
    },
};
use executors::{
    actions::SelectedSkill,
    approvals::{ExecutorApprovalService, NoopExecutorApprovalService},
    env::{ExecutionEnv, RepoContext},
    executors::{
        CancellationToken, ExecutorExitResult, ExecutorExitSignal,
        provider_adapter::{
            DirectControl, DirectIntent, DirectProvider, DirectProviderLaunchRequest,
            encode_control, require_capability,
        },
    },
    profile::ExecutorConfig,
    runtime::{
        AGENT_EVENT_PAYLOAD_VERSION, AGENT_EVENT_SCHEMA_VERSION, AgentCapability,
        AgentEventEnvelope, AgentEventPayload, AgentEventStream, AgentRunIntent, AgentRunPort,
        AgentRunPortCommand, AgentRunPortCommandEnvelope, AgentRunPortError, AgentRunPortSnapshot,
        AgentRunRequestEnvelope, AgentRunStatus, AgentRuntimeError, AgentRuntimeErrorKind,
        AgentRuntimeMessageRole, CanonicalMessage, NativeAuditChannel, NativeAuditFrame,
        NativeAuditIntegrityStatus, NativeAuditMetadata, NativeAuditReference, NativeAuditWriter,
        ProviderSessionReference, RunAttemptMode, RunAttemptRequest,
    },
};
use futures::{StreamExt, stream};
use rand::{RngCore, rngs::OsRng};
use serde::Serialize;
use sqlx::types::Json;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{Mutex, RwLock, broadcast, mpsc},
};
use uuid::Uuid;

use crate::{
    agent_process_registry::{AgentProcessRegistry, RegisteredAgentProcess},
    process_host::{
        HostBootstrap, HostCommand, HostEventPayload, HostExecutionEnv, HostLaunchRequest,
        HostReady, send_host_command,
    },
    transport::{read_json_frame, write_json_frame},
};

type SharedChild = Arc<RwLock<AsyncGroupChild>>;
const TERMINAL_EVENT_CHANNEL_CAPACITY: usize = 256;

type ExitSignalFuture = Pin<
    Box<
        dyn Future<Output = Result<ExecutorExitResult, tokio::sync::oneshot::error::RecvError>>
            + Send,
    >,
>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AgentRunTerminalEvent {
    pub agent_run_id: Uuid,
    pub session_id: Uuid,
    pub status: AgentRunStatus,
}

#[derive(Clone)]
pub struct LocalAgentRunPort {
    db: DBService,
    process_registry: AgentProcessRegistry,
    children: Arc<RwLock<HashMap<Uuid, SharedChild>>>,
    cancellation_tokens: Arc<RwLock<HashMap<Uuid, CancellationToken>>>,
    launching_attempts: Arc<Mutex<HashSet<Uuid>>>,
    audit_writers: Arc<Mutex<HashMap<Uuid, NativeAuditWriter>>>,
    event_senders: Arc<RwLock<HashMap<Uuid, broadcast::Sender<AgentEventEnvelope>>>>,
    terminal_event_sender: broadcast::Sender<AgentRunTerminalEvent>,
    event_write_lock: Arc<Mutex<()>>,
    command_lock: Arc<Mutex<()>>,
}

#[derive(Debug)]
enum OutputNotice {
    StdoutClosed,
    StderrClosed,
    ProviderTerminal(AgentRunStatus),
    AuditFailure(String),
    ProtocolFailure(String),
}

#[derive(Debug)]
enum AttemptExit {
    Executor(ExecutorExitResult),
    ExecutorChannelClosed,
    ProviderTerminal(AgentRunStatus),
    Process { success: bool, code: Option<i64> },
    WatcherFailed(String),
    OutputFailure(OutputNotice),
}

struct FrozenDirectProviderLaunchSpec {
    provider: DirectProvider,
    executor_config: ExecutorConfig,
    intent: DirectIntent,
    prompt: String,
    provider_session: Option<ProviderSessionReference>,
    reset_to_message_id: Option<String>,
    selected_skills: Vec<SelectedSkill>,
    approvals: Arc<dyn ExecutorApprovalService>,
    current_dir: PathBuf,
    env: ExecutionEnv,
}

#[derive(Serialize)]
struct AuditedDirectProviderLaunchSpec<'a> {
    schema_version: u16,
    provider: DirectProvider,
    executor_config: &'a ExecutorConfig,
    intent: DirectIntent,
    prompt: &'a str,
    provider_session: Option<&'a ProviderSessionReference>,
    reset_to_message_id: Option<&'a str>,
    selected_skills: &'a [SelectedSkill],
    approval_behavior: &'static str,
    current_dir: &'a Path,
    env: AuditedExecutionEnv<'a>,
}

#[derive(Serialize)]
struct AuditedExecutionEnv<'a> {
    vars: &'a HashMap<String, String>,
    workspace_root: &'a Path,
    repo_names: &'a [String],
    commit_reminder: bool,
    commit_reminder_prompt: &'a str,
}

impl FrozenDirectProviderLaunchSpec {
    fn new(
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        provider: DirectProvider,
        env: ExecutionEnv,
    ) -> Self {
        Self {
            provider,
            executor_config: attempt.executor_config.clone(),
            intent: direct_intent(request.intent, attempt.mode),
            prompt: request.input.content.clone(),
            provider_session: attempt.provider_session.clone(),
            reset_to_message_id: attempt.reset_to_message_id.clone(),
            selected_skills: attempt.selected_skills.clone().unwrap_or_default(),
            approvals: Arc::new(NoopExecutorApprovalService),
            current_dir: PathBuf::from(&attempt.workspace.path),
            env,
        }
    }

    fn launch_request(&self) -> DirectProviderLaunchRequest<'_> {
        DirectProviderLaunchRequest {
            provider: self.provider,
            executor_config: &self.executor_config,
            intent: self.intent,
            prompt: &self.prompt,
            provider_session: self.provider_session.as_ref(),
            reset_to_message_id: self.reset_to_message_id.as_deref(),
            selected_skills: &self.selected_skills,
            approvals: self.approvals.clone(),
            current_dir: &self.current_dir,
            env: &self.env,
        }
    }

    fn audit_payload(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&AuditedDirectProviderLaunchSpec {
            schema_version: 1,
            provider: self.provider,
            executor_config: &self.executor_config,
            intent: self.intent,
            prompt: &self.prompt,
            provider_session: self.provider_session.as_ref(),
            reset_to_message_id: self.reset_to_message_id.as_deref(),
            selected_skills: &self.selected_skills,
            approval_behavior: "noop",
            current_dir: &self.current_dir,
            env: AuditedExecutionEnv {
                vars: &self.env.vars,
                workspace_root: &self.env.repo_context.workspace_root,
                repo_names: &self.env.repo_context.repo_names,
                commit_reminder: self.env.commit_reminder,
                commit_reminder_prompt: &self.env.commit_reminder_prompt,
            },
        })
    }
}

fn direct_intent(intent: AgentRunIntent, mode: RunAttemptMode) -> DirectIntent {
    match (intent, mode) {
        (_, RunAttemptMode::Resume) => DirectIntent::Resume,
        (AgentRunIntent::Initial, RunAttemptMode::Launch | RunAttemptMode::Restart) => {
            DirectIntent::Initial
        }
        (AgentRunIntent::FollowUp, RunAttemptMode::Launch) => DirectIntent::FollowUp,
        (AgentRunIntent::FollowUp, RunAttemptMode::Restart) => DirectIntent::Initial,
        (AgentRunIntent::Review, RunAttemptMode::Launch | RunAttemptMode::Restart) => {
            DirectIntent::Review
        }
    }
}

impl LocalAgentRunPort {
    pub(crate) fn new(db: DBService) -> Self {
        let (terminal_event_sender, _) = broadcast::channel(TERMINAL_EVENT_CHANNEL_CAPACITY);
        Self {
            db,
            process_registry: AgentProcessRegistry::default(),
            children: Arc::new(RwLock::new(HashMap::new())),
            cancellation_tokens: Arc::new(RwLock::new(HashMap::new())),
            launching_attempts: Arc::new(Mutex::new(HashSet::new())),
            audit_writers: Arc::new(Mutex::new(HashMap::new())),
            event_senders: Arc::new(RwLock::new(HashMap::new())),
            terminal_event_sender,
            event_write_lock: Arc::new(Mutex::new(())),
            command_lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn subscribe_terminal_events(&self) -> broadcast::Receiver<AgentRunTerminalEvent> {
        self.terminal_event_sender.subscribe()
    }

    /// Reconnect to every persisted durable process host during application startup.
    ///
    /// This is intentionally public so server startup can invoke reconciliation
    /// before accepting AgentRun traffic. Reconciliation only attaches to the
    /// endpoint/token persisted for each RunAttempt; it never replacement-spawns
    /// a provider when the host is unreachable.
    pub async fn reconcile_process_hosts(&self) {
        let run_attempt_ids: Vec<Uuid> = match sqlx::query_scalar(
            r#"
            SELECT apr.run_attempt_id
            FROM agent_process_registry apr
            WHERE apr.registry_status IN ('reserved', 'spawned', 'running', 'unreachable')
              AND apr.host_endpoint IS NOT NULL AND apr.host_token IS NOT NULL
            "#,
        )
        .fetch_all(&self.db.pool)
        .await
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::error!(%error, "failed to load process-host attachments for reconciliation");
                return;
            }
        };
        for run_attempt_id in run_attempt_ids {
            if let Err(error) = self.attach_process_host(run_attempt_id).await {
                if let Err(mark_error) =
                    AgentRunRecord::mark_process_host_unreachable(&self.db.pool, run_attempt_id)
                        .await
                {
                    tracing::error!(run_attempt_id = %run_attempt_id, %mark_error, "failed to preserve unreachable process host");
                }
                tracing::warn!(run_attempt_id = %run_attempt_id, %error, "process host unavailable during startup reconciliation");
            }
        }
    }

    /// Persist a complete AgentRun identity without launching its provider.
    ///
    /// Product-level launch gates use this when an independent setup script
    /// must finish before the Agent process is allowed to start.
    pub async fn reserve(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
    ) -> Result<Uuid, AgentRunPortError> {
        attempt
            .validate_for_run(&request)
            .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
        self.validate_workspace(&request).await?;
        AgentRunRecord::persist_identity_before_launch(&self.db.pool, &request, &attempt)
            .await
            .map(|identity| identity.agent_run_id)
            .map_err(|error| AgentRunPortError::Rejected(error.to_string()))
    }

    /// Launch a previously reserved AgentRun exactly once per local runtime.
    /// Repeated calls after launch acceptance return the current snapshot.
    pub async fn launch_reserved(
        &self,
        agent_run_id: Uuid,
    ) -> Result<AgentRunPortSnapshot, AgentRunPortError> {
        let _command_guard = self.command_lock.lock().await;
        let snapshot = self.query(agent_run_id).await?;
        if snapshot.state.status != AgentRunStatus::Pending {
            return Ok(snapshot);
        }

        let (request, attempt) = self.load_request(agent_run_id).await?;
        let workspace = self.validate_workspace(&request).await?;
        self.start_attempt(request, attempt, workspace).await;
        self.query(agent_run_id).await
    }

    /// Terminalize a setup-gated AgentRun that was reserved but never launched.
    pub async fn fail_reserved(
        &self,
        agent_run_id: Uuid,
        message: String,
    ) -> Result<AgentRunPortSnapshot, AgentRunPortError> {
        let _command_guard = self.command_lock.lock().await;
        let snapshot = self.query(agent_run_id).await?;
        if snapshot.state.status.is_terminal() {
            return Ok(snapshot);
        }
        if snapshot.state.status != AgentRunStatus::Pending {
            return Err(AgentRunPortError::Rejected(format!(
                "cannot fail setup gate for active AgentRun {agent_run_id}"
            )));
        }

        let (request, attempt) = self.load_request(agent_run_id).await?;
        self.terminalize_failure(
            &request,
            &attempt,
            AgentRunStatus::Failed,
            AgentRuntimeError::new(AgentRuntimeErrorKind::StartupFailed, message),
        )
        .await;
        self.query(agent_run_id).await
    }

    /// Attach to one persisted process host and replay observations after the
    /// durable cursor. This is useful to startup orchestration and tests that
    /// need deterministic single-attempt reconstruction.
    pub async fn attach_process_host(&self, run_attempt_id: Uuid) -> Result<(), AgentRunPortError> {
        let row: Option<(
            Json<AgentRunRequestEnvelope>,
            Json<RunAttemptRequest>,
            String,
            String,
            Option<String>,
            i64,
        )> = sqlx::query_as(
            r#"
            SELECT ar.request_envelope, ara.request_envelope,
                   apr.host_endpoint, apr.host_token, apr.host_instance_id,
                   apr.last_host_event_sequence
            FROM agent_process_registry apr
            JOIN agent_run_attempts ara ON ara.id = apr.run_attempt_id
            JOIN agent_runs ar ON ar.id = ara.agent_run_id
            WHERE apr.run_attempt_id = ?
              AND apr.host_endpoint IS NOT NULL AND apr.host_token IS NOT NULL
            "#,
        )
        .bind(run_attempt_id)
        .fetch_optional(&self.db.pool)
        .await
        .map_err(port_database)?;
        let Some((request, attempt, endpoint, token, host_instance_id, cursor)) = row else {
            return Err(AgentRunPortError::NotFound(run_attempt_id));
        };
        let after_sequence = u64::try_from(cursor).unwrap_or_default();
        let response = match send_host_command(
            &endpoint,
            &token,
            HostCommand::Attach { after_sequence },
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                AgentRunRecord::mark_process_host_unreachable(&self.db.pool, run_attempt_id)
                    .await
                    .map_err(|mark_error| AgentRunPortError::Unavailable(mark_error.to_string()))?;
                return Err(AgentRunPortError::Unavailable(format!(
                    "process host unavailable for RunAttempt {run_attempt_id}: {error}"
                )));
            }
        };
        if let Some(error) = response.error {
            AgentRunRecord::mark_process_host_unreachable(&self.db.pool, run_attempt_id)
                .await
                .map_err(|mark_error| AgentRunPortError::Unavailable(mark_error.to_string()))?;
            return Err(AgentRunPortError::Unavailable(error));
        }
        if let Some(expected) = host_instance_id
            && response.host_instance_id.to_string() != expected
        {
            return Err(AgentRunPortError::Unavailable(
                "process host identity did not match persisted reservation".to_string(),
            ));
        }
        self.apply_host_events(&request.0, &attempt.0, response.events)
            .await?;
        let port = self.clone();
        tokio::spawn(async move {
            port.observe_process_host(request.0, attempt.0).await;
        });
        Ok(())
    }

    async fn cleanup_failed_process_host_launch(
        &self,
        run_attempt_id: Uuid,
        child: Option<&mut tokio::process::Child>,
    ) {
        if let Some(child) = child {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        if let Err(error) =
            AgentRunRecord::clear_process_host_reservation(&self.db.pool, run_attempt_id).await
        {
            tracing::warn!(run_attempt_id = %run_attempt_id, %error, "failed to clear process-host reservation after launch failure");
        }
    }

    async fn append_lifecycle(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        status: AgentRunStatus,
    ) -> Result<(), AgentRunPortError> {
        self.append_event(
            request,
            attempt,
            AgentEventPayload::LifecycleChanged { status },
            Vec::new(),
            Utc::now(),
            None,
        )
        .await
    }

    async fn append_event(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        payload: AgentEventPayload,
        native_refs: Vec<NativeAuditReference>,
        timestamp: chrono::DateTime<Utc>,
        event_id: Option<Uuid>,
    ) -> Result<(), AgentRunPortError> {
        let _guard = self.event_write_lock.lock().await;
        let event_id = event_id.unwrap_or_else(Uuid::new_v4);
        // The orchestration identity is owned by the durable link table, not
        // by provider transports. Resolve it at the canonical write boundary
        // so every emitted AgentEvent can be ingested by orchestration after a
        // restart (direct runs simply have no link and remain unscoped).
        let orchestration_identity: Option<(Uuid, Uuid)> = sqlx::query_as(
            "SELECT orchestration_run_id, node_execution_id FROM orchestration_agent_run_links WHERE agent_run_id = ?",
        )
        .bind(request.agent_run_id)
        .fetch_optional(&self.db.pool)
        .await
        .map_err(port_database)?;
        let (orchestration_run_id, orchestration_node_execution_id) = orchestration_identity
            .map(|(run_id, node_id)| (Some(run_id), Some(node_id)))
            .unwrap_or((None, None));
        let existing: Option<Json<AgentEventEnvelope>> =
            sqlx::query_scalar("SELECT event_envelope FROM agent_events WHERE event_id = ?")
                .bind(event_id)
                .fetch_optional(&self.db.pool)
                .await
                .map_err(port_database)?;
        if let Some(existing) = existing {
            let event = AgentEventEnvelope {
                schema_version: AGENT_EVENT_SCHEMA_VERSION,
                payload_version: AGENT_EVENT_PAYLOAD_VERSION,
                event_id,
                session_id: request.session_id,
                agent_run_id: request.agent_run_id,
                turn_id: request.turn_id,
                run_attempt_id: attempt.run_attempt_id,
                run_attempt_number: attempt.attempt_number,
                sequence: existing.0.sequence,
                correlation_id: request.correlation_id,
                orchestration_run_id,
                orchestration_node_execution_id,
                timestamp,
                native_refs,
                payload,
            };
            return if event == existing.0 {
                Ok(())
            } else {
                Err(AgentRunPortError::Rejected(format!(
                    "canonical event id {event_id} was reused with different content"
                )))
            };
        }
        let sequence: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_events WHERE run_attempt_id = ?",
        )
        .bind(attempt.run_attempt_id)
        .fetch_one(&self.db.pool)
        .await
        .map_err(port_database)?;
        let sequence = u64::try_from(sequence)
            .map_err(|_| AgentRunPortError::Rejected("invalid event sequence".to_string()))?;
        let event = AgentEventEnvelope {
            schema_version: AGENT_EVENT_SCHEMA_VERSION,
            payload_version: AGENT_EVENT_PAYLOAD_VERSION,
            event_id,
            session_id: request.session_id,
            agent_run_id: request.agent_run_id,
            turn_id: request.turn_id,
            run_attempt_id: attempt.run_attempt_id,
            run_attempt_number: attempt.attempt_number,
            sequence,
            correlation_id: request.correlation_id,
            orchestration_run_id,
            orchestration_node_execution_id,
            timestamp,
            native_refs,
            payload,
        };
        AgentEventRecord::append_and_project(&self.db.pool, &event)
            .await
            .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
        let terminal_event = match &event.payload {
            AgentEventPayload::LifecycleChanged { status } if status.is_terminal() => {
                Some(AgentRunTerminalEvent {
                    agent_run_id: request.agent_run_id,
                    session_id: request.session_id,
                    status: *status,
                })
            }
            _ => None,
        };
        let sender = self.sender(request.agent_run_id).await;
        let _ = sender.send(event);
        if let Some(terminal_event) = terminal_event {
            let _ = self.terminal_event_sender.send(terminal_event);
        }
        Ok(())
    }

    async fn append_recoverable(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        payload: AgentEventPayload,
        native_refs: Vec<NativeAuditReference>,
        timestamp: chrono::DateTime<Utc>,
        event_id: Option<Uuid>,
    ) {
        if let Err(error) = self
            .append_event(request, attempt, payload, native_refs, timestamp, event_id)
            .await
        {
            tracing::error!(
                agent_run_id = %request.agent_run_id,
                run_attempt_id = %attempt.run_attempt_id,
                %error,
                "canonical AgentRun projection failed; preserving Native Audit for replay"
            );
            if let Err(mark_error) =
                AgentRunRecord::mark_projection_degraded(&self.db.pool, request.agent_run_id).await
            {
                tracing::error!(
                    agent_run_id = %request.agent_run_id,
                    error = %mark_error,
                    "failed to mark AgentRun projection degraded"
                );
            }
        }
    }

    async fn append_mapped_event(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        mapped: AgentEventEnvelope,
        native_ref: NativeAuditReference,
    ) {
        // Provider session observations are the canonical source used by the
        // next follow-up launch. Persist them independently from the event
        // projection so a replay/query can recover the native session even if
        // the live projection is temporarily degraded.
        let observed_provider_session = match &mapped.payload {
            AgentEventPayload::SessionObserved { provider_session } => {
                Some(provider_session.clone())
            }
            _ => None,
        };
        if let AgentEventPayload::LifecycleChanged { status } = &mapped.payload {
            // A failed snapshot read must not drop the audited canonical
            // lifecycle event.  Persist/reduce it and let the append path
            // surface projection degradation; only suppress events when a
            // successful read proves that the run is already terminal (or is
            // cancelling and this is not the confirming cancellation).
            if let Ok(snapshot) = self.query(request.agent_run_id).await {
                if snapshot.state.status.is_terminal()
                    || (snapshot.state.status == AgentRunStatus::Cancelling
                        && *status != AgentRunStatus::Cancelled)
                {
                    return;
                }
            }
        }
        self.append_recoverable(
            request,
            attempt,
            mapped.payload,
            vec![native_ref],
            mapped.timestamp,
            Some(mapped.event_id),
        )
        .await;

        if let Some(provider_session) = observed_provider_session {
            if let Err(error) = AgentProviderSessionRecord::upsert(
                &self.db.pool,
                Uuid::new_v4(),
                request.session_id,
                &provider_session,
            )
            .await
            {
                tracing::error!(
                    session_id = %request.session_id,
                    run_attempt_id = %attempt.run_attempt_id,
                    %error,
                    "failed to persist observed provider session"
                );
                if let Err(mark_error) =
                    AgentRunRecord::mark_projection_degraded(&self.db.pool, request.agent_run_id)
                        .await
                {
                    tracing::error!(
                        agent_run_id = %request.agent_run_id,
                        error = %mark_error,
                        "failed to mark AgentRun degraded after provider-session persistence failure"
                    );
                }
            }
        }
    }

    async fn sender(&self, agent_run_id: Uuid) -> broadcast::Sender<AgentEventEnvelope> {
        let mut senders = self.event_senders.write().await;
        senders
            .entry(agent_run_id)
            .or_insert_with(|| broadcast::channel(256).0)
            .clone()
    }

    async fn load_request(
        &self,
        agent_run_id: Uuid,
    ) -> Result<(AgentRunRequestEnvelope, RunAttemptRequest), AgentRunPortError> {
        let row: Option<(Json<AgentRunRequestEnvelope>, Json<RunAttemptRequest>)> = sqlx::query_as(
            r#"
                SELECT ar.request_envelope, ara.request_envelope
                FROM agent_runs ar
                JOIN agent_run_attempts ara ON ara.agent_run_id = ar.id
                WHERE ar.id = ?
                ORDER BY ara.attempt_number DESC
                LIMIT 1
                "#,
        )
        .bind(agent_run_id)
        .fetch_optional(&self.db.pool)
        .await
        .map_err(port_database)?;
        row.map(|(request, attempt)| (request.0, attempt.0))
            .ok_or(AgentRunPortError::NotFound(agent_run_id))
    }

    fn provider(&self, provider_id: &str) -> Result<DirectProvider, AgentRunPortError> {
        match provider_id.replace('-', "_").to_ascii_lowercase().as_str() {
            "gemini" => Ok(DirectProvider::Gemini),
            "codex" => Ok(DirectProvider::Codex),
            "claude_code" | "claude" => Ok(DirectProvider::ClaudeCode),
            "oh_my_pi" | "omp" => Ok(DirectProvider::OhMyPi),
            _ => Err(AgentRunPortError::Rejected(format!(
                "unsupported provider {provider_id}"
            ))),
        }
    }

    async fn validate_workspace(
        &self,
        request: &AgentRunRequestEnvelope,
    ) -> Result<Workspace, AgentRunPortError> {
        let session = Session::find_by_id(&self.db.pool, request.session_id)
            .await
            .map_err(port_database)?
            .ok_or(AgentRunPortError::NotFound(request.session_id))?;
        if session.workspace_id != request.workspace.workspace_id {
            return Err(AgentRunPortError::Rejected(
                "session and AgentRun workspace do not match".to_string(),
            ));
        }
        let workspace = Workspace::find_by_id(&self.db.pool, request.workspace.workspace_id)
            .await
            .map_err(port_database)?
            .ok_or(AgentRunPortError::NotFound(request.workspace.workspace_id))?;
        let current_dir = Path::new(&request.workspace.path);
        if !current_dir.is_dir() {
            return Err(AgentRunPortError::Rejected(format!(
                "AgentRun workspace does not exist: {}",
                current_dir.display()
            )));
        }
        let persisted_dir = workspace.container_ref.as_deref().ok_or_else(|| {
            AgentRunPortError::Rejected(
                "AgentRun workspace has no persisted local path".to_string(),
            )
        })?;
        let requested_path = tokio::fs::canonicalize(current_dir)
            .await
            .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
        let persisted_path = tokio::fs::canonicalize(persisted_dir)
            .await
            .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
        if requested_path != persisted_path {
            return Err(AgentRunPortError::Rejected(format!(
                "AgentRun workspace path {} does not match persisted workspace path {}",
                current_dir.display(),
                Path::new(persisted_dir).display()
            )));
        }
        Ok(workspace)
    }

    async fn execution_env(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        workspace: &Workspace,
    ) -> Result<ExecutionEnv, AgentRunPortError> {
        let repos = WorkspaceRepo::find_repos_for_workspace(&self.db.pool, workspace.id)
            .await
            .map_err(port_database)?;
        let repo_names = repos.into_iter().map(|repo| repo.name).collect();
        let mut env = ExecutionEnv::new(
            RepoContext::new(PathBuf::from(&request.workspace.path), repo_names),
            false,
            String::new(),
        );
        env.insert("VK_WORKSPACE_ID", workspace.id.to_string());
        env.insert("VK_WORKSPACE_BRANCH", &workspace.branch);
        env.insert("VK_AGENT_RUN_ID", request.agent_run_id.to_string());
        env.insert("VK_RUN_ATTEMPT_ID", attempt.run_attempt_id.to_string());
        Ok(env)
    }

    async fn setup_audit(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        provider: DirectProvider,
        launch: &FrozenDirectProviderLaunchSpec,
    ) -> Result<NativeAuditReference, AgentRunPortError> {
        let versions = provider.versions();
        let metadata = NativeAuditMetadata {
            session_id: request.session_id,
            agent_run_id: request.agent_run_id,
            turn_id: request.turn_id,
            run_attempt_id: attempt.run_attempt_id,
            run_attempt_number: attempt.attempt_number,
            provider_id: provider.id().to_string(),
            runtime_profile_id: request.runtime_profile_id.clone(),
            workspace_path: request.workspace.path.clone(),
            runtime_version: versions.runtime.map(str::to_owned),
            protocol_version: versions.protocol.map(str::to_owned),
            adapter_version: versions.adapter.to_string(),
            mapper_version: versions.mapper.to_string(),
            created_at: Utc::now(),
        };
        let mut writer = NativeAuditWriter::create(metadata).map_err(port_audit)?;
        NativeAuditStreamRecord::insert_open(&self.db.pool, writer.manifest())
            .await
            .map_err(port_database)?;
        let canonical_ref =
            match writer.append_canonical_input(&request.input, request.correlation_id) {
                Ok(reference) => reference,
                Err(error) => {
                    let manifest = writer.fail_closed().ok();
                    if let Some(manifest) = manifest {
                        let _ = NativeAuditStreamRecord::finalize(&self.db.pool, &manifest).await;
                    }
                    return Err(port_audit(error));
                }
            };
        let native_input = match launch.audit_payload() {
            Ok(native_input) => native_input,
            Err(error) => {
                let manifest = writer.fail_closed().ok();
                if let Some(manifest) = manifest {
                    let _ = NativeAuditStreamRecord::finalize(&self.db.pool, &manifest).await;
                }
                return Err(AgentRunPortError::Unavailable(error.to_string()));
            }
        };
        if let Err(error) = writer.append_native_input(
            NativeAuditChannel::NativeInput,
            "application/vnd.vibe-kanban.direct-provider-launch+json",
            request.correlation_id,
            &native_input,
        ) {
            let manifest = writer.fail_closed().ok();
            if let Some(manifest) = manifest {
                let _ = NativeAuditStreamRecord::finalize(&self.db.pool, &manifest).await;
            }
            return Err(port_audit(error));
        }
        self.audit_writers
            .lock()
            .await
            .insert(attempt.run_attempt_id, writer);
        Ok(canonical_ref)
    }

    async fn append_audit_bytes(
        &self,
        attempt: &RunAttemptRequest,
        channel: NativeAuditChannel,
        content_type: &str,
        payload: &[u8],
    ) -> Result<(NativeAuditFrame, NativeAuditReference), AgentRunPortError> {
        let mut writers = self.audit_writers.lock().await;
        let writer = writers.get_mut(&attempt.run_attempt_id).ok_or_else(|| {
            AgentRunPortError::Unavailable("Native Audit writer is not attached".to_string())
        })?;
        let sequence = writer.manifest().last_sequence.unwrap_or(0) + 1;
        let frame = NativeAuditFrame::from_bytes(
            sequence,
            Utc::now(),
            executors::runtime::NativeAuditDirection::Output,
            channel,
            content_type,
            attempt.correlation_id,
            payload,
            None,
        );
        let reference = writer.append(frame.clone()).map_err(port_audit)?;
        Ok((frame, reference))
    }

    async fn append_control_audit(
        &self,
        attempt: &RunAttemptRequest,
        payload: &[u8],
    ) -> Result<(), AgentRunPortError> {
        // For a durable process-host attachment, the host is the sole Native
        // Audit owner and appends this frame immediately before writing stdin.
        // The parent still invokes this gate so controls never bypass the
        // audit-first boundary; the host-owned path is intentionally a no-op
        // here to avoid duplicating the frame in a second writer.
        let mut writers = self.audit_writers.lock().await;
        let writer = writers.get_mut(&attempt.run_attempt_id).ok_or_else(|| {
            AgentRunPortError::Unavailable("Native Audit writer is not attached".to_string())
        })?;
        writer
            .append_native_input(
                NativeAuditChannel::Stdin,
                "application/x-ndjson",
                attempt.correlation_id,
                payload,
            )
            .map(|_| ())
            .map_err(port_audit)
    }

    async fn finalize_audit(&self, attempt: &RunAttemptRequest) -> Result<(), AgentRunPortError> {
        let Some(mut writer) = self
            .audit_writers
            .lock()
            .await
            .remove(&attempt.run_attempt_id)
        else {
            return Err(AgentRunPortError::Unavailable(
                "Native Audit writer disappeared before close".to_string(),
            ));
        };
        match writer.close_with_status(NativeAuditIntegrityStatus::Complete) {
            Ok(manifest) => NativeAuditStreamRecord::finalize(&self.db.pool, &manifest)
                .await
                .map_err(port_database),
            Err(close_error) => {
                match writer.fail_closed() {
                    Ok(manifest) => {
                        if let Err(error) =
                            NativeAuditStreamRecord::finalize(&self.db.pool, &manifest).await
                        {
                            tracing::error!(
                                run_attempt_id = %attempt.run_attempt_id,
                                %error,
                                "failed to persist fail-closed Native Audit manifest"
                            );
                        }
                    }
                    Err(error) => tracing::error!(
                        run_attempt_id = %attempt.run_attempt_id,
                        %error,
                        "Native Audit close failed and fail-closed manifest could not be written"
                    ),
                }
                Err(port_audit(close_error))
            }
        }
    }

    async fn fail_audit_writer(&self, attempt: &RunAttemptRequest) {
        let Some(mut writer) = self
            .audit_writers
            .lock()
            .await
            .remove(&attempt.run_attempt_id)
        else {
            return;
        };
        match writer.fail_closed() {
            Ok(manifest) => {
                if let Err(error) =
                    NativeAuditStreamRecord::finalize(&self.db.pool, &manifest).await
                {
                    tracing::error!(
                        run_attempt_id = %attempt.run_attempt_id,
                        %error,
                        "failed to finalize failed Native Audit index"
                    );
                }
            }
            Err(error) => tracing::error!(
                run_attempt_id = %attempt.run_attempt_id,
                %error,
                "Native Audit failed closed without a final manifest"
            ),
        }
    }

    async fn terminalize_failure(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        status: AgentRunStatus,
        error: AgentRuntimeError,
    ) {
        self.append_recoverable(
            request,
            attempt,
            AgentEventPayload::Error { error },
            Vec::new(),
            Utc::now(),
            None,
        )
        .await;
        self.append_recoverable(
            request,
            attempt,
            AgentEventPayload::LifecycleChanged { status },
            Vec::new(),
            Utc::now(),
            None,
        )
        .await;
    }

    async fn launch_process_host(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        provider: DirectProvider,
        launch: &FrozenDirectProviderLaunchSpec,
    ) -> Result<(), AgentRunPortError> {
        // A create/outbox acknowledgement can be lost after the durable host
        // reservation has been written.  Before spawning another host, always
        // try to reuse a still-reserved endpoint.  The reservation is the
        // idempotency fence: even when host_pid has not been persisted yet,
        // the existing host may already be alive and accepting its launch.
        let existing: Option<(String, String, Option<String>, String)> = sqlx::query_as(
            r#"
            SELECT host_endpoint, host_token, host_instance_id, registry_status
            FROM agent_process_registry
            WHERE run_attempt_id = ?
              AND host_endpoint IS NOT NULL AND host_token IS NOT NULL
            "#,
        )
        .bind(attempt.run_attempt_id)
        .fetch_optional(&self.db.pool)
        .await
        .map_err(port_database)?;
        if let Some((endpoint, token, host_instance_id, registry_status)) = existing
            && registry_status == "reserved"
        {
            let versions = provider.versions();
            let audited_launch_payload = launch
                .audit_payload()
                .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
            let launch_request = HostLaunchRequest {
                run_attempt_id: attempt.run_attempt_id,
                provider,
                executor_config: launch.executor_config.clone(),
                intent: launch.intent,
                prompt: launch.prompt.clone(),
                provider_session: launch.provider_session.clone(),
                reset_to_message_id: launch.reset_to_message_id.clone(),
                selected_skills: launch.selected_skills.clone(),
                current_dir: launch.current_dir.clone(),
                env: HostExecutionEnv::from(&launch.env),
                audit_metadata: NativeAuditMetadata {
                    session_id: request.session_id,
                    agent_run_id: request.agent_run_id,
                    turn_id: request.turn_id,
                    run_attempt_id: attempt.run_attempt_id,
                    run_attempt_number: attempt.attempt_number,
                    provider_id: provider.id().to_string(),
                    runtime_profile_id: request.runtime_profile_id.clone(),
                    workspace_path: request.workspace.path.clone(),
                    runtime_version: versions.runtime.map(str::to_owned),
                    protocol_version: versions.protocol.map(str::to_owned),
                    adapter_version: versions.adapter.to_string(),
                    mapper_version: versions.mapper.to_string(),
                    created_at: Utc::now(),
                },
                canonical_input: request.input.clone(),
                correlation_id: request.correlation_id,
                audited_launch_payload,
            };
            match send_host_command(&endpoint, &token, HostCommand::Launch(launch_request)).await {
                Ok(response) => {
                    if let Some(expected) = host_instance_id
                        && response.host_instance_id.to_string() != expected
                    {
                        return Err(AgentRunPortError::Unavailable(
                            "process host identity did not match persisted reservation".to_string(),
                        ));
                    }
                    if let Some(error) = response.error {
                        return Err(AgentRunPortError::Unavailable(error));
                    }
                    self.apply_host_events(request, attempt, response.events)
                        .await?;
                }
                Err(error) => {
                    // The launch may have reached the host even when its ACK
                    // was lost.  Preserve the reservation and let the durable
                    // observer/reconciliation loop attach later; never spawn a
                    // replacement process from an uncertain acknowledgement.
                    let port = self.clone();
                    let request = request.clone();
                    let run_attempt_id = attempt.run_attempt_id;
                    let attempt = attempt.clone();
                    tokio::spawn(async move {
                        port.observe_process_host(request, attempt).await;
                    });
                    tracing::debug!(
                        run_attempt_id = %run_attempt_id,
                        %error,
                        "existing process-host launch response unavailable; preserving reservation"
                    );
                    return Ok(());
                }
            }
            let port = self.clone();
            let request = request.clone();
            let attempt = attempt.clone();
            tokio::spawn(async move {
                port.observe_process_host(request, attempt).await;
            });
            return Ok(());
        }

        let host_instance_id = Uuid::new_v4();
        let mut token_bytes = [0_u8; 32];
        OsRng.fill_bytes(&mut token_bytes);
        let auth_token = token_bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let endpoint_reservation = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
        let requested_endpoint = endpoint_reservation
            .local_addr()
            .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?
            .to_string();
        drop(endpoint_reservation);
        AgentRunRecord::reserve_process_host(
            &self.db.pool,
            attempt.run_attempt_id,
            &requested_endpoint,
            &auth_token,
            host_instance_id,
        )
        .await
        .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
        let host_executable = match resolve_process_host_executable() {
            Ok(path) => path,
            Err(error) => {
                self.cleanup_failed_process_host_launch(attempt.run_attempt_id, None)
                    .await;
                return Err(error);
            }
        };
        let mut child = match Command::new(host_executable)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                self.cleanup_failed_process_host_launch(attempt.run_attempt_id, None)
                    .await;
                return Err(AgentRunPortError::Unavailable(error.to_string()));
            }
        };
        let host_pid = match child.id() {
            Some(pid) => pid,
            None => {
                self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                    .await;
                return Err(AgentRunPortError::Unavailable(
                    "process host has no OS pid".to_string(),
                ));
            }
        };
        let mut child_stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                    .await;
                return Err(AgentRunPortError::Unavailable(
                    "process host stdin is unavailable".to_string(),
                ));
            }
        };
        if let Err(error) = write_json_frame(
            &mut child_stdin,
            &HostBootstrap {
                protocol_version: 1,
                run_attempt_id: attempt.run_attempt_id,
                host_instance_id,
                auth_token: auth_token.clone(),
                requested_endpoint: requested_endpoint.clone(),
            },
        )
        .await
        {
            self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                .await;
            return Err(AgentRunPortError::Unavailable(error.to_string()));
        }
        drop(child_stdin);
        let mut child_stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                    .await;
                return Err(AgentRunPortError::Unavailable(
                    "process host stdout is unavailable".to_string(),
                ));
            }
        };
        let ready: HostReady = match read_json_frame(&mut child_stdout).await {
            Ok(ready) => ready,
            Err(error) => {
                self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                    .await;
                return Err(AgentRunPortError::Unavailable(error.to_string()));
            }
        };
        if ready.protocol_version != 1
            || ready.host_instance_id != host_instance_id
            || ready.host_pid != host_pid
        {
            self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                .await;
            return Err(AgentRunPortError::Unavailable(
                "process host handshake did not match the reservation".to_string(),
            ));
        }

        if ready.endpoint != requested_endpoint {
            self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                .await;
            return Err(AgentRunPortError::Unavailable(
                "process host bound a different endpoint than reserved".to_string(),
            ));
        }
        if let Err(error) = AgentRunRecord::mark_process_host_attached(
            &self.db.pool,
            attempt.run_attempt_id,
            host_pid,
        )
        .await
        {
            self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                .await;
            return Err(AgentRunPortError::Unavailable(error.to_string()));
        }

        let versions = provider.versions();
        let launch_request = HostLaunchRequest {
            run_attempt_id: attempt.run_attempt_id,
            provider,
            executor_config: launch.executor_config.clone(),
            intent: launch.intent,
            prompt: launch.prompt.clone(),
            provider_session: launch.provider_session.clone(),
            reset_to_message_id: launch.reset_to_message_id.clone(),
            selected_skills: launch.selected_skills.clone(),
            current_dir: launch.current_dir.clone(),
            env: HostExecutionEnv::from(&launch.env),
            audit_metadata: NativeAuditMetadata {
                session_id: request.session_id,
                agent_run_id: request.agent_run_id,
                turn_id: request.turn_id,
                run_attempt_id: attempt.run_attempt_id,
                run_attempt_number: attempt.attempt_number,
                provider_id: provider.id().to_string(),
                runtime_profile_id: request.runtime_profile_id.clone(),
                workspace_path: request.workspace.path.clone(),
                runtime_version: versions.runtime.map(str::to_owned),
                protocol_version: versions.protocol.map(str::to_owned),
                adapter_version: versions.adapter.to_string(),
                mapper_version: versions.mapper.to_string(),
                created_at: Utc::now(),
            },
            canonical_input: request.input.clone(),
            correlation_id: request.correlation_id,
            audited_launch_payload: match launch.audit_payload() {
                Ok(payload) => payload,
                Err(error) => {
                    self.cleanup_failed_process_host_launch(
                        attempt.run_attempt_id,
                        Some(&mut child),
                    )
                    .await;
                    return Err(AgentRunPortError::Unavailable(error.to_string()));
                }
            },
        };
        let response = send_host_command(
            &ready.endpoint,
            &auth_token,
            HostCommand::Launch(launch_request),
        )
        .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                // The command may have reached the durable host even when its
                // response was lost. Preserve the reservation and reconnect
                // through the host event cursor instead of killing a provider
                // that may already be running.
                let run_attempt_id = attempt.run_attempt_id;
                let port = self.clone();
                let request = request.clone();
                let attempt = attempt.clone();
                tokio::spawn(async move {
                    port.observe_process_host(request, attempt).await;
                });
                tokio::spawn(async move {
                    if let Err(wait_error) = child.wait().await {
                        tracing::debug!(%wait_error, "process host reaper lost its child handle");
                    }
                });
                tracing::debug!(run_attempt_id = %run_attempt_id, %error, "process host launch response unavailable; preserving durable host attachment");
                return Ok(());
            }
        };
        if let Some(error) = response.error {
            self.cleanup_failed_process_host_launch(attempt.run_attempt_id, Some(&mut child))
                .await;
            return Err(AgentRunPortError::Unavailable(error));
        }
        self.apply_host_events(request, attempt, response.events)
            .await?;
        let port = self.clone();
        let request = request.clone();
        let attempt = attempt.clone();
        tokio::spawn(async move {
            port.observe_process_host(request, attempt).await;
        });
        tokio::spawn(async move {
            if let Err(error) = child.wait().await {
                tracing::debug!(%error, "process host reaper lost its child handle");
            }
        });
        Ok(())
    }

    async fn observe_process_host(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
    ) {
        loop {
            let attachment: Option<(String, String, i64, String)> = sqlx::query_as(
                r#"
                SELECT host_endpoint, host_token, last_host_event_sequence, registry_status
                FROM agent_process_registry
                WHERE run_attempt_id = ? AND host_endpoint IS NOT NULL AND host_token IS NOT NULL
                "#,
            )
            .bind(attempt.run_attempt_id)
            .fetch_optional(&self.db.pool)
            .await
            .ok()
            .flatten();
            let Some((endpoint, token, cursor, registry_status)) = attachment else {
                return;
            };
            if registry_status == "exited" {
                return;
            }
            let after_sequence = u64::try_from(cursor).unwrap_or_default();
            match send_host_command(&endpoint, &token, HostCommand::Attach { after_sequence }).await
            {
                Ok(response) => {
                    if let Some(error) = response.error {
                        tracing::warn!(run_attempt_id = %attempt.run_attempt_id, %error, "process host rejected attach");
                    } else if let Err(error) = self
                        .apply_host_events(&request, &attempt, response.events)
                        .await
                    {
                        tracing::error!(run_attempt_id = %attempt.run_attempt_id, %error, "failed to project process-host observations");
                    }
                    let status: Option<String> = sqlx::query_scalar(
                        "SELECT registry_status FROM agent_process_registry WHERE run_attempt_id = ?",
                    )
                    .bind(attempt.run_attempt_id)
                    .fetch_optional(&self.db.pool)
                    .await
                    .ok()
                    .flatten();
                    if status.as_deref() == Some("exited") {
                        return;
                    }
                }
                Err(error) => {
                    if let Err(mark_error) = AgentRunRecord::mark_process_host_unreachable(
                        &self.db.pool,
                        attempt.run_attempt_id,
                    )
                    .await
                    {
                        tracing::error!(run_attempt_id = %attempt.run_attempt_id, %mark_error, "failed to persist unreachable process host");
                    }
                    tracing::debug!(run_attempt_id = %attempt.run_attempt_id, %error, "process host is temporarily unreachable");
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    async fn apply_host_events(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        events: Vec<crate::process_host::HostEvent>,
    ) -> Result<(), AgentRunPortError> {
        for event in events {
            let terminal = matches!(&event.payload, HostEventPayload::Terminal { .. });
            match event.payload {
                HostEventPayload::Started {
                    provider_pid,
                    process_group_id,
                    executable,
                    canonical_input_ref,
                    audit_manifest,
                } => {
                    self.ensure_audit_stream(&audit_manifest).await?;
                    AgentRunRecord::mark_process_started(
                        &self.db.pool,
                        attempt.run_attempt_id,
                        provider_pid,
                        process_group_id,
                        Some(&executable),
                        event.timestamp,
                    )
                    .await
                    .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
                    let registered = RegisteredAgentProcess::new(
                        attempt.run_attempt_id,
                        Some(request.session_id),
                        Some(request.workspace.workspace_id),
                        Some(request.provider_id.clone()),
                        provider_pid,
                        process_group_id,
                        Some(executable),
                    );
                    self.process_registry
                        .register(registered)
                        .await
                        .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
                    self.append_recoverable(
                        request,
                        attempt,
                        AgentEventPayload::Message {
                            message: request.input.clone(),
                            final_output: false,
                        },
                        vec![canonical_input_ref],
                        request.created_at,
                        Some(request.input.message_id),
                    )
                    .await;
                    self.append_recoverable(
                        request,
                        attempt,
                        AgentEventPayload::LifecycleChanged {
                            status: AgentRunStatus::Running,
                        },
                        Vec::new(),
                        event.timestamp,
                        Some(event.event_id),
                    )
                    .await;
                }
                HostEventPayload::Mapped {
                    event: mapped,
                    native_ref,
                } => {
                    self.append_mapped_event(request, attempt, mapped, native_ref)
                        .await;
                }
                HostEventPayload::Terminal {
                    status,
                    error,
                    error_event_id,
                    exit_code,
                    audit_manifest,
                } => {
                    self.ensure_audit_stream(&audit_manifest).await?;
                    NativeAuditStreamRecord::finalize(&self.db.pool, &audit_manifest)
                        .await
                        .map_err(port_database)?;
                    if let Some(error) = error {
                        self.append_recoverable(
                            request,
                            attempt,
                            AgentEventPayload::Error { error },
                            Vec::new(),
                            event.timestamp,
                            error_event_id,
                        )
                        .await;
                    }
                    // A transient snapshot/read failure must not discard the
                    // host's durable terminal fact.  Append it and let the
                    // canonical projection path report degradation; when a
                    // successful read proves the run is already terminal,
                    // the reducer's terminal guard makes a duplicate safe.
                    let should_append_terminal = self
                        .query(request.agent_run_id)
                        .await
                        .map(|current| !current.state.status.is_terminal())
                        .unwrap_or(true);
                    if should_append_terminal {
                        self.append_recoverable(
                            request,
                            attempt,
                            AgentEventPayload::LifecycleChanged { status },
                            Vec::new(),
                            event.timestamp,
                            Some(event.event_id),
                        )
                        .await;
                    }
                    // A provider can fail before a child is spawned. In that
                    // case the host emits a terminal event without Started,
                    // and the registry must remain `reserved` to satisfy its
                    // CHECK constraints. Once a PID exists, transition it to
                    // exited exactly once and remove the local projection.
                    let pid: Option<i64> = sqlx::query_scalar(
                        "SELECT pid FROM agent_process_registry WHERE run_attempt_id = ?",
                    )
                    .bind(attempt.run_attempt_id)
                    .fetch_optional(&self.db.pool)
                    .await
                    .map_err(port_database)?;
                    if pid.is_some() {
                        AgentRunRecord::mark_process_exited(
                            &self.db.pool,
                            attempt.run_attempt_id,
                            exit_code,
                            event.timestamp,
                        )
                        .await
                        .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
                        if let Err(error) = self
                            .process_registry
                            .remove_runtime(attempt.run_attempt_id)
                            .await
                        {
                            tracing::warn!(run_attempt_id = %attempt.run_attempt_id, %error, "failed to remove exited process registry entry");
                        }
                    }
                }
            }
            AgentRunRecord::advance_process_host_cursor(
                &self.db.pool,
                attempt.run_attempt_id,
                event.sequence,
            )
            .await
            .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
            if terminal {
                if let Some((endpoint, token)) = self.load_host_attachment(attempt).await? {
                    let _ = send_host_command(
                        &endpoint,
                        &token,
                        HostCommand::AckTerminal {
                            through_sequence: event.sequence,
                        },
                    )
                    .await;
                }
            }
        }
        Ok(())
    }

    async fn ensure_audit_stream(
        &self,
        manifest: &executors::runtime::NativeAuditManifest,
    ) -> Result<(), AgentRunPortError> {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM native_audit_streams WHERE run_attempt_id = ?)",
        )
        .bind(manifest.run_attempt_id)
        .fetch_one(&self.db.pool)
        .await
        .map_err(port_database)?;
        if !exists {
            NativeAuditStreamRecord::insert_open(&self.db.pool, manifest)
                .await
                .map_err(port_database)?;
        }
        Ok(())
    }

    async fn load_host_attachment(
        &self,
        attempt: &RunAttemptRequest,
    ) -> Result<Option<(String, String)>, AgentRunPortError> {
        sqlx::query_as(
            "SELECT host_endpoint, host_token FROM agent_process_registry WHERE run_attempt_id = ? AND host_endpoint IS NOT NULL AND host_token IS NOT NULL",
        )
        .bind(attempt.run_attempt_id)
        .fetch_optional(&self.db.pool)
        .await
            .map_err(port_database)
    }

    async fn load_host_cursor(
        &self,
        attempt: &RunAttemptRequest,
    ) -> Result<u64, AgentRunPortError> {
        let cursor: Option<i64> = sqlx::query_scalar(
            "SELECT last_host_event_sequence FROM agent_process_registry WHERE run_attempt_id = ?",
        )
        .bind(attempt.run_attempt_id)
        .fetch_optional(&self.db.pool)
        .await
        .map_err(port_database)?;
        Ok(cursor
            .and_then(|value| u64::try_from(value).ok())
            .unwrap_or_default())
    }

    async fn start_attempt(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
        workspace: Workspace,
    ) {
        {
            let mut launching = self.launching_attempts.lock().await;
            if !launching.insert(attempt.run_attempt_id) {
                return;
            }
        }
        let run_attempt_id = attempt.run_attempt_id;
        self.start_attempt_reserved(request, attempt, workspace)
            .await;
        self.launching_attempts.lock().await.remove(&run_attempt_id);
    }

    async fn start_attempt_reserved(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
        workspace: Workspace,
    ) {
        if self
            .children
            .read()
            .await
            .contains_key(&attempt.run_attempt_id)
        {
            return;
        }
        let registry: Option<(String, Option<i64>)> = sqlx::query_as(
            "SELECT registry_status, pid FROM agent_process_registry WHERE run_attempt_id = ?",
        )
        .bind(attempt.run_attempt_id)
        .fetch_optional(&self.db.pool)
        .await
        .ok()
        .flatten();
        if let Some((status, pid)) = registry {
            if matches!(status.as_str(), "spawned" | "running" | "unreachable") && pid.is_some() {
                return;
            }
            if status == "exited" {
                return;
            }
        }

        let provider = match self.provider(&request.provider_id) {
            Ok(provider) => provider,
            Err(error) => {
                self.terminalize_failure(
                    &request,
                    &attempt,
                    AgentRunStatus::Failed,
                    AgentRuntimeError::new(AgentRuntimeErrorKind::StartupFailed, error.to_string()),
                )
                .await;
                return;
            }
        };
        let env = match self.execution_env(&request, &attempt, &workspace).await {
            Ok(env) => env,
            Err(error) => {
                self.terminalize_failure(
                    &request,
                    &attempt,
                    AgentRunStatus::Failed,
                    AgentRuntimeError::new(AgentRuntimeErrorKind::StartupFailed, error.to_string())
                        .with_provider(Some(provider.id())),
                )
                .await;
                return;
            }
        };
        let launch = FrozenDirectProviderLaunchSpec::new(&request, &attempt, provider, env);
        self.append_recoverable(
            &request,
            &attempt,
            AgentEventPayload::LifecycleChanged {
                status: AgentRunStatus::Starting,
            },
            Vec::new(),
            Utc::now(),
            None,
        )
        .await;

        if let Err(error) = self
            .launch_process_host(&request, &attempt, provider, &launch)
            .await
        {
            self.terminalize_failure(
                &request,
                &attempt,
                if matches!(error, AgentRunPortError::Unavailable(_)) {
                    AgentRunStatus::AuditFailed
                } else {
                    AgentRunStatus::Failed
                },
                AgentRuntimeError::new(AgentRuntimeErrorKind::StartupFailed, error.to_string())
                    .with_provider(Some(provider.id())),
            )
            .await;
        }
        /*
        let mut spawned = match launch_direct_provider(launch.launch_request()).await {
            Ok(spawned) => spawned,
            Err(error) => {
                let runtime_error =
                    AgentRuntimeError::from_executor_error(&error, Some(provider.id()));
                if let Err(audit_error) = self.finalize_audit(&attempt).await {
                    self.terminalize_failure(
                        &request,
                        &attempt,
                        AgentRunStatus::AuditFailed,
                        AgentRuntimeError::new(
                            AgentRuntimeErrorKind::Unknown,
                            audit_error.to_string(),
                        )
                        .with_provider(Some(provider.id())),
                    )
                    .await;
                } else {
                    self.terminalize_failure(
                        &request,
                        &attempt,
                        AgentRunStatus::Failed,
                        runtime_error,
                    )
                    .await;
                }
                return;
            }
        };

        let Some(pid) = spawned.child.inner().id() else {
            let _ = utils::process::kill_process_group(&mut spawned.child).await;
            self.fail_audit_writer(&attempt).await;
            self.terminalize_failure(
                &request,
                &attempt,
                AgentRunStatus::Crashed,
                AgentRuntimeError::new(
                    AgentRuntimeErrorKind::ProcessCrashed,
                    "spawned AgentRun process has no OS pid",
                )
                .with_provider(Some(provider.id())),
            )
            .await;
            return;
        };
        let registered = RegisteredAgentProcess::new(
            attempt.run_attempt_id,
            Some(request.session_id),
            Some(request.workspace.workspace_id),
            Some(provider.id().to_string()),
            pid,
            Some(pid),
            Some(provider.versions().executable.to_string()),
        );
        if let Err(error) = self.process_registry.register(registered).await {
            let _ = utils::process::kill_process_group(&mut spawned.child).await;
            self.fail_audit_writer(&attempt).await;
            self.terminalize_failure(
                &request,
                &attempt,
                AgentRunStatus::Failed,
                AgentRuntimeError::new(AgentRuntimeErrorKind::StartupFailed, error.to_string())
                    .with_provider(Some(provider.id())),
            )
            .await;
            return;
        }
        if let Err(error) = AgentRunRecord::mark_process_started(
            &self.db.pool,
            attempt.run_attempt_id,
            pid,
            Some(pid),
            Some(provider.versions().executable),
            Utc::now(),
        )
        .await
        {
            let _ = utils::process::kill_process_group(&mut spawned.child).await;
            let _ = self
                .process_registry
                .remove_runtime(attempt.run_attempt_id)
                .await;
            self.fail_audit_writer(&attempt).await;
            self.terminalize_failure(
                &request,
                &attempt,
                AgentRunStatus::Failed,
                AgentRuntimeError::new(AgentRuntimeErrorKind::StartupFailed, error.to_string())
                    .with_provider(Some(provider.id())),
            )
            .await;
            return;
        }

        let Some(stdout) = spawned.child.inner().stdout.take() else {
            let _ = utils::process::kill_process_group(&mut spawned.child).await;
            self.fail_started_attempt(
                &request,
                &attempt,
                provider,
                "process stdout is unavailable",
            )
            .await;
            return;
        };
        let Some(stderr) = spawned.child.inner().stderr.take() else {
            let _ = utils::process::kill_process_group(&mut spawned.child).await;
            self.fail_started_attempt(
                &request,
                &attempt,
                provider,
                "process stderr is unavailable",
            )
            .await;
            return;
        };
        let child = Arc::new(RwLock::new(spawned.child));
        self.children
            .write()
            .await
            .insert(attempt.run_attempt_id, child.clone());
        if let Some(cancel) = spawned.cancel {
            self.cancellation_tokens
                .write()
                .await
                .insert(attempt.run_attempt_id, cancel);
        }
        self.append_recoverable(
            &request,
            &attempt,
            AgentEventPayload::LifecycleChanged {
                status: AgentRunStatus::Running,
            },
            Vec::new(),
            Utc::now(),
            None,
        )
        .await;

        let (output_tx, output_rx) = mpsc::unbounded_channel();
        self.spawn_stdout_reader(
            request.clone(),
            attempt.clone(),
            provider,
            stdout,
            output_tx.clone(),
        );
        self.spawn_stderr_reader(attempt.clone(), stderr, output_tx);
        self.spawn_attempt_monitor(
            request,
            attempt,
            provider,
            child,
            spawned.exit_signal,
            output_rx,
        );
        */
    }

    async fn fail_started_attempt(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
        provider: DirectProvider,
        message: &str,
    ) {
        let _ = AgentRunRecord::mark_process_exited(
            &self.db.pool,
            attempt.run_attempt_id,
            None,
            Utc::now(),
        )
        .await;
        let _ = self
            .process_registry
            .remove_runtime(attempt.run_attempt_id)
            .await;
        match self.finalize_audit(attempt).await {
            Ok(()) => {
                self.terminalize_failure(
                    request,
                    attempt,
                    AgentRunStatus::Crashed,
                    AgentRuntimeError::new(AgentRuntimeErrorKind::ProcessCrashed, message)
                        .with_provider(Some(provider.id())),
                )
                .await;
            }
            Err(error) => {
                self.terminalize_failure(
                    request,
                    attempt,
                    AgentRunStatus::AuditFailed,
                    AgentRuntimeError::new(AgentRuntimeErrorKind::Unknown, error.to_string())
                        .with_provider(Some(provider.id())),
                )
                .await;
            }
        }
    }

    fn spawn_stdout_reader(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
        provider: DirectProvider,
        stdout: tokio::process::ChildStdout,
        notices: mpsc::UnboundedSender<OutputNotice>,
    ) {
        let port = self.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                match reader.read_until(b'\n', &mut bytes).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let (frame, native_ref) = match port
                            .append_audit_bytes(
                                &attempt,
                                NativeAuditChannel::Stdout,
                                "application/json",
                                &bytes,
                            )
                            .await
                        {
                            Ok(value) => value,
                            Err(error) => {
                                let _ = notices.send(OutputNotice::AuditFailure(error.to_string()));
                                break;
                            }
                        };
                        let decoded = match provider.decode_native_frame(&frame) {
                            Ok(decoded) => decoded,
                            Err(error) => {
                                let _ =
                                    notices.send(OutputNotice::ProtocolFailure(error.to_string()));
                                break;
                            }
                        };
                        let mapped = {
                            let writers = port.audit_writers.lock().await;
                            let Some(writer) = writers.get(&attempt.run_attempt_id) else {
                                let _ = notices.send(OutputNotice::AuditFailure(
                                    "Native Audit writer disappeared during decode".to_string(),
                                ));
                                break;
                            };
                            provider.map_provider_event(&decoded, writer.manifest())
                        };
                        let mapped = match mapped {
                            Ok(mapped) => mapped,
                            Err(error) => {
                                let _ =
                                    notices.send(OutputNotice::ProtocolFailure(error.to_string()));
                                break;
                            }
                        };
                        for event in mapped {
                            let terminal_status = match &event.payload {
                                AgentEventPayload::LifecycleChanged { status }
                                    if status.is_terminal() =>
                                {
                                    Some(*status)
                                }
                                _ => None,
                            };
                            port.append_mapped_event(&request, &attempt, event, native_ref.clone())
                                .await;
                            if let Some(status) = terminal_status {
                                let _ = notices.send(OutputNotice::ProviderTerminal(status));
                                break;
                            }
                        }
                    }
                    Err(error) => {
                        let _ = notices.send(OutputNotice::ProtocolFailure(error.to_string()));
                        break;
                    }
                }
            }
            let _ = notices.send(OutputNotice::StdoutClosed);
        });
    }

    fn spawn_stderr_reader(
        &self,
        attempt: RunAttemptRequest,
        stderr: tokio::process::ChildStderr,
        notices: mpsc::UnboundedSender<OutputNotice>,
    ) {
        let port = self.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            loop {
                let mut bytes = Vec::new();
                match reader.read_until(b'\n', &mut bytes).await {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Err(error) = port
                            .append_audit_bytes(
                                &attempt,
                                NativeAuditChannel::Stderr,
                                "text/plain",
                                &bytes,
                            )
                            .await
                        {
                            let _ = notices.send(OutputNotice::AuditFailure(error.to_string()));
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = notices.send(OutputNotice::ProtocolFailure(error.to_string()));
                        break;
                    }
                }
            }
            let _ = notices.send(OutputNotice::StderrClosed);
        });
    }

    fn spawn_attempt_monitor(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
        provider: DirectProvider,
        child: SharedChild,
        exit_signal: Option<ExecutorExitSignal>,
        mut output_rx: mpsc::UnboundedReceiver<OutputNotice>,
    ) {
        let port = self.clone();
        tokio::spawn(async move {
            let mut stdout_closed = false;
            let mut stderr_closed = false;
            let mut exit_signal: ExitSignalFuture = match exit_signal {
                Some(signal) => Box::pin(signal),
                None => Box::pin(std::future::pending()),
            };
            let mut process_exit = Box::pin(wait_for_process_exit(child.clone()));
            let outcome = loop {
                tokio::select! {
                    result = &mut exit_signal => {
                        break match result {
                            Ok(result) => AttemptExit::Executor(result),
                            Err(_) => AttemptExit::ExecutorChannelClosed,
                        };
                    }
                    result = &mut process_exit => {
                        break match result {
                            Ok((success, code)) => AttemptExit::Process { success, code },
                            Err(error) => AttemptExit::WatcherFailed(error.to_string()),
                        };
                    }
                    notice = output_rx.recv(), if !(stdout_closed && stderr_closed) => {
                        match notice {
                            Some(OutputNotice::StdoutClosed) => stdout_closed = true,
                            Some(OutputNotice::StderrClosed) => stderr_closed = true,
                            Some(OutputNotice::ProviderTerminal(status)) => {
                                break AttemptExit::ProviderTerminal(status);
                            }
                            Some(failure @ (OutputNotice::AuditFailure(_) | OutputNotice::ProtocolFailure(_))) => {
                                break AttemptExit::OutputFailure(failure);
                            }
                            None => {
                                stdout_closed = true;
                                stderr_closed = true;
                            }
                        }
                    }
                }
            };

            if !matches!(outcome, AttemptExit::Process { .. }) {
                let mut child = child.write().await;
                let _ = utils::process::kill_process_group(&mut child).await;
            }
            let mut post_exit_failure = None;
            while !(stdout_closed && stderr_closed) {
                match output_rx.recv().await {
                    Some(OutputNotice::StdoutClosed) => stdout_closed = true,
                    Some(OutputNotice::StderrClosed) => stderr_closed = true,
                    Some(OutputNotice::ProviderTerminal(_)) => {}
                    Some(OutputNotice::AuditFailure(error)) => {
                        post_exit_failure = Some(OutputNotice::AuditFailure(error));
                    }
                    Some(OutputNotice::ProtocolFailure(error)) if post_exit_failure.is_none() => {
                        post_exit_failure = Some(OutputNotice::ProtocolFailure(error));
                    }
                    Some(OutputNotice::ProtocolFailure(_)) => {}
                    None => break,
                }
            }

            let exit_code = match &outcome {
                AttemptExit::Executor(ExecutorExitResult::Success) => Some(0),
                AttemptExit::Executor(ExecutorExitResult::Failure) => Some(1),
                AttemptExit::ProviderTerminal(AgentRunStatus::Succeeded) => Some(0),
                AttemptExit::ProviderTerminal(_) => None,
                AttemptExit::Process { code, .. } => *code,
                _ => None,
            };
            let audit_result = port.finalize_audit(&attempt).await;
            let current = port.query(request.agent_run_id).await.ok();
            if let Err(error) = audit_result {
                port.terminalize_failure(
                    &request,
                    &attempt,
                    AgentRunStatus::AuditFailed,
                    AgentRuntimeError::new(AgentRuntimeErrorKind::Unknown, error.to_string())
                        .with_provider(Some(provider.id())),
                )
                .await;
            } else if let Some(OutputNotice::AuditFailure(error)) = post_exit_failure.as_ref() {
                port.terminalize_failure(
                    &request,
                    &attempt,
                    AgentRunStatus::AuditFailed,
                    AgentRuntimeError::new(AgentRuntimeErrorKind::Unknown, error)
                        .with_provider(Some(provider.id())),
                )
                .await;
            } else if current
                .as_ref()
                .is_some_and(|snapshot| snapshot.state.status == AgentRunStatus::Cancelling)
            {
                port.append_recoverable(
                    &request,
                    &attempt,
                    AgentEventPayload::LifecycleChanged {
                        status: AgentRunStatus::Cancelled,
                    },
                    Vec::new(),
                    Utc::now(),
                    None,
                )
                .await;
            } else if current
                .as_ref()
                .is_some_and(|snapshot| snapshot.state.status.is_terminal())
            {
                // A provider terminal fact or explicit cancellation is already
                // canonical. A late OS/adapter observation must not overwrite it.
            } else {
                let failure = post_exit_failure.or_else(|| match &outcome {
                    AttemptExit::OutputFailure(OutputNotice::AuditFailure(error)) => {
                        Some(OutputNotice::AuditFailure(error.clone()))
                    }
                    AttemptExit::OutputFailure(OutputNotice::ProtocolFailure(error)) => {
                        Some(OutputNotice::ProtocolFailure(error.clone()))
                    }
                    _ => None,
                });
                match failure {
                    Some(OutputNotice::AuditFailure(error)) => {
                        port.terminalize_failure(
                            &request,
                            &attempt,
                            AgentRunStatus::AuditFailed,
                            AgentRuntimeError::new(AgentRuntimeErrorKind::Unknown, error)
                                .with_provider(Some(provider.id())),
                        )
                        .await;
                    }
                    Some(OutputNotice::ProtocolFailure(error)) => {
                        port.terminalize_failure(
                            &request,
                            &attempt,
                            AgentRunStatus::Failed,
                            AgentRuntimeError::new(AgentRuntimeErrorKind::OutputParseFailed, error)
                                .with_provider(Some(provider.id())),
                        )
                        .await;
                    }
                    _ => match outcome {
                        AttemptExit::Executor(ExecutorExitResult::Success) => {
                            port.append_recoverable(
                                &request,
                                &attempt,
                                AgentEventPayload::LifecycleChanged {
                                    status: AgentRunStatus::Succeeded,
                                },
                                Vec::new(),
                                Utc::now(),
                                None,
                            )
                            .await;
                        }
                        AttemptExit::Executor(ExecutorExitResult::Failure) => {
                            port.terminalize_failure(
                                &request,
                                &attempt,
                                AgentRunStatus::Failed,
                                AgentRuntimeError::new(
                                    AgentRuntimeErrorKind::Unknown,
                                    "provider executor reported failure",
                                )
                                .with_provider(Some(provider.id())),
                            )
                            .await;
                        }
                        AttemptExit::ExecutorChannelClosed => {
                            port.terminalize_failure(
                                &request,
                                &attempt,
                                AgentRunStatus::Crashed,
                                AgentRuntimeError::new(
                                    AgentRuntimeErrorKind::ProcessCrashed,
                                    "provider exit signal closed without a terminal result",
                                )
                                .with_provider(Some(provider.id())),
                            )
                            .await;
                        }
                        AttemptExit::ProviderTerminal(status) => {
                            port.append_recoverable(
                                &request,
                                &attempt,
                                AgentEventPayload::LifecycleChanged { status },
                                Vec::new(),
                                Utc::now(),
                                None,
                            )
                            .await;
                        }
                        AttemptExit::Process {
                            success: false,
                            code,
                        } => {
                            port.terminalize_failure(
                                &request,
                                &attempt,
                                AgentRunStatus::Failed,
                                AgentRuntimeError::new(
                                    AgentRuntimeErrorKind::ProcessCrashed,
                                    "AgentRun process exited unsuccessfully",
                                )
                                .with_provider(Some(provider.id()))
                                .with_exit_code(code.and_then(|value| i32::try_from(value).ok())),
                            )
                            .await;
                        }
                        AttemptExit::Process { success: true, .. } => {
                            // Exit code zero is not proof that a provider task
                            // completed. Providers without an explicit success
                            // event or executor signal fail closed.
                            port.terminalize_failure(
                                &request,
                                &attempt,
                                AgentRunStatus::Crashed,
                                AgentRuntimeError::new(
                                    AgentRuntimeErrorKind::ProcessCrashed,
                                    "process exited without provider success evidence",
                                )
                                .with_provider(Some(provider.id())),
                            )
                            .await;
                        }
                        AttemptExit::WatcherFailed(error) => {
                            port.terminalize_failure(
                                &request,
                                &attempt,
                                AgentRunStatus::Crashed,
                                AgentRuntimeError::new(
                                    AgentRuntimeErrorKind::ProcessCrashed,
                                    error,
                                )
                                .with_provider(Some(provider.id())),
                            )
                            .await;
                        }
                        AttemptExit::OutputFailure(_) => unreachable!(),
                    },
                }
            }

            if let Err(error) = AgentRunRecord::mark_process_exited(
                &port.db.pool,
                attempt.run_attempt_id,
                exit_code,
                Utc::now(),
            )
            .await
            {
                tracing::error!(
                    run_attempt_id = %attempt.run_attempt_id,
                    %error,
                    "failed to mark AgentRun process exited"
                );
            }
            if let Err(error) = port
                .process_registry
                .remove_runtime(attempt.run_attempt_id)
                .await
            {
                tracing::warn!(
                    run_attempt_id = %attempt.run_attempt_id,
                    %error,
                    "failed to remove local AgentRun process registry entry"
                );
            }
            port.children.write().await.remove(&attempt.run_attempt_id);
            port.cancellation_tokens
                .write()
                .await
                .remove(&attempt.run_attempt_id);
        });
    }

    async fn validate_durable_command(
        &self,
        command: &AgentRunPortCommandEnvelope,
    ) -> Result<(), AgentRunPortError> {
        let stored: Option<Json<AgentRunPortCommandEnvelope>> = sqlx::query_scalar(
            r#"
            SELECT command_envelope FROM agent_run_commands
            WHERE command_id = ? AND idempotency_key = ?
            UNION ALL
            SELECT command_envelope FROM orchestration_outbox
            WHERE command_id = ? AND idempotency_key = ?
            LIMIT 1
            "#,
        )
        .bind(command.command_id)
        .bind(&command.idempotency_key)
        .bind(command.command_id)
        .bind(&command.idempotency_key)
        .fetch_optional(&self.db.pool)
        .await
        .map_err(port_database)?;
        match stored {
            Some(stored) if stored.0 == *command => Ok(()),
            Some(_) => Err(AgentRunPortError::Rejected(
                "durable AgentRun command payload does not match delivery".to_string(),
            )),
            None => Err(AgentRunPortError::Rejected(
                "control command is not present in a durable command store".to_string(),
            )),
        }
    }

    async fn write_attached_control(
        &self,
        attempt: &RunAttemptRequest,
        bytes: &[u8],
    ) -> Result<(), AgentRunPortError> {
        if let Some((endpoint, token)) = self.load_host_attachment(attempt).await? {
            let after_sequence = self.load_host_cursor(attempt).await?;
            let response = send_host_command(
                &endpoint,
                &token,
                HostCommand::Control {
                    bytes: bytes.to_vec(),
                    cancel: false,
                    after_sequence,
                },
            )
            .await
            .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
            let (request, _) = self.load_request(attempt.agent_run_id).await?;
            self.apply_host_events(&request, attempt, response.events)
                .await?;
            return response
                .error
                .map_or(Ok(()), |error| Err(AgentRunPortError::Unavailable(error)));
        }
        Err(AgentRunPortError::Unavailable(
            "AgentRun process host attachment is not persisted".to_string(),
        ))
    }

    async fn cancel_attached_attempt(
        &self,
        request: &AgentRunRequestEnvelope,
        attempt: &RunAttemptRequest,
    ) -> Result<(), AgentRunPortError> {
        let provider = self.provider(&request.provider_id)?;
        let control = encode_control(
            provider,
            &attempt.capability_snapshot,
            DirectControl::Cancel,
        )
        .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
        if let Some((endpoint, token)) = self.load_host_attachment(attempt).await? {
            let after_sequence = self.load_host_cursor(attempt).await?;
            let response = send_host_command(
                &endpoint,
                &token,
                HostCommand::Control {
                    bytes: control,
                    cancel: true,
                    after_sequence,
                },
            )
            .await
            .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
            if let Some(error) = response.error {
                return Err(AgentRunPortError::Unavailable(error));
            }
            self.apply_host_events(request, attempt, response.events)
                .await?;
            return Ok(());
        }
        if let Err(error) = self.append_control_audit(attempt, &control).await {
            let message = error.to_string();
            self.terminalize_failure(
                request,
                attempt,
                AgentRunStatus::AuditFailed,
                AgentRuntimeError::new(AgentRuntimeErrorKind::Unknown, message.clone())
                    .with_provider(Some(provider.id())),
            )
            .await;
            return Err(AgentRunPortError::Unavailable(message));
        }
        Err(AgentRunPortError::Unavailable(
            "AgentRun process host attachment is not persisted".to_string(),
        ))
    }
}

#[async_trait]
impl AgentRunPort for LocalAgentRunPort {
    async fn create(
        &self,
        request: AgentRunRequestEnvelope,
        attempt: RunAttemptRequest,
    ) -> Result<Uuid, AgentRunPortError> {
        let agent_run_id = self.reserve(request, attempt).await?;
        self.launch_reserved(agent_run_id).await?;
        // Identity acceptance is the create acknowledgement. Launch/audit
        // failures are canonical terminal facts observed through query/subscribe.
        Ok(agent_run_id)
    }

    async fn query(&self, agent_run_id: Uuid) -> Result<AgentRunPortSnapshot, AgentRunPortError> {
        let state: Option<Json<executors::runtime::RunState>> =
            sqlx::query_scalar("SELECT state_json FROM agent_run_state WHERE agent_run_id = ?")
                .bind(agent_run_id)
                .fetch_optional(&self.db.pool)
                .await
                .map_err(port_database)?;
        state
            .map(|state| AgentRunPortSnapshot {
                agent_run_id,
                state: state.0,
            })
            .ok_or(AgentRunPortError::NotFound(agent_run_id))
    }

    async fn control(&self, command: AgentRunPortCommandEnvelope) -> Result<(), AgentRunPortError> {
        command
            .validate_current()
            .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
        self.validate_durable_command(&command).await?;
        // Serialize controls within this supervisor. Durable command identity
        // still protects retries across supervisor instances, while this lock
        // prevents cancel/retry/input races between local tasks.
        let _command_guard = self.command_lock.lock().await;
        let agent_run_id = command.agent_run_id;
        match &command.command {
            AgentRunPortCommand::Cancel { .. } => {
                let (request, attempt) = self.load_request(agent_run_id).await?;
                let state = self.query(agent_run_id).await?;
                if state.state.status.is_terminal() {
                    return Ok(());
                }
                self.append_lifecycle(&request, &attempt, AgentRunStatus::Cancelling)
                    .await?;
                self.cancel_attached_attempt(&request, &attempt).await
            }
            AgentRunPortCommand::SubmitInput { input_id, content } => {
                let (request, attempt) = self.load_request(agent_run_id).await?;
                if self.query(agent_run_id).await?.state.status.is_terminal() {
                    return Err(AgentRunPortError::Rejected(
                        "cannot submit input to a terminal AgentRun".to_string(),
                    ));
                }
                let provider = self.provider(&request.provider_id)?;
                let bytes = encode_control(
                    provider,
                    &attempt.capability_snapshot,
                    DirectControl::Input {
                        request_id: input_id.clone(),
                        text: content.clone(),
                    },
                )
                .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
                self.append_event(
                    &request,
                    &attempt,
                    AgentEventPayload::Message {
                        message: CanonicalMessage {
                            message_id: command.command_id,
                            role: AgentRuntimeMessageRole::User,
                            content: content.clone(),
                        },
                        final_output: false,
                    },
                    Vec::new(),
                    command.created_at,
                    Some(command.command_id),
                )
                .await?;
                self.write_attached_control(&attempt, &bytes).await?;
                self.append_event(
                    &request,
                    &attempt,
                    AgentEventPayload::InputResolved {
                        input_id: input_id.clone(),
                        answered: true,
                    },
                    Vec::new(),
                    Utc::now(),
                    None,
                )
                .await
            }
            AgentRunPortCommand::ResolveApproval {
                approval_id,
                approved,
                reason,
            } => {
                let (request, attempt) = self.load_request(agent_run_id).await?;
                if self.query(agent_run_id).await?.state.status.is_terminal() {
                    return Err(AgentRunPortError::Rejected(
                        "cannot resolve approval for a terminal AgentRun".to_string(),
                    ));
                }
                let provider = self.provider(&request.provider_id)?;
                let bytes = encode_control(
                    provider,
                    &attempt.capability_snapshot,
                    DirectControl::Approve {
                        request_id: approval_id.clone(),
                        approved: *approved,
                        reason: reason.clone(),
                    },
                )
                .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
                self.write_attached_control(&attempt, &bytes).await?;
                self.append_event(
                    &request,
                    &attempt,
                    AgentEventPayload::ApprovalResolved {
                        approval_id: approval_id.clone(),
                        approved: *approved,
                        reason: reason.clone(),
                    },
                    Vec::new(),
                    Utc::now(),
                    None,
                )
                .await
            }
            AgentRunPortCommand::Retry {
                mode,
                run_attempt_id,
            } => {
                if *mode == RunAttemptMode::Launch {
                    return Err(AgentRunPortError::Rejected(
                        "retry mode must be resume or restart".to_string(),
                    ));
                }
                let (request, previous) = self.load_request(agent_run_id).await?;
                let state = self.query(agent_run_id).await?;
                if !state.state.status.is_terminal() {
                    return Err(AgentRunPortError::Rejected(
                        "cannot retry an active AgentRun".to_string(),
                    ));
                }
                let provider = self.provider(&request.provider_id)?;
                let provider_session = if *mode == RunAttemptMode::Resume {
                    require_capability(
                        provider,
                        &previous.capability_snapshot,
                        AgentCapability::SessionResume,
                        false,
                    )
                    .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
                    Some(state.state.provider_session.clone().ok_or_else(|| {
                        AgentRunPortError::Rejected(
                            "resume retry requires an observed provider session".to_string(),
                        )
                    })?)
                } else {
                    None
                };
                let attempt = RunAttemptRequest {
                    schema_version: previous.schema_version,
                    payload_version: previous.payload_version,
                    request_id: command.command_id,
                    idempotency_key: command.idempotency_key.clone(),
                    session_id: previous.session_id,
                    agent_run_id: previous.agent_run_id,
                    turn_id: previous.turn_id,
                    run_attempt_id: *run_attempt_id,
                    attempt_number: previous.attempt_number + 1,
                    correlation_id: previous.correlation_id,
                    mode: *mode,
                    transport: previous.transport,
                    runtime_profile_id: previous.runtime_profile_id.clone(),
                    provider_id: previous.provider_id.clone(),
                    workspace: previous.workspace.clone(),
                    capability_snapshot: previous.capability_snapshot.clone(),
                    executor_config: previous.executor_config.clone(),
                    selected_skills: previous.selected_skills.clone(),
                    reset_to_message_id: previous.reset_to_message_id.clone(),
                    provider_session,
                    created_at: command.created_at,
                };
                let workspace = self.validate_workspace(&request).await?;
                AgentRunRecord::persist_retry_attempt_before_launch(
                    &self.db.pool,
                    &request,
                    &attempt,
                )
                .await
                .map_err(|error| AgentRunPortError::Rejected(error.to_string()))?;
                self.start_attempt(request, attempt, workspace).await;
                Ok(())
            }
            AgentRunPortCommand::Create { .. } => Err(AgentRunPortError::Rejected(
                "create commands must use AgentRunPort::create".to_string(),
            )),
        }
    }

    async fn subscribe(&self, agent_run_id: Uuid) -> Result<AgentEventStream, AgentRunPortError> {
        self.query(agent_run_id).await?;
        let receiver = self.sender(agent_run_id).await.subscribe();
        let history: Vec<Json<AgentEventEnvelope>> = sqlx::query_scalar(
            "SELECT event_envelope FROM agent_events WHERE agent_run_id = ? ORDER BY run_attempt_number, sequence",
        )
        .bind(agent_run_id)
        .fetch_all(&self.db.pool)
        .await
        .map_err(port_database)?;
        let history_event_ids: HashSet<Uuid> =
            history.iter().map(|event| event.0.event_id).collect();
        let live = stream::unfold(
            (receiver, history_event_ids),
            |(mut receiver, mut seen)| async move {
                loop {
                    match receiver.recv().await {
                        Ok(event) if seen.insert(event.event_id) => {
                            return Some((event, (receiver, seen)));
                        }
                        Ok(_) => continue,
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => return None,
                    }
                }
            },
        );
        Ok(stream::iter(history.into_iter().map(|event| event.0))
            .chain(live)
            .boxed())
    }
}

async fn wait_for_process_exit(child: SharedChild) -> std::io::Result<(bool, Option<i64>)> {
    loop {
        let status = child.write().await.try_wait()?;
        if let Some(status) = status {
            return Ok((status.success(), status.code().map(i64::from)));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn resolve_process_host_executable() -> Result<PathBuf, AgentRunPortError> {
    if let Some(path) = std::env::var_os("VIBE_KANBAN_AGENT_PROCESS_HOST") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AgentRunPortError::Unavailable(format!(
            "configured process host does not exist: {}",
            path.display()
        )));
    }
    if let Some(path) = option_env!("CARGO_BIN_EXE_agent-process-host") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    let current_exe = std::env::current_exe()
        .map_err(|error| AgentRunPortError::Unavailable(error.to_string()))?;
    let file_name = if cfg!(windows) {
        "agent-process-host.exe"
    } else {
        "agent-process-host"
    };
    let sibling = current_exe.with_file_name(file_name);
    if sibling.is_file() {
        return Ok(sibling);
    }
    if current_exe
        .parent()
        .is_some_and(|directory| directory.ends_with("deps"))
        && let Some(target_directory) = current_exe.parent().and_then(Path::parent)
    {
        let target_sibling = target_directory.join(file_name);
        if target_sibling.is_file() {
            return Ok(target_sibling);
        }
    }
    Err(AgentRunPortError::Unavailable(format!(
        "agent process host executable was not found next to {}",
        current_exe.display()
    )))
}

fn port_database(error: sqlx::Error) -> AgentRunPortError {
    AgentRunPortError::Unavailable(error.to_string())
}

fn port_audit(error: executors::runtime::NativeAuditError) -> AgentRunPortError {
    AgentRunPortError::Unavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use executors::runtime::{
        AGENT_REQUEST_PAYLOAD_VERSION, AGENT_REQUEST_SCHEMA_VERSION, AgentRuntimeMessageRole,
        AgentTransportKind, CanonicalMessage, WorkspaceMode, WorkspaceReference,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    async fn setup_runtime_db() -> DBService {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        sqlx::raw_sql(
            r#"
            CREATE TABLE workspaces (id BLOB PRIMARY KEY);
            CREATE TABLE sessions (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create anchor schema");
        sqlx::raw_sql(include_str!(
            "../../db/migrations/20260811000000_agent_runtime_v1.sql"
        ))
        .execute(&pool)
        .await
        .expect("create runtime schema");
        DBService { pool }
    }

    async fn persisted_codex_run(db: &DBService) -> (AgentRunRequestEnvelope, RunAttemptRequest) {
        let workspace_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        sqlx::query("INSERT INTO workspaces (id) VALUES (?)")
            .bind(workspace_id)
            .execute(&db.pool)
            .await
            .expect("insert workspace");
        sqlx::query("INSERT INTO sessions (id, workspace_id) VALUES (?, ?)")
            .bind(session_id)
            .bind(workspace_id)
            .execute(&db.pool)
            .await
            .expect("insert session");

        let now = Utc::now();
        let workspace = WorkspaceReference {
            workspace_id,
            mode: WorkspaceMode::SharedWorkspace,
            path: "C:/workspace".to_string(),
        };
        let request = AgentRunRequestEnvelope {
            schema_version: AGENT_REQUEST_SCHEMA_VERSION,
            payload_version: AGENT_REQUEST_PAYLOAD_VERSION,
            request_id: Uuid::new_v4(),
            idempotency_key: "cancel-audit-failure".to_string(),
            session_id,
            agent_run_id: Uuid::new_v4(),
            turn_id: Uuid::new_v4(),
            correlation_id: Uuid::new_v4(),
            intent: AgentRunIntent::Initial,
            runtime_profile_id: "CODEX:default".to_string(),
            provider_id: "codex".to_string(),
            workspace: workspace.clone(),
            input: CanonicalMessage {
                message_id: Uuid::new_v4(),
                role: AgentRuntimeMessageRole::User,
                content: "cancel me".to_string(),
            },
            created_at: now,
        };
        let attempt = RunAttemptRequest {
            schema_version: AGENT_REQUEST_SCHEMA_VERSION,
            payload_version: AGENT_REQUEST_PAYLOAD_VERSION,
            request_id: Uuid::new_v4(),
            idempotency_key: "cancel-audit-failure:attempt:1".to_string(),
            session_id,
            agent_run_id: request.agent_run_id,
            turn_id: request.turn_id,
            run_attempt_id: Uuid::new_v4(),
            attempt_number: 1,
            correlation_id: request.correlation_id,
            mode: RunAttemptMode::Launch,
            transport: AgentTransportKind::AppServerJsonrpc,
            runtime_profile_id: request.runtime_profile_id.clone(),
            provider_id: request.provider_id.clone(),
            workspace,
            capability_snapshot: DirectProvider::Codex.capabilities("CODEX:default"),
            executor_config: executors::profile::ExecutorConfig {
                executor: executors::executors::BaseCodingAgent::Codex,
                variant: Some("default".to_string()),
                model_id: None,
                agent_id: None,
                reasoning_id: None,
                permission_policy: None,
            },
            selected_skills: None,
            reset_to_message_id: None,
            provider_session: None,
            created_at: now,
        };
        AgentRunRecord::persist_identity_before_launch(&db.pool, &request, &attempt)
            .await
            .expect("persist AgentRun identity");
        (request, attempt)
    }

    fn test_execution_env(workspace_path: &str) -> ExecutionEnv {
        let mut env = ExecutionEnv::new(
            RepoContext::new(
                PathBuf::from(workspace_path),
                vec!["repository".to_string()],
            ),
            false,
            String::new(),
        );
        env.insert("VK_AGENT_RUN_ID", "frozen-run");
        env
    }

    #[tokio::test]
    async fn direct_launch_and_audit_use_frozen_attempt_inputs() {
        let db = setup_runtime_db().await;
        let port = LocalAgentRunPort::new(db);
        let (request, mut attempt) = persisted_codex_run(&port.db).await;
        let selected_skills = vec![api_types::SelectedSkill {
            name: "runtime-contracts".to_string(),
            path: PathBuf::from("C:/skills/runtime-contracts/SKILL.md"),
        }];
        attempt.executor_config.model_id = Some("openai/gpt-5.6-codex".to_string());
        attempt.executor_config.reasoning_id = Some("high".to_string());
        attempt.selected_skills = Some(selected_skills.clone());

        let launch = FrozenDirectProviderLaunchSpec::new(
            &request,
            &attempt,
            DirectProvider::Codex,
            test_execution_env(&attempt.workspace.path),
        );
        let direct = launch.launch_request();
        assert_eq!(direct.provider, DirectProvider::Codex);
        assert_eq!(direct.intent, DirectIntent::Initial);
        assert_eq!(direct.executor_config, &attempt.executor_config);
        assert_eq!(direct.prompt, request.input.content);
        assert_eq!(direct.selected_skills, selected_skills);
        assert_eq!(direct.current_dir, Path::new(&attempt.workspace.path));
        assert_eq!(
            direct.env.get("VK_AGENT_RUN_ID").map(String::as_str),
            Some("frozen-run")
        );

        let audited: serde_json::Value = serde_json::from_slice(
            &launch
                .audit_payload()
                .expect("frozen direct launch must serialize for audit"),
        )
        .expect("audit payload must be JSON");
        assert_eq!(audited["provider"], "codex");
        assert_eq!(audited["intent"], "initial");
        assert_eq!(audited["prompt"], request.input.content);
        assert_eq!(
            audited["executor_config"],
            serde_json::to_value(&attempt.executor_config).unwrap()
        );
        assert_eq!(
            audited["selected_skills"],
            serde_json::to_value(&selected_skills).unwrap()
        );
        assert_eq!(audited["approval_behavior"], "noop");
        assert_eq!(audited["current_dir"], attempt.workspace.path);
        assert_eq!(audited["env"]["vars"]["VK_AGENT_RUN_ID"], "frozen-run");
    }

    #[tokio::test]
    async fn direct_follow_up_uses_frozen_session_and_reset_target() {
        let db = setup_runtime_db().await;
        let port = LocalAgentRunPort::new(db);
        let (mut request, mut attempt) = persisted_codex_run(&port.db).await;
        request.intent = AgentRunIntent::FollowUp;
        request.runtime_profile_id = "CLAUDE_CODE:default".to_string();
        request.provider_id = "claude_code".to_string();
        attempt.runtime_profile_id = request.runtime_profile_id.clone();
        attempt.provider_id = request.provider_id.clone();
        attempt.executor_config = executors::profile::ExecutorConfig {
            executor: executors::executors::BaseCodingAgent::ClaudeCode,
            variant: Some("default".to_string()),
            model_id: Some("claude-sonnet-4".to_string()),
            agent_id: None,
            reasoning_id: None,
            permission_policy: None,
        };
        attempt.reset_to_message_id = Some("message-17".to_string());
        attempt.provider_session = Some(executors::runtime::ProviderSessionReference {
            schema_version: executors::runtime::PROVIDER_SESSION_REFERENCE_SCHEMA_VERSION,
            provider_id: request.provider_id.clone(),
            runtime_profile_id: request.runtime_profile_id.clone(),
            provider_session_id: "claude-session".to_string(),
            observed_at: Utc::now(),
            metadata: None,
        });

        let launch = FrozenDirectProviderLaunchSpec::new(
            &request,
            &attempt,
            DirectProvider::ClaudeCode,
            test_execution_env(&attempt.workspace.path),
        );
        let direct = launch.launch_request();
        assert_eq!(direct.intent, DirectIntent::FollowUp);
        assert_eq!(direct.executor_config, &attempt.executor_config);
        assert_eq!(direct.reset_to_message_id, Some("message-17"));
        assert_eq!(
            direct
                .provider_session
                .map(|session| session.provider_session_id.as_str()),
            Some("claude-session")
        );
    }

    #[test]
    fn direct_intent_explicitly_combines_run_intent_and_attempt_mode() {
        let cases = [
            (
                AgentRunIntent::Initial,
                RunAttemptMode::Launch,
                DirectIntent::Initial,
            ),
            (
                AgentRunIntent::Initial,
                RunAttemptMode::Resume,
                DirectIntent::Resume,
            ),
            (
                AgentRunIntent::Initial,
                RunAttemptMode::Restart,
                DirectIntent::Initial,
            ),
            (
                AgentRunIntent::FollowUp,
                RunAttemptMode::Launch,
                DirectIntent::FollowUp,
            ),
            (
                AgentRunIntent::FollowUp,
                RunAttemptMode::Resume,
                DirectIntent::Resume,
            ),
            (
                AgentRunIntent::FollowUp,
                RunAttemptMode::Restart,
                DirectIntent::Initial,
            ),
            (
                AgentRunIntent::Review,
                RunAttemptMode::Launch,
                DirectIntent::Review,
            ),
            (
                AgentRunIntent::Review,
                RunAttemptMode::Resume,
                DirectIntent::Resume,
            ),
            (
                AgentRunIntent::Review,
                RunAttemptMode::Restart,
                DirectIntent::Review,
            ),
        ];

        for (intent, mode, expected) in cases {
            assert_eq!(direct_intent(intent, mode), expected);
        }
    }

    #[tokio::test]
    async fn cancel_audit_failure_has_no_provider_or_process_side_effects() {
        let db = setup_runtime_db().await;
        let port = LocalAgentRunPort::new(db);
        let (request, attempt) = persisted_codex_run(&port.db).await;
        let cancellation = CancellationToken::new();
        port.cancellation_tokens
            .write()
            .await
            .insert(attempt.run_attempt_id, cancellation.clone());

        let error = port
            .cancel_attached_attempt(&request, &attempt)
            .await
            .expect_err("missing Native Audit writer must fail closed");

        assert!(matches!(error, AgentRunPortError::Unavailable(_)));
        assert_eq!(
            port.query(request.agent_run_id).await.unwrap().state.status,
            AgentRunStatus::AuditFailed
        );
        assert!(
            !cancellation.is_cancelled(),
            "audit failure must stop before the provider cancellation token"
        );
    }

    #[tokio::test]
    async fn canonical_event_identity_is_idempotent_before_sequence_allocation() {
        let db = setup_runtime_db().await;
        let port = LocalAgentRunPort::new(db);
        let (request, attempt) = persisted_codex_run(&port.db).await;
        let event_id = Uuid::new_v4();
        let timestamp = Utc::now();
        let payload = AgentEventPayload::Message {
            message: CanonicalMessage {
                message_id: event_id,
                role: AgentRuntimeMessageRole::User,
                content: "answer the pending question".to_string(),
            },
            final_output: false,
        };

        port.append_event(
            &request,
            &attempt,
            payload.clone(),
            Vec::new(),
            timestamp,
            Some(event_id),
        )
        .await
        .expect("append canonical input message");
        port.append_event(
            &request,
            &attempt,
            payload,
            Vec::new(),
            timestamp,
            Some(event_id),
        )
        .await
        .expect("redelivered canonical input message is idempotent");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_events WHERE agent_run_id = ? AND event_id = ?",
        )
        .bind(request.agent_run_id)
        .bind(event_id)
        .fetch_one(&port.db.pool)
        .await
        .expect("count canonical events");
        assert_eq!(count, 1);
        assert_eq!(
            port.query(request.agent_run_id)
                .await
                .expect("query AgentRun")
                .state
                .last_event_sequence,
            1
        );
    }
}
