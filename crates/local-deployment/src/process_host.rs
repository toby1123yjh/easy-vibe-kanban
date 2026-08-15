//! Independent owner for one provider process and its Native Audit stream.
//!
//! The application may disconnect or restart without transferring child
//! handles. It reconnects through the authenticated loopback endpoint and
//! replays observations after its persisted host-event cursor.

use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use chrono::{DateTime, Utc};
use executors::{
    actions::SelectedSkill,
    approvals::NoopExecutorApprovalService,
    env::{ExecutionEnv, RepoContext},
    executors::{
        CancellationToken, ExecutorExitResult,
        provider_adapter::{
            DirectIntent, DirectProvider, DirectProviderLaunchRequest, launch_direct_provider,
        },
    },
    profile::ExecutorConfig,
    runtime::{
        AgentEventEnvelope, AgentRunStatus, AgentRuntimeError, AgentRuntimeErrorKind,
        CanonicalMessage, NativeAuditChannel, NativeAuditDirection, NativeAuditFrame,
        NativeAuditIntegrityStatus, NativeAuditManifest, NativeAuditMetadata, NativeAuditReference,
        NativeAuditWriter, ProviderSessionReference,
    },
};
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{Mutex, Notify, RwLock, mpsc, oneshot},
};
use uuid::Uuid;

use crate::transport::{TransportError, read_json_frame, write_json_frame};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostBootstrap {
    pub protocol_version: u16,
    pub run_attempt_id: Uuid,
    pub host_instance_id: Uuid,
    pub auth_token: String,
    pub requested_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostReady {
    pub protocol_version: u16,
    pub endpoint: String,
    pub host_pid: u32,
    pub host_instance_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostLaunchRequest {
    pub run_attempt_id: Uuid,
    pub provider: DirectProvider,
    pub executor_config: ExecutorConfig,
    pub intent: DirectIntent,
    pub prompt: String,
    pub provider_session: Option<ProviderSessionReference>,
    pub reset_to_message_id: Option<String>,
    pub selected_skills: Vec<SelectedSkill>,
    pub current_dir: PathBuf,
    pub env: HostExecutionEnv,
    pub audit_metadata: NativeAuditMetadata,
    pub canonical_input: CanonicalMessage,
    pub correlation_id: Uuid,
    pub audited_launch_payload: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostExecutionEnv {
    pub vars: HashMap<String, String>,
    pub workspace_root: PathBuf,
    pub repo_names: Vec<String>,
    pub commit_reminder: bool,
    pub commit_reminder_prompt: String,
}

impl From<&ExecutionEnv> for HostExecutionEnv {
    fn from(env: &ExecutionEnv) -> Self {
        Self {
            vars: env.vars.clone(),
            workspace_root: env.repo_context.workspace_root.clone(),
            repo_names: env.repo_context.repo_names.clone(),
            commit_reminder: env.commit_reminder,
            commit_reminder_prompt: env.commit_reminder_prompt.clone(),
        }
    }
}

impl HostExecutionEnv {
    fn into_execution_env(self) -> ExecutionEnv {
        let mut env = ExecutionEnv::new(
            RepoContext::new(self.workspace_root, self.repo_names),
            self.commit_reminder,
            self.commit_reminder_prompt,
        );
        env.vars = self.vars;
        env
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub(crate) enum HostCommand {
    Launch(HostLaunchRequest),
    Attach {
        after_sequence: u64,
    },
    Control {
        bytes: Vec<u8>,
        cancel: bool,
        after_sequence: u64,
    },
    AckTerminal {
        through_sequence: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AuthenticatedHostCommand {
    pub auth_token: String,
    pub command: HostCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostResponse {
    pub host_instance_id: Uuid,
    pub events: Vec<HostEvent>,
    pub terminal: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostEvent {
    pub sequence: u64,
    pub event_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub payload: HostEventPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub(crate) enum HostEventPayload {
    Started {
        provider_pid: u32,
        process_group_id: Option<u32>,
        executable: String,
        canonical_input_ref: NativeAuditReference,
        audit_manifest: NativeAuditManifest,
    },
    Mapped {
        event: AgentEventEnvelope,
        native_ref: NativeAuditReference,
    },
    Terminal {
        status: AgentRunStatus,
        error: Option<AgentRuntimeError>,
        error_event_id: Option<Uuid>,
        exit_code: Option<i64>,
        audit_manifest: NativeAuditManifest,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum ProcessHostError {
    #[error("host protocol error: {0}")]
    Protocol(String),
    #[error("host transport error: {0}")]
    Transport(#[from] TransportError),
    #[error("host I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("provider launch failed: {0}")]
    Launch(String),
    #[error("Native Audit failed: {0}")]
    Audit(String),
}

#[derive(Default)]
struct HostRuntimeState {
    launched: bool,
    events: Vec<HostEvent>,
    process_commands: Option<mpsc::Sender<ProcessCommand>>,
}

struct SharedHost {
    run_attempt_id: Uuid,
    host_instance_id: Uuid,
    auth_token: String,
    runtime: RwLock<HostRuntimeState>,
    launch_lock: Mutex<()>,
    terminal: AtomicBool,
    shutdown: Notify,
}

enum ProcessCommand {
    Control {
        bytes: Vec<u8>,
        cancel: bool,
        result: oneshot::Sender<Result<(), String>>,
    },
}

#[derive(Debug)]
enum OutputNotice {
    StdoutClosed,
    StderrClosed,
    Mapped(AgentEventEnvelope, NativeAuditReference),
    ProviderTerminal(AgentRunStatus),
    AuditFailure(String),
    ProtocolFailure(String),
}

enum ExitCause {
    Process { success: bool, code: Option<i64> },
    Executor(ExecutorExitResult),
    ExecutorChannelClosed,
    ProviderTerminal(AgentRunStatus),
    Cancelled,
    AuditFailure(String),
    ProtocolFailure(String),
    WaitFailure(String),
}

impl SharedHost {
    async fn response_after(&self, after_sequence: u64) -> HostResponse {
        let runtime = self.runtime.read().await;
        HostResponse {
            host_instance_id: self.host_instance_id,
            events: runtime
                .events
                .iter()
                .filter(|event| event.sequence > after_sequence)
                .cloned()
                .collect(),
            terminal: self.terminal.load(Ordering::Acquire),
            error: None,
        }
    }

    async fn append_event(&self, payload: HostEventPayload) -> HostEvent {
        let mut runtime = self.runtime.write().await;
        let event = HostEvent {
            sequence: runtime.events.last().map_or(1, |event| event.sequence + 1),
            event_id: Uuid::new_v4(),
            timestamp: Utc::now(),
            payload,
        };
        runtime.events.push(event.clone());
        event
    }

    async fn launch(self: &Arc<Self>, launch: HostLaunchRequest) -> Result<(), ProcessHostError> {
        let _guard = self.launch_lock.lock().await;
        {
            let runtime = self.runtime.read().await;
            if runtime.launched {
                return Ok(());
            }
        }
        if launch.run_attempt_id != self.run_attempt_id {
            return Err(ProcessHostError::Protocol(
                "launch RunAttempt does not match host reservation".to_string(),
            ));
        }

        let mut writer = NativeAuditWriter::create(launch.audit_metadata.clone())
            .map_err(|error| ProcessHostError::Audit(error.to_string()))?;
        let canonical_input_ref = writer
            .append_canonical_input(&launch.canonical_input, launch.correlation_id)
            .map_err(|error| ProcessHostError::Audit(error.to_string()))?;
        writer
            .append_native_input(
                NativeAuditChannel::NativeInput,
                "application/vnd.vibe-kanban.direct-provider-launch+json",
                launch.correlation_id,
                &launch.audited_launch_payload,
            )
            .map_err(|error| ProcessHostError::Audit(error.to_string()))?;

        let env = launch.env.clone().into_execution_env();
        let mut spawned = match launch_direct_provider(DirectProviderLaunchRequest {
            provider: launch.provider,
            executor_config: &launch.executor_config,
            intent: launch.intent,
            prompt: &launch.prompt,
            provider_session: launch.provider_session.as_ref(),
            reset_to_message_id: launch.reset_to_message_id.as_deref(),
            selected_skills: &launch.selected_skills,
            approvals: Arc::new(NoopExecutorApprovalService),
            current_dir: &launch.current_dir,
            env: &env,
        })
        .await
        {
            Ok(spawned) => spawned,
            Err(error) => {
                let runtime_error =
                    AgentRuntimeError::from_executor_error(&error, Some(launch.provider.id()));
                let manifest = close_writer_failed(&mut writer)?;
                self.append_terminal(AgentRunStatus::Failed, Some(runtime_error), None, manifest)
                    .await;
                self.runtime.write().await.launched = true;
                return Ok(());
            }
        };

        let Some(provider_pid) = spawned.child.inner().id() else {
            let _ = utils::process::kill_process_group(&mut spawned.child).await;
            let manifest = close_writer_failed(&mut writer)?;
            self.append_terminal(
                AgentRunStatus::Crashed,
                Some(
                    AgentRuntimeError::new(
                        AgentRuntimeErrorKind::ProcessCrashed,
                        "spawned provider has no OS pid",
                    )
                    .with_provider(Some(launch.provider.id())),
                ),
                None,
                manifest,
            )
            .await;
            self.runtime.write().await.launched = true;
            return Ok(());
        };
        let stdout = match spawned.child.inner().stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = utils::process::kill_process_group(&mut spawned.child).await;
                let manifest = close_writer_failed(&mut writer)?;
                self.append_terminal(
                    AgentRunStatus::Crashed,
                    Some(
                        AgentRuntimeError::new(
                            AgentRuntimeErrorKind::ProcessCrashed,
                            "provider process stdout is unavailable",
                        )
                        .with_provider(Some(launch.provider.id())),
                    ),
                    None,
                    manifest,
                )
                .await;
                self.runtime.write().await.launched = true;
                return Ok(());
            }
        };
        let stderr = match spawned.child.inner().stderr.take() {
            Some(stderr) => stderr,
            None => {
                let _ = utils::process::kill_process_group(&mut spawned.child).await;
                let manifest = close_writer_failed(&mut writer)?;
                self.append_terminal(
                    AgentRunStatus::Crashed,
                    Some(
                        AgentRuntimeError::new(
                            AgentRuntimeErrorKind::ProcessCrashed,
                            "provider process stderr is unavailable",
                        )
                        .with_provider(Some(launch.provider.id())),
                    ),
                    None,
                    manifest,
                )
                .await;
                self.runtime.write().await.launched = true;
                return Ok(());
            }
        };
        let stdin = spawned.child.inner().stdin.take();
        let writer = Arc::new(Mutex::new(writer));

        self.append_event(HostEventPayload::Started {
            provider_pid,
            process_group_id: Some(provider_pid),
            executable: launch.provider.versions().executable.to_string(),
            canonical_input_ref,
            audit_manifest: writer.lock().await.manifest().clone(),
        })
        .await;

        let (notices_tx, notices_rx) = mpsc::unbounded_channel();
        spawn_stdout_reader(
            launch.provider,
            launch.correlation_id,
            stdout,
            writer.clone(),
            notices_tx.clone(),
        );
        spawn_stderr_reader(launch.correlation_id, stderr, writer.clone(), notices_tx);
        let (commands_tx, commands_rx) = mpsc::channel(16);
        {
            let mut runtime = self.runtime.write().await;
            runtime.launched = true;
            runtime.process_commands = Some(commands_tx);
        }
        let host = self.clone();
        tokio::spawn(async move {
            monitor_process(
                host,
                launch.provider,
                launch.correlation_id,
                spawned.child,
                stdin,
                spawned.cancel,
                spawned.exit_signal,
                writer,
                notices_rx,
                commands_rx,
            )
            .await;
        });
        Ok(())
    }

    async fn append_terminal(
        &self,
        status: AgentRunStatus,
        error: Option<AgentRuntimeError>,
        exit_code: Option<i64>,
        audit_manifest: NativeAuditManifest,
    ) {
        let error_event_id = error.as_ref().map(|_| Uuid::new_v4());
        self.append_event(HostEventPayload::Terminal {
            status,
            error,
            error_event_id,
            exit_code,
            audit_manifest,
        })
        .await;
        self.terminal.store(true, Ordering::Release);
        self.runtime.write().await.process_commands = None;
    }
}

pub async fn run_from_stdin() -> Result<(), ProcessHostError> {
    let mut stdin = tokio::io::stdin();
    let bootstrap: HostBootstrap = read_json_frame(&mut stdin).await?;
    if bootstrap.protocol_version != 1 || bootstrap.auth_token.len() < 32 {
        return Err(ProcessHostError::Protocol(
            "invalid process-host bootstrap".to_string(),
        ));
    }
    let listener = TcpListener::bind(&bootstrap.requested_endpoint).await?;
    let ready = HostReady {
        protocol_version: 1,
        endpoint: listener.local_addr()?.to_string(),
        host_pid: std::process::id(),
        host_instance_id: bootstrap.host_instance_id,
    };
    let mut stdout = tokio::io::stdout();
    write_json_frame(&mut stdout, &ready).await?;
    drop(stdout);

    let host = Arc::new(SharedHost {
        run_attempt_id: bootstrap.run_attempt_id,
        host_instance_id: bootstrap.host_instance_id,
        auth_token: bootstrap.auth_token,
        runtime: RwLock::new(HostRuntimeState::default()),
        launch_lock: Mutex::new(()),
        terminal: AtomicBool::new(false),
        shutdown: Notify::new(),
    });
    serve(listener, host).await
}

async fn serve(listener: TcpListener, host: Arc<SharedHost>) -> Result<(), ProcessHostError> {
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let host = host.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_connection(stream, host).await {
                        tracing::warn!(%error, "process-host client connection failed");
                    }
                });
            }
            () = host.shutdown.notified() => return Ok(()),
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    host: Arc<SharedHost>,
) -> Result<(), ProcessHostError> {
    let request: AuthenticatedHostCommand = read_json_frame(&mut stream).await?;
    if request.auth_token != host.auth_token {
        return Err(ProcessHostError::Protocol(
            "process-host authentication failed".to_string(),
        ));
    }
    let mut shutdown = false;
    let response = match request.command {
        HostCommand::Launch(launch) => match host.launch(launch).await {
            Ok(()) => host.response_after(0).await,
            Err(error) => HostResponse {
                host_instance_id: host.host_instance_id,
                events: Vec::new(),
                terminal: host.terminal.load(Ordering::Acquire),
                error: Some(error.to_string()),
            },
        },
        HostCommand::Attach { after_sequence } => host.response_after(after_sequence).await,
        HostCommand::Control {
            bytes,
            cancel,
            after_sequence,
        } => {
            let sender = host.runtime.read().await.process_commands.clone();
            let error = match sender {
                Some(sender) => {
                    let (result_tx, result_rx) = oneshot::channel();
                    if sender
                        .send(ProcessCommand::Control {
                            bytes,
                            cancel,
                            result: result_tx,
                        })
                        .await
                        .is_err()
                    {
                        Some("provider process command channel is closed".to_string())
                    } else {
                        match result_rx.await {
                            Ok(Ok(())) => None,
                            Ok(Err(error)) => Some(error),
                            Err(_) => Some("provider process command result was lost".to_string()),
                        }
                    }
                }
                None => Some("provider process is not running".to_string()),
            };
            let mut response = host.response_after(after_sequence).await;
            response.error = error;
            response
        }
        HostCommand::AckTerminal { through_sequence } => {
            let response = host.response_after(through_sequence).await;
            let terminal_sequence = host
                .runtime
                .read()
                .await
                .events
                .last()
                .filter(|event| matches!(event.payload, HostEventPayload::Terminal { .. }))
                .map(|event| event.sequence);
            shutdown = terminal_sequence.is_some_and(|sequence| through_sequence >= sequence);
            response
        }
    };
    write_json_frame(&mut stream, &response).await?;
    if shutdown {
        host.shutdown.notify_waiters();
    }
    Ok(())
}

fn spawn_stdout_reader(
    provider: DirectProvider,
    correlation_id: Uuid,
    stdout: tokio::process::ChildStdout,
    writer: Arc<Mutex<NativeAuditWriter>>,
    notices: mpsc::UnboundedSender<OutputNotice>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            match reader.read_until(b'\n', &mut bytes).await {
                Ok(0) => break,
                Ok(_) => {
                    let (frame, native_ref, manifest) = {
                        let mut writer = writer.lock().await;
                        let frame = NativeAuditFrame::from_bytes(
                            writer.manifest().last_sequence.unwrap_or(0) + 1,
                            Utc::now(),
                            NativeAuditDirection::Output,
                            NativeAuditChannel::Stdout,
                            "application/json",
                            correlation_id,
                            &bytes,
                            None,
                        );
                        match writer.append(frame.clone()) {
                            Ok(reference) => (frame, reference, writer.manifest().clone()),
                            Err(error) => {
                                let _ = notices.send(OutputNotice::AuditFailure(error.to_string()));
                                break;
                            }
                        }
                    };
                    let decoded = match provider.decode_native_frame(&frame) {
                        Ok(decoded) => decoded,
                        Err(error) => {
                            let _ = notices.send(OutputNotice::ProtocolFailure(error.to_string()));
                            break;
                        }
                    };
                    let mapped = match provider.map_provider_event(&decoded, &manifest) {
                        Ok(mapped) => mapped,
                        Err(error) => {
                            let _ = notices.send(OutputNotice::ProtocolFailure(error.to_string()));
                            break;
                        }
                    };
                    for event in mapped {
                        let terminal =
                            match &event.payload {
                                executors::runtime::AgentEventPayload::LifecycleChanged {
                                    status,
                                } if status.is_terminal() => Some(*status),
                                _ => None,
                            };
                        let _ = notices.send(OutputNotice::Mapped(event, native_ref.clone()));
                        if let Some(status) = terminal {
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
    correlation_id: Uuid,
    stderr: tokio::process::ChildStderr,
    writer: Arc<Mutex<NativeAuditWriter>>,
    notices: mpsc::UnboundedSender<OutputNotice>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut bytes = Vec::new();
            match reader.read_until(b'\n', &mut bytes).await {
                Ok(0) => break,
                Ok(_) => {
                    let mut writer = writer.lock().await;
                    if let Err(error) = writer.append_native_output(
                        NativeAuditChannel::Stderr,
                        "text/plain",
                        correlation_id,
                        &bytes,
                    ) {
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

#[allow(clippy::too_many_arguments)]
async fn monitor_process(
    host: Arc<SharedHost>,
    provider: DirectProvider,
    correlation_id: Uuid,
    mut child: command_group::AsyncGroupChild,
    mut stdin: Option<tokio::process::ChildStdin>,
    cancellation: Option<CancellationToken>,
    exit_signal: Option<executors::executors::ExecutorExitSignal>,
    writer: Arc<Mutex<NativeAuditWriter>>,
    mut notices: mpsc::UnboundedReceiver<OutputNotice>,
    mut commands: mpsc::Receiver<ProcessCommand>,
) {
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    let mut exit_signal: Pin<
        Box<
            dyn Future<Output = Result<ExecutorExitResult, tokio::sync::oneshot::error::RecvError>>
                + Send,
        >,
    > = match exit_signal {
        Some(signal) => Box::pin(signal),
        None => Box::pin(std::future::pending::<
            Result<ExecutorExitResult, tokio::sync::oneshot::error::RecvError>,
        >()),
    };
    let cause = loop {
        tokio::select! {
            status = child.wait() => {
                break match status {
                    Ok(status) => ExitCause::Process {
                        success: status.success(),
                        code: status.code().map(i64::from),
                    },
                    Err(error) => ExitCause::WaitFailure(error.to_string()),
                };
            }
            result = &mut exit_signal => {
                break match result {
                    Ok(result) => ExitCause::Executor(result),
                    Err(_) => ExitCause::ExecutorChannelClosed,
                };
            }
            notice = notices.recv(), if !(stdout_closed && stderr_closed) => {
                match notice {
                    Some(OutputNotice::StdoutClosed) => stdout_closed = true,
                    Some(OutputNotice::StderrClosed) => stderr_closed = true,
                    Some(OutputNotice::Mapped(event, native_ref)) => {
                        host.append_event(HostEventPayload::Mapped { event, native_ref }).await;
                    }
                    Some(OutputNotice::ProviderTerminal(status)) => break ExitCause::ProviderTerminal(status),
                    Some(OutputNotice::AuditFailure(error)) => break ExitCause::AuditFailure(error),
                    Some(OutputNotice::ProtocolFailure(error)) => break ExitCause::ProtocolFailure(error),
                    None => {
                        stdout_closed = true;
                        stderr_closed = true;
                    }
                }
            }
            command = commands.recv() => {
                let Some(ProcessCommand::Control { bytes, cancel, result }) = command else {
                    continue;
                };
                let audit_result = {
                    let mut writer = writer.lock().await;
                    writer.append_native_input(
                        NativeAuditChannel::Stdin,
                        "application/x-ndjson",
                        correlation_id,
                        &bytes,
                    )
                };
                if let Err(error) = audit_result {
                    let message = error.to_string();
                    let _ = result.send(Err(message.clone()));
                    break ExitCause::AuditFailure(message);
                }
                if !bytes.is_empty() {
                    if let Some(stdin) = stdin.as_mut()
                        && let Err(error) = stdin.write_all(&bytes).await.and_then(|_| Ok(()))
                    {
                        let message = error.to_string();
                        let _ = result.send(Err(message.clone()));
                        break ExitCause::ProtocolFailure(message);
                    }
                    if let Some(stdin) = stdin.as_mut()
                        && let Err(error) = stdin.flush().await
                    {
                        let message = error.to_string();
                        let _ = result.send(Err(message.clone()));
                        break ExitCause::ProtocolFailure(message);
                    }
                }
                if cancel {
                    if let Some(cancellation) = cancellation.as_ref() {
                        cancellation.cancel();
                    }
                    let kill_result = utils::process::kill_process_group(&mut child).await;
                    match kill_result {
                        Ok(()) => {
                            let _ = result.send(Ok(()));
                            break ExitCause::Cancelled;
                        }
                        Err(error) => {
                            let message = error.to_string();
                            let _ = result.send(Err(message.clone()));
                            break ExitCause::WaitFailure(message);
                        }
                    }
                }
                let _ = result.send(Ok(()));
            }
        }
    };

    if !matches!(cause, ExitCause::Process { .. } | ExitCause::Cancelled) {
        let _ = utils::process::kill_process_group(&mut child).await;
    }
    if !matches!(cause, ExitCause::Process { .. }) {
        let _ = child.wait().await;
    }
    while !(stdout_closed && stderr_closed) {
        match notices.recv().await {
            Some(OutputNotice::StdoutClosed) => stdout_closed = true,
            Some(OutputNotice::StderrClosed) => stderr_closed = true,
            Some(OutputNotice::Mapped(event, native_ref)) => {
                host.append_event(HostEventPayload::Mapped { event, native_ref })
                    .await;
            }
            Some(_) => {}
            None => break,
        }
    }

    let (status, error, exit_code) = terminal_from_exit(cause, provider);
    let manifest = {
        let mut writer = writer.lock().await;
        match writer.close_with_status(NativeAuditIntegrityStatus::Complete) {
            Ok(manifest) => manifest,
            Err(error) => match writer.fail_closed() {
                Ok(manifest) => {
                    host.append_terminal(
                        AgentRunStatus::AuditFailed,
                        Some(
                            AgentRuntimeError::new(
                                AgentRuntimeErrorKind::Unknown,
                                error.to_string(),
                            )
                            .with_provider(Some(provider.id())),
                        ),
                        exit_code,
                        manifest,
                    )
                    .await;
                    return;
                }
                Err(final_error) => {
                    tracing::error!(%final_error, "process host could not finalize Native Audit");
                    return;
                }
            },
        }
    };
    host.append_terminal(status, error, exit_code, manifest)
        .await;
}

fn terminal_from_exit(
    cause: ExitCause,
    provider: DirectProvider,
) -> (AgentRunStatus, Option<AgentRuntimeError>, Option<i64>) {
    let runtime_error = |kind, message: String| {
        Some(AgentRuntimeError::new(kind, message).with_provider(Some(provider.id())))
    };
    match cause {
        ExitCause::Executor(ExecutorExitResult::Success) => {
            (AgentRunStatus::Succeeded, None, Some(0))
        }
        ExitCause::Executor(ExecutorExitResult::Failure) => (
            AgentRunStatus::Failed,
            runtime_error(
                AgentRuntimeErrorKind::Unknown,
                "provider executor reported failure".to_string(),
            ),
            Some(1),
        ),
        ExitCause::ExecutorChannelClosed => (
            AgentRunStatus::Crashed,
            runtime_error(
                AgentRuntimeErrorKind::ProcessCrashed,
                "provider exit channel closed".to_string(),
            ),
            None,
        ),
        ExitCause::ProviderTerminal(status) => (
            status,
            None,
            (status == AgentRunStatus::Succeeded).then_some(0),
        ),
        ExitCause::Cancelled => (AgentRunStatus::Cancelled, None, None),
        ExitCause::AuditFailure(message) => (
            AgentRunStatus::AuditFailed,
            runtime_error(AgentRuntimeErrorKind::Unknown, message),
            None,
        ),
        ExitCause::ProtocolFailure(message) => (
            AgentRunStatus::Failed,
            runtime_error(AgentRuntimeErrorKind::OutputParseFailed, message),
            None,
        ),
        ExitCause::WaitFailure(message) => (
            AgentRunStatus::Crashed,
            runtime_error(AgentRuntimeErrorKind::ProcessCrashed, message),
            None,
        ),
        ExitCause::Process {
            success: false,
            code,
        } => (
            AgentRunStatus::Failed,
            runtime_error(
                AgentRuntimeErrorKind::ProcessCrashed,
                "provider process exited unsuccessfully".to_string(),
            ),
            code,
        ),
        ExitCause::Process {
            success: true,
            code,
        } => (
            AgentRunStatus::Crashed,
            runtime_error(
                AgentRuntimeErrorKind::ProcessCrashed,
                "provider process exited without provider success evidence".to_string(),
            ),
            code,
        ),
    }
}

fn close_writer_failed(
    writer: &mut NativeAuditWriter,
) -> Result<NativeAuditManifest, ProcessHostError> {
    writer
        .fail_closed()
        .map_err(|error| ProcessHostError::Audit(error.to_string()))
}

pub(crate) async fn send_host_command(
    endpoint: &str,
    auth_token: &str,
    command: HostCommand,
) -> Result<HostResponse, TransportError> {
    let mut stream = TcpStream::connect(endpoint)
        .await
        .map_err(|error| TransportError::TemporarilyUnavailable(error.to_string()))?;
    write_json_frame(
        &mut stream,
        &AuthenticatedHostCommand {
            auth_token: auth_token.to_string(),
            command,
        },
    )
    .await?;
    read_json_frame(&mut stream).await
}
