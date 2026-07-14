use std::{
    collections::{HashMap, VecDeque},
    io,
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use codex_app_server_protocol::{
    ClientInfo, ClientNotification, ClientRequest, CommandExecutionApprovalDecision,
    CommandExecutionRequestApprovalResponse, ConfigBatchWriteParams, ConfigEdit, ConfigReadParams,
    ConfigReadResponse, ConfigWriteResponse, CurrentTimeReadResponse,
    DynamicToolCallOutputContentItem, DynamicToolCallResponse, FileChangeApprovalDecision,
    FileChangeRequestApprovalResponse, GetAccountParams, GetAccountRateLimitsResponse,
    GetAccountResponse, InitializeCapabilities, InitializeParams, InitializeResponse,
    ItemCompletedNotification, JSONRPCError, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse,
    ListMcpServerStatusParams, ListMcpServerStatusResponse, McpServerElicitationAction,
    McpServerElicitationRequestResponse, McpServerStatusDetail, ModelListParams, ModelListResponse,
    RequestId, ReviewStartParams, ReviewStartResponse, ReviewTarget, ServerRequest,
    SkillsListParams, SkillsListResponse, ThreadCompactStartParams, ThreadCompactStartResponse,
    ThreadGoalClearParams, ThreadGoalClearResponse, ThreadGoalGetParams, ThreadGoalGetResponse,
    ThreadGoalSetParams, ThreadGoalSetResponse, ThreadItem, ThreadReadParams, ThreadReadResponse,
    ThreadResumeParams, ThreadResumeResponse, ThreadSettingsUpdateParams,
    ThreadSettingsUpdateResponse, ThreadStartParams, ThreadStartResponse,
    ToolRequestUserInputAnswer, ToolRequestUserInputQuestion, ToolRequestUserInputResponse,
    TurnCompletedNotification, TurnStartParams, TurnStartResponse, TurnStatus, UserInput,
};
use codex_protocol::{
    config_types::{CollaborationMode, ModeKind, Settings},
    openai_models::ReasoningEffort as ProtocolReasoningEffort,
};
use futures::TryFutureExt;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{self, Value};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt, BufWriter},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use workspace_utils::approvals::{ApprovalStatus, QuestionStatus};

use super::jsonrpc::{JsonRpcCallbacks, JsonRpcControlFlow, JsonRpcPeer};
use crate::{
    approvals::{ExecutorApprovalError, ExecutorApprovalService},
    env::RepoContext,
    executors::{ExecutorError, ExecutorExitResult, codex::normalize_logs::Approval},
};

struct PendingPlan {
    item_id: String,
}

pub struct AppServerClient {
    rpc: OnceLock<JsonRpcPeer>,
    log_writer: LogWriter,
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
    thread_id: Mutex<Option<String>>,
    pending_feedback: Mutex<VecDeque<String>>,
    auto_approve: bool,
    plan_mode: bool,
    resolved_model: OnceLock<String>,
    reasoning_effort: StdMutex<Option<ProtocolReasoningEffort>>,
    pending_plan: Mutex<Option<PendingPlan>>,
    repo_context: RepoContext,
    commit_reminder: bool,
    commit_reminder_prompt: String,
    commit_reminder_sent: AtomicBool,
    cancel: CancellationToken,
}

impl AppServerClient {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        log_writer: LogWriter,
        approvals: Option<Arc<dyn ExecutorApprovalService>>,
        auto_approve: bool,
        plan_mode: bool,
        reasoning_effort: Option<ProtocolReasoningEffort>,
        repo_context: RepoContext,
        commit_reminder: bool,
        commit_reminder_prompt: String,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            rpc: OnceLock::new(),
            log_writer,
            approvals,
            auto_approve,
            plan_mode,
            resolved_model: OnceLock::new(),
            reasoning_effort: StdMutex::new(reasoning_effort),
            pending_plan: Mutex::new(None),
            thread_id: Mutex::new(None),
            pending_feedback: Mutex::new(VecDeque::new()),
            repo_context,
            commit_reminder,
            commit_reminder_prompt,
            commit_reminder_sent: AtomicBool::new(false),
            cancel,
        })
    }

    pub fn connect(&self, peer: JsonRpcPeer) {
        let _ = self.rpc.set(peer);
    }

    pub fn set_resolved_model(&self, model: String) {
        let _ = self.resolved_model.set(model);
    }

    fn rpc(&self) -> &JsonRpcPeer {
        self.rpc.get().expect("Codex RPC peer not attached")
    }

    pub fn log_writer(&self) -> &LogWriter {
        &self.log_writer
    }

    pub async fn initialize(&self) -> Result<(), ExecutorError> {
        let request = ClientRequest::Initialize {
            request_id: self.next_request_id(),
            params: InitializeParams {
                client_info: ClientInfo {
                    name: "vibe-codex-executor".to_string(),
                    title: None,
                    version: env!("CARGO_PKG_VERSION").to_string(),
                },
                capabilities: Some(InitializeCapabilities {
                    experimental_api: true,
                    ..Default::default()
                }),
            },
        };

        let response = self
            .send_request::<InitializeResponse>(request, "initialize")
            .await?;
        ensure_codex_version(&response.user_agent)?;
        self.send_message(&ClientNotification::Initialized).await
    }

    pub async fn thread_start(
        &self,
        params: ThreadStartParams,
    ) -> Result<ThreadStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadStart {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/start").await
    }

    pub async fn thread_resume(
        &self,
        params: ThreadResumeParams,
    ) -> Result<ThreadResumeResponse, ExecutorError> {
        // A Vibe follow-up continues the same native Codex conversation.
        // `thread/fork` would create another CLI-visible thread on every turn.
        let requested_thread_id = params.thread_id.clone();
        let request = ClientRequest::ThreadResume {
            request_id: self.next_request_id(),
            params,
        };
        let response: ThreadResumeResponse = self.send_request(request, "thread/resume").await?;
        ensure_resumed_thread_id(&requested_thread_id, &response.thread.id)?;
        Ok(response)
    }

    pub async fn turn_start_with_mode(
        &self,
        thread_id: String,
        input: Vec<UserInput>,
        collaboration_mode: Option<CollaborationMode>,
    ) -> Result<TurnStartResponse, ExecutorError> {
        let effort = self.current_reasoning_effort();
        let request = ClientRequest::TurnStart {
            request_id: self.next_request_id(),
            params: build_turn_start_params(thread_id, input, collaboration_mode, effort),
        };
        self.send_request(request, "turn/start").await
    }

    fn collaboration_mode_with_reasoning(
        &self,
        mode: ModeKind,
        reasoning_effort: Option<ProtocolReasoningEffort>,
    ) -> Result<CollaborationMode, ExecutorError> {
        let model = self.resolved_model.get().cloned().ok_or_else(|| {
            tracing::error!(
                "collaboration_mode_with_reasoning called before resolved_model was set"
            );
            ExecutorError::Io(io::Error::other(
                "resolved model not available for collaboration mode",
            ))
        })?;
        Ok(CollaborationMode {
            mode,
            settings: Settings {
                model,
                reasoning_effort,
                developer_instructions: None,
            },
        })
    }

    fn collaboration_mode(&self, mode: ModeKind) -> Result<CollaborationMode, ExecutorError> {
        self.collaboration_mode_with_reasoning(mode, self.current_reasoning_effort())
    }

    pub fn initial_collaboration_mode(&self) -> Result<CollaborationMode, ExecutorError> {
        if self.plan_mode {
            self.collaboration_mode(ModeKind::Plan)
        } else {
            self.collaboration_mode(ModeKind::Default)
        }
    }

    fn current_reasoning_effort(&self) -> Option<ProtocolReasoningEffort> {
        match self.reasoning_effort.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => {
                tracing::error!("Codex reasoning effort state was poisoned");
                poisoned.into_inner().clone()
            }
        }
    }

    fn set_reasoning_effort(&self, effort: Option<ProtocolReasoningEffort>) {
        match self.reasoning_effort.lock() {
            Ok(mut guard) => {
                *guard = effort;
            }
            Err(poisoned) => {
                tracing::error!("Codex reasoning effort state was poisoned");
                *poisoned.into_inner() = effort;
            }
        }
    }

    pub async fn get_account(&self) -> Result<GetAccountResponse, ExecutorError> {
        let request = ClientRequest::GetAccount {
            request_id: self.next_request_id(),
            params: GetAccountParams {
                refresh_token: false,
            },
        };
        self.send_request(request, "account/read").await
    }

    pub async fn start_review(
        &self,
        thread_id: String,
        target: ReviewTarget,
    ) -> Result<ReviewStartResponse, ExecutorError> {
        let request = ClientRequest::ReviewStart {
            request_id: self.next_request_id(),
            params: ReviewStartParams {
                thread_id,
                target,
                delivery: None,
            },
        };
        self.send_request(request, "reviewStart").await
    }

    pub async fn list_mcp_server_status(
        &self,
        cursor: Option<String>,
    ) -> Result<ListMcpServerStatusResponse, ExecutorError> {
        let thread_id = self.thread_id.lock().await.clone();
        let request = ClientRequest::McpServerStatusList {
            request_id: self.next_request_id(),
            params: ListMcpServerStatusParams {
                cursor,
                limit: None,
                detail: Some(McpServerStatusDetail::ToolsAndAuthOnly),
                thread_id,
            },
        };
        self.send_request(request, "mcpServerStatus/list").await
    }

    pub async fn skills_list(&self, cwd: PathBuf) -> Result<SkillsListResponse, ExecutorError> {
        let request = ClientRequest::SkillsList {
            request_id: self.next_request_id(),
            params: SkillsListParams {
                cwds: vec![cwd],
                force_reload: false,
            },
        };
        self.send_request(request, "skills/list").await
    }

    pub async fn model_list(&self) -> Result<ModelListResponse, ExecutorError> {
        let request = ClientRequest::ModelList {
            request_id: self.next_request_id(),
            params: ModelListParams::default(),
        };
        self.send_request(request, "model/list").await
    }

    pub async fn thread_compact_start(
        &self,
        thread_id: String,
    ) -> Result<ThreadCompactStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadCompactStart {
            request_id: self.next_request_id(),
            params: ThreadCompactStartParams { thread_id },
        };
        self.send_request(request, "thread/compact/start").await
    }

    pub async fn thread_read(
        &self,
        thread_id: String,
    ) -> Result<ThreadReadResponse, ExecutorError> {
        let request = ClientRequest::ThreadRead {
            request_id: self.next_request_id(),
            params: ThreadReadParams {
                thread_id,
                include_turns: false,
            },
        };
        self.send_request(request, "thread/read").await
    }

    pub async fn thread_goal_set(
        &self,
        params: ThreadGoalSetParams,
    ) -> Result<ThreadGoalSetResponse, ExecutorError> {
        let request = ClientRequest::ThreadGoalSet {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/goal/set").await
    }

    pub async fn thread_goal_get(
        &self,
        thread_id: String,
    ) -> Result<ThreadGoalGetResponse, ExecutorError> {
        let request = ClientRequest::ThreadGoalGet {
            request_id: self.next_request_id(),
            params: ThreadGoalGetParams { thread_id },
        };
        self.send_request(request, "thread/goal/get").await
    }

    pub async fn thread_goal_clear(
        &self,
        thread_id: String,
    ) -> Result<ThreadGoalClearResponse, ExecutorError> {
        let request = ClientRequest::ThreadGoalClear {
            request_id: self.next_request_id(),
            params: ThreadGoalClearParams { thread_id },
        };
        self.send_request(request, "thread/goal/clear").await
    }

    pub async fn thread_settings_update(
        &self,
        params: ThreadSettingsUpdateParams,
    ) -> Result<ThreadSettingsUpdateResponse, ExecutorError> {
        let reasoning_update = reasoning_update_from_thread_settings(&params);
        let request = ClientRequest::ThreadSettingsUpdate {
            request_id: self.next_request_id(),
            params,
        };
        let response = self.send_request(request, "thread/settings/update").await?;
        if let ReasoningEffortUpdate::Set(effort) = reasoning_update {
            self.set_reasoning_effort(effort);
        }
        Ok(response)
    }

    pub fn build_reasoning_thread_settings_update_params(
        &self,
        thread_id: String,
        effort: Option<ProtocolReasoningEffort>,
    ) -> Result<ThreadSettingsUpdateParams, ExecutorError> {
        let mode = if self.plan_mode {
            ModeKind::Plan
        } else {
            ModeKind::Default
        };
        let collaboration_mode = self.collaboration_mode_with_reasoning(mode, effort.clone())?;
        Ok(build_thread_settings_update_params(
            thread_id,
            effort,
            Some(collaboration_mode),
        ))
    }

    pub async fn config_batch_write(
        &self,
        edits: Vec<ConfigEdit>,
    ) -> Result<ConfigWriteResponse, ExecutorError> {
        let request = ClientRequest::ConfigBatchWrite {
            request_id: self.next_request_id(),
            params: ConfigBatchWriteParams {
                edits,
                file_path: None,
                expected_version: None,
                reload_user_config: false,
            },
        };
        self.send_request(request, "config/batchWrite").await
    }

    pub async fn config_read(
        &self,
        cwd: Option<String>,
    ) -> Result<ConfigReadResponse, ExecutorError> {
        let request = ClientRequest::ConfigRead {
            request_id: self.next_request_id(),
            params: ConfigReadParams {
                include_layers: false,
                cwd,
            },
        };
        self.send_request(request, "config/read").await
    }

    pub async fn get_account_rate_limits(
        &self,
    ) -> Result<GetAccountRateLimitsResponse, ExecutorError> {
        let request = ClientRequest::GetAccountRateLimits {
            request_id: self.next_request_id(),
            params: None,
        };
        self.send_request(request, "account/rateLimits/read").await
    }

    async fn handle_server_request(
        &self,
        peer: &JsonRpcPeer,
        request: ServerRequest,
    ) -> Result<(), ExecutorError> {
        match request {
            ServerRequest::FileChangeRequestApproval { request_id, params } => {
                let call_id = params.item_id.clone();
                let status = self
                    .request_tool_approval("edit", "codex.apply_patch", &call_id)
                    .await
                    .inspect_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex file_change approval failed for item_id={}: {err}",
                                call_id
                            );
                        }
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            call_id,
                            "codex.apply_patch".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;
                let (decision, feedback) = self.file_change_decision(&status);
                let response = FileChangeRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing file change denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::CommandExecutionRequestApproval { request_id, params } => {
                let call_id = params.item_id.clone();
                let status = self
                    .request_tool_approval("bash", "codex.exec_command", &call_id)
                    .await
                    .inspect_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex command_execution approval failed for item_id={}: {err}",
                                call_id
                            );
                        }
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            call_id,
                            "codex.exec_command".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;
                let (decision, feedback) = self.command_execution_decision(&status);
                let response = CommandExecutionRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing exec denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::ToolRequestUserInput { request_id, params } => {
                let call_id = params.item_id.clone();
                let question_count = params.questions.len();
                let status = self
                    .request_question_answer(
                        question_count,
                        &call_id,
                        params.auto_resolution_ms.map(Duration::from_millis),
                    )
                    .await
                    .inspect_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex question approval failed for call_id={}: {err}",
                                call_id
                            );
                        }
                    })?;
                self.log_writer
                    .log_raw(&Approval::question_response(call_id.clone(), status.clone()).raw())
                    .await?;
                let response = match &status {
                    QuestionStatus::Answered { answers } => {
                        let answers_map: HashMap<String, Vec<String>> = answers
                            .iter()
                            .map(|qa| (qa.question.clone(), qa.answer.clone()))
                            .collect();
                        answers_to_codex_format(&params.questions, &answers_map)
                    }
                    _ => ToolRequestUserInputResponse {
                        answers: HashMap::new(),
                    },
                };
                send_server_response(peer, request_id, response).await?;
                Ok(())
            }
            ServerRequest::CurrentTimeRead { request_id, .. } => {
                send_server_response(
                    peer,
                    request_id,
                    CurrentTimeReadResponse {
                        current_time_at: chrono::Utc::now().timestamp(),
                    },
                )
                .await
            }
            ServerRequest::McpServerElicitationRequest { request_id, params } => {
                tracing::warn!(
                    server = %params.server_name,
                    "MCP elicitation UI is unavailable; cancelling the request"
                );
                send_server_response(
                    peer,
                    request_id,
                    McpServerElicitationRequestResponse {
                        action: McpServerElicitationAction::Cancel,
                        content: None,
                        meta: None,
                    },
                )
                .await
            }
            ServerRequest::DynamicToolCall { request_id, params } => {
                tracing::warn!(
                    "received unsupported dynamic tool call: tool={} call_id={}",
                    params.tool,
                    params.call_id
                );
                let response = DynamicToolCallResponse {
                    content_items: vec![DynamicToolCallOutputContentItem::InputText {
                        text: format!(
                            "Dynamic tool '{}' is not supported by this client.",
                            params.tool
                        ),
                    }],
                    success: false,
                };
                send_server_response(peer, request_id, response).await?;
                Ok(())
            }
            ServerRequest::ChatgptAuthTokensRefresh { .. }
            | ServerRequest::AttestationGenerate { .. }
            | ServerRequest::PermissionsRequestApproval { .. } => {
                tracing::warn!("received unhandled v2 server request: {:?}", request);
                let response = JSONRPCResponse {
                    id: request.id().clone(),
                    result: Value::Null,
                };
                peer.send(&response).await
            }
            ServerRequest::ApplyPatchApproval { .. }
            | ServerRequest::ExecCommandApproval { .. } => {
                tracing::error!(
                    "received deprecated v1 server request (session may have been started with legacy API): {:?}",
                    request
                );
                Err(ExecutorApprovalError::RequestFailed(
                    "deprecated v1 server request".to_string(),
                )
                .into())
            }
        }
    }

    async fn request_tool_approval(
        &self,
        tool_name: &str,
        display_tool_name: &str,
        tool_call_id: &str,
    ) -> Result<ApprovalStatus, ExecutorError> {
        if self.auto_approve {
            return Ok(ApprovalStatus::Approved);
        }
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        let approval_id = approval_service
            .create_tool_approval(tool_name)
            .or_else(|err| async {
                self.handle_approval_error(display_tool_name, tool_call_id)
                    .await;
                Err(err)
            })
            .await?;

        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_requested(
                    tool_call_id.to_string(),
                    display_tool_name.to_string(),
                    approval_id.clone(),
                )
                .raw(),
            )
            .await;

        approval_service
            .wait_tool_approval(&approval_id, self.cancel.clone())
            .or_else(|err| async {
                self.handle_approval_error(display_tool_name, tool_call_id)
                    .await;
                Err(err)
            })
            .await
            .map_err(ExecutorError::from)
    }

    async fn handle_approval_error(&self, display_tool_name: &str, tool_call_id: &str) {
        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_response(
                    tool_call_id.to_string(),
                    display_tool_name.to_string(),
                    ApprovalStatus::TimedOut,
                )
                .raw(),
            )
            .await;
    }

    async fn request_question_answer(
        &self,
        question_count: usize,
        tool_call_id: &str,
        timeout: Option<Duration>,
    ) -> Result<QuestionStatus, ExecutorError> {
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        let approval_id = approval_service
            .create_question_approval_with_timeout("question", question_count, timeout)
            .or_else(|err| async {
                self.handle_question_error(tool_call_id).await;
                Err(err)
            })
            .await?;

        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_requested(
                    tool_call_id.to_string(),
                    "codex.question".to_string(),
                    approval_id.clone(),
                )
                .raw(),
            )
            .await;

        approval_service
            .wait_question_answer(&approval_id, self.cancel.clone())
            .or_else(|err| async {
                self.handle_question_error(tool_call_id).await;
                Err(err)
            })
            .await
            .map_err(ExecutorError::from)
    }

    async fn handle_question_error(&self, tool_call_id: &str) {
        let _ = self
            .log_writer
            .log_raw(
                &Approval::question_response(tool_call_id.to_string(), QuestionStatus::TimedOut)
                    .raw(),
            )
            .await;
    }

    async fn handle_plan_completed(&self, plan: PendingPlan) -> Result<bool, ExecutorError> {
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        let approval_id = approval_service
            .create_tool_approval("plan")
            .or_else(|err| async {
                self.handle_approval_error("codex.plan", &plan.item_id)
                    .await;
                Err(err)
            })
            .await?;

        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_requested(
                    plan.item_id.clone(),
                    "codex.plan".to_string(),
                    approval_id.clone(),
                )
                .raw(),
            )
            .await;

        let status = approval_service
            .wait_tool_approval(&approval_id, self.cancel.clone())
            .or_else(|err| async {
                self.handle_approval_error("codex.plan", &plan.item_id)
                    .await;
                Err(err)
            })
            .await
            .map_err(ExecutorError::from)?;

        self.log_writer
            .log_raw(
                &Approval::approval_response(
                    plan.item_id,
                    "codex.plan".to_string(),
                    status.clone(),
                )
                .raw(),
            )
            .await?;

        let Some(thread_id) = self.thread_id.lock().await.clone() else {
            return Ok(true);
        };

        match status {
            ApprovalStatus::Approved => {
                self.spawn_turn_start(
                    thread_id,
                    "Implement the plan.".to_string(),
                    Some(self.collaboration_mode(ModeKind::Default)?),
                );
                Ok(false)
            }
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if let Some(feedback_text) = feedback {
                    self.spawn_turn_start(
                        thread_id,
                        format!("User feedback on the plan: {feedback_text}"),
                        Some(self.collaboration_mode(ModeKind::Plan)?),
                    );
                    Ok(false)
                } else {
                    Ok(true)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => Ok(true),
        }
    }

    pub async fn register_session(&self, thread_id: &str) -> Result<(), ExecutorError> {
        {
            let mut guard = self.thread_id.lock().await;
            guard.replace(thread_id.to_string());
        }
        self.flush_pending_feedback().await;
        Ok(())
    }

    async fn send_message<M>(&self, message: &M) -> Result<(), ExecutorError>
    where
        M: Serialize + Sync,
    {
        self.rpc().send(message).await
    }

    async fn send_request<R>(&self, request: ClientRequest, label: &str) -> Result<R, ExecutorError>
    where
        R: DeserializeOwned + std::fmt::Debug,
    {
        let request_id = request_id(&request);
        self.rpc()
            .request(request_id, &request, label, self.cancel.clone())
            .await
    }

    fn next_request_id(&self) -> RequestId {
        self.rpc().next_request_id()
    }

    fn command_execution_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (CommandExecutionApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (CommandExecutionApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (CommandExecutionApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (CommandExecutionApprovalDecision::Cancel, feedback)
                } else {
                    (CommandExecutionApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut => (CommandExecutionApprovalDecision::Decline, None),
            ApprovalStatus::Pending => (CommandExecutionApprovalDecision::Decline, None),
        }
    }

    fn file_change_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (FileChangeApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (FileChangeApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (FileChangeApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (FileChangeApprovalDecision::Cancel, feedback)
                } else {
                    (FileChangeApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut => (FileChangeApprovalDecision::Decline, None),
            ApprovalStatus::Pending => (FileChangeApprovalDecision::Decline, None),
        }
    }

    async fn enqueue_feedback(&self, message: String) {
        if message.trim().is_empty() {
            return;
        }
        let mut guard = self.pending_feedback.lock().await;
        guard.push_back(message);
    }

    /// Sends pending feedback messages as new turns.
    /// Returns `true` if any messages were sent.
    async fn flush_pending_feedback(&self) -> bool {
        let messages: Vec<String> = {
            let mut guard = self.pending_feedback.lock().await;
            guard.drain(..).collect()
        };

        if messages.is_empty() {
            return false;
        }

        let Some(thread_id) = self.thread_id.lock().await.clone() else {
            tracing::warn!(
                "pending Codex feedback but thread id unavailable; dropping {} messages",
                messages.len()
            );
            return false;
        };

        let mut sent = false;
        for message in messages {
            let trimmed = message.trim();
            if trimmed.is_empty() {
                continue;
            }
            self.spawn_user_message(thread_id.clone(), format!("User feedback: {trimmed}"));
            sent = true;
        }
        sent
    }

    fn spawn_turn_start(
        &self,
        thread_id: String,
        message: String,
        collaboration_mode: Option<CollaborationMode>,
    ) {
        let peer = self.rpc().clone();
        let cancel = self.cancel.clone();
        let effort = self.current_reasoning_effort();
        let request = ClientRequest::TurnStart {
            request_id: peer.next_request_id(),
            params: build_turn_start_params(
                thread_id,
                vec![UserInput::Text {
                    text: message,
                    text_elements: vec![],
                }],
                collaboration_mode,
                effort,
            ),
        };
        tokio::spawn(async move {
            if let Err(err) = peer
                .request::<TurnStartResponse, _>(
                    request_id(&request),
                    &request,
                    "turn/start",
                    cancel,
                )
                .await
            {
                tracing::error!("failed to send user message: {err}");
            }
        });
    }

    fn spawn_user_message(&self, thread_id: String, message: String) {
        self.spawn_turn_start(thread_id, message, None);
    }
}

pub(crate) fn build_turn_start_params(
    thread_id: String,
    input: Vec<UserInput>,
    collaboration_mode: Option<CollaborationMode>,
    effort: Option<ProtocolReasoningEffort>,
) -> TurnStartParams {
    TurnStartParams {
        thread_id,
        input,
        effort,
        collaboration_mode,
        ..Default::default()
    }
}

fn build_thread_settings_update_params(
    thread_id: String,
    effort: Option<ProtocolReasoningEffort>,
    collaboration_mode: Option<CollaborationMode>,
) -> ThreadSettingsUpdateParams {
    ThreadSettingsUpdateParams {
        thread_id,
        effort,
        collaboration_mode,
        ..Default::default()
    }
}

enum ReasoningEffortUpdate {
    Unchanged,
    Set(Option<ProtocolReasoningEffort>),
}

fn reasoning_update_from_thread_settings(
    params: &ThreadSettingsUpdateParams,
) -> ReasoningEffortUpdate {
    if let Some(collaboration_mode) = &params.collaboration_mode {
        return ReasoningEffortUpdate::Set(collaboration_mode.settings.reasoning_effort.clone());
    }
    if let Some(effort) = &params.effort {
        return ReasoningEffortUpdate::Set(Some(effort.clone()));
    }
    ReasoningEffortUpdate::Unchanged
}

fn turn_completion_control_flow(status: &TurnStatus, keep_alive: bool) -> JsonRpcControlFlow {
    if keep_alive && matches!(status, TurnStatus::Completed | TurnStatus::Interrupted) {
        return JsonRpcControlFlow::Continue;
    }

    match status {
        TurnStatus::Completed => JsonRpcControlFlow::Exit(ExecutorExitResult::Success),
        TurnStatus::Interrupted | TurnStatus::Failed | TurnStatus::InProgress => {
            JsonRpcControlFlow::Exit(ExecutorExitResult::Failure)
        }
    }
}

fn parse_turn_completed_params(
    params: Option<&Value>,
) -> Result<TurnCompletedNotification, ExecutorError> {
    let params = params.ok_or_else(|| {
        ExecutorError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            "turn/completed notification missing params",
        ))
    })?;
    serde_json::from_value(params.clone()).map_err(ExecutorError::from)
}

#[async_trait]
impl JsonRpcCallbacks for AppServerClient {
    async fn on_request(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        request: JSONRPCRequest,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        match ServerRequest::try_from(request.clone()) {
            Ok(server_request) => self.handle_server_request(peer, server_request).await,
            Err(err) => {
                tracing::debug!("Unhandled server request `{}`: {err}", request.method);
                let response = JSONRPCResponse {
                    id: request.id,
                    result: Value::Null,
                };
                peer.send(&response).await
            }
        }
    }

    async fn on_response(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _response: &JSONRPCResponse,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_error(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _error: &JSONRPCError,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_notification(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        notification: JSONRPCNotification,
    ) -> Result<JsonRpcControlFlow, ExecutorError> {
        self.log_writer.log_raw(raw).await?;

        let method = notification.method.as_str();

        // Detect completed plan items in the notification stream
        if self.plan_mode
            && method == "item/completed"
            && let Some(ref params) = notification.params
            && let Ok(completed) =
                serde_json::from_value::<ItemCompletedNotification>(params.clone())
            && let ThreadItem::Plan { id, .. } = completed.item
        {
            *self.pending_plan.lock().await = Some(PendingPlan { item_id: id });
        }

        // V2 turn completion detection
        if method == "turn/completed" {
            let completed = parse_turn_completed_params(notification.params.as_ref())?;

            match completed.turn.status {
                TurnStatus::Failed => {
                    tracing::error!(
                        turn_id = %completed.turn.id,
                        error = ?completed.turn.error,
                        "Codex turn failed"
                    );
                    return Ok(turn_completion_control_flow(&TurnStatus::Failed, false));
                }
                TurnStatus::InProgress => {
                    tracing::warn!(
                        turn_id = %completed.turn.id,
                        "Codex sent turn/completed with an in-progress turn"
                    );
                    return Ok(turn_completion_control_flow(&TurnStatus::InProgress, false));
                }
                TurnStatus::Interrupted => {
                    tracing::debug!("Codex turn interrupted; flushing feedback queue");
                    let keep_alive = self.flush_pending_feedback().await;
                    return Ok(turn_completion_control_flow(
                        &TurnStatus::Interrupted,
                        keep_alive,
                    ));
                }
                TurnStatus::Completed => {}
            }

            // Handle plan approval on turn completion
            let pending = if self.plan_mode {
                self.pending_plan.lock().await.take()
            } else {
                None
            };
            if let Some(plan) = pending {
                let finished = self.handle_plan_completed(plan).await?;
                return Ok(turn_completion_control_flow(
                    &TurnStatus::Completed,
                    !finished,
                ));
            }

            // Handle commit reminder on turn completion
            if self.commit_reminder
                && !self.commit_reminder_sent.swap(true, Ordering::SeqCst)
                && let status = self.repo_context.check_uncommitted_changes().await
                && !status.is_empty()
                && let Some(thread_id) = self.thread_id.lock().await.clone()
            {
                let prompt = format!("{}\n{}", self.commit_reminder_prompt, status);
                self.spawn_user_message(thread_id, prompt);
                return Ok(JsonRpcControlFlow::Continue);
            }

            return Ok(turn_completion_control_flow(&TurnStatus::Completed, false));
        }

        Ok(JsonRpcControlFlow::Continue)
    }

    async fn on_non_json(&self, raw: &str) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        Ok(())
    }
}

async fn send_server_response<T>(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    response: T,
) -> Result<(), ExecutorError>
where
    T: Serialize,
{
    let payload = JSONRPCResponse {
        id: request_id,
        result: serde_json::to_value(response)
            .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
    };

    peer.send(&payload).await
}

/// Convert our `HashMap<question_text, Vec<answer_labels>>` answer format to
/// Codex's `HashMap<question_id, ToolRequestUserInputAnswer>` format.
fn answers_to_codex_format(
    questions: &[ToolRequestUserInputQuestion],
    answers: &HashMap<String, Vec<String>>,
) -> ToolRequestUserInputResponse {
    let codex_answers = questions
        .iter()
        .filter_map(|q| {
            answers.get(&q.question).map(|answer_vec| {
                (
                    q.id.clone(),
                    ToolRequestUserInputAnswer {
                        answers: answer_vec.clone(),
                    },
                )
            })
        })
        .collect();

    ToolRequestUserInputResponse {
        answers: codex_answers,
    }
}

fn request_id(request: &ClientRequest) -> RequestId {
    match request {
        ClientRequest::Initialize { request_id, .. }
        | ClientRequest::ThreadStart { request_id, .. }
        | ClientRequest::ThreadResume { request_id, .. }
        | ClientRequest::ThreadFork { request_id, .. }
        | ClientRequest::TurnStart { request_id, .. }
        | ClientRequest::GetAccount { request_id, .. }
        | ClientRequest::ReviewStart { request_id, .. }
        | ClientRequest::McpServerStatusList { request_id, .. }
        | ClientRequest::SkillsList { request_id, .. }
        | ClientRequest::ModelList { request_id, .. }
        | ClientRequest::ThreadCompactStart { request_id, .. }
        | ClientRequest::ThreadRead { request_id, .. }
        | ClientRequest::ThreadGoalSet { request_id, .. }
        | ClientRequest::ThreadGoalGet { request_id, .. }
        | ClientRequest::ThreadGoalClear { request_id, .. }
        | ClientRequest::ThreadSettingsUpdate { request_id, .. }
        | ClientRequest::ConfigRead { request_id, .. }
        | ClientRequest::ConfigBatchWrite { request_id, .. }
        | ClientRequest::GetAccountRateLimits { request_id, .. } => request_id.clone(),
        _ => unreachable!("request_id called for unsupported request variant"),
    }
}

fn ensure_resumed_thread_id(requested: &str, actual: &str) -> Result<(), ExecutorError> {
    if requested == actual {
        return Ok(());
    }

    Err(ExecutorError::Io(io::Error::other(format!(
        "Codex thread/resume returned a different thread id: requested {requested}, got {actual}"
    ))))
}

#[derive(Clone)]
pub struct LogWriter {
    writer: Arc<Mutex<BufWriter<Box<dyn AsyncWrite + Send + Unpin>>>>,
}

impl LogWriter {
    pub fn new(writer: impl AsyncWrite + Send + Unpin + 'static) -> Self {
        Self {
            writer: Arc::new(Mutex::new(BufWriter::new(Box::new(writer)))),
        }
    }

    pub async fn log_raw(&self, raw: &str) -> Result<(), ExecutorError> {
        let mut guard = self.writer.lock().await;
        guard
            .write_all(raw.as_bytes())
            .await
            .map_err(ExecutorError::Io)?;
        guard.write_all(b"\n").await.map_err(ExecutorError::Io)?;
        guard.flush().await.map_err(ExecutorError::Io)?;
        Ok(())
    }
}

/// The Codex version this build is tested against. Must match the
/// `codex-app-server-protocol` tag pinned in `crates/executors/Cargo.toml`
/// and the `@openai/codex` version pinned in `npx-cli/package.json`.
const EXPECTED_CODEX_VERSION: &str = "0.144.1";

/// Reject a running app-server that does not exactly match the protocol this
/// build targets. The bundled CLI follows this version by construction; users
/// opting into a system Codex must install the same stable release.
fn ensure_codex_version(user_agent: &str) -> Result<(), ExecutorError> {
    let expected = crate::executors::bundled::bundled_codex_version()
        .unwrap_or_else(|| EXPECTED_CODEX_VERSION.to_string());
    let Some(actual) = extract_semver(user_agent) else {
        return Err(ExecutorError::Io(io::Error::other(format!(
            "could not parse Codex version from app-server user agent `{user_agent}`; expected {expected}"
        ))));
    };
    if actual != expected {
        return Err(ExecutorError::Io(io::Error::other(format!(
            "Codex app-server version mismatch: running {actual}, but this build requires {expected}"
        ))));
    }
    tracing::debug!("codex app-server version {actual} matches expected {expected}");
    Ok(())
}

/// Extracts the first `x.y.z`-shaped token from a user-agent string such as
/// `codex/0.144.1 (Windows 10; x86_64) vibe-codex-executor`.
fn extract_semver(input: &str) -> Option<String> {
    input
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .filter(|token| !token.is_empty())
        .find(|token| {
            token.matches('.').count() >= 2
                && token.chars().next().is_some_and(|c| c.is_ascii_digit())
                && token.chars().last().is_some_and(|c| c.is_ascii_digit())
        })
        .map(str::to_string)
}

#[cfg(test)]
mod version_check_tests {
    use codex_protocol::{
        config_types::{CollaborationMode, ModeKind, Settings},
        openai_models::ReasoningEffort as ProtocolReasoningEffort,
    };
    use serde_json::json;
    use tokio_util::sync::CancellationToken;

    use super::{
        AppServerClient, ExecutorExitResult, JsonRpcControlFlow, LogWriter, ReasoningEffortUpdate,
        TurnStatus, build_thread_settings_update_params, build_turn_start_params,
        ensure_codex_version, ensure_resumed_thread_id, extract_semver,
        parse_turn_completed_params, reasoning_update_from_thread_settings,
        turn_completion_control_flow,
    };

    #[test]
    fn turn_completion_statuses_fail_closed() {
        assert!(matches!(
            turn_completion_control_flow(&TurnStatus::Completed, false),
            JsonRpcControlFlow::Exit(ExecutorExitResult::Success)
        ));
        assert!(matches!(
            turn_completion_control_flow(&TurnStatus::Failed, false),
            JsonRpcControlFlow::Exit(ExecutorExitResult::Failure)
        ));
        assert!(matches!(
            turn_completion_control_flow(&TurnStatus::Interrupted, false),
            JsonRpcControlFlow::Exit(ExecutorExitResult::Failure)
        ));
        assert!(matches!(
            turn_completion_control_flow(&TurnStatus::InProgress, false),
            JsonRpcControlFlow::Exit(ExecutorExitResult::Failure)
        ));
        assert!(matches!(
            turn_completion_control_flow(&TurnStatus::Interrupted, true),
            JsonRpcControlFlow::Continue
        ));
        assert!(matches!(
            turn_completion_control_flow(&TurnStatus::Completed, true),
            JsonRpcControlFlow::Continue
        ));
    }

    #[test]
    fn turn_completed_params_must_be_present_and_valid() {
        let params = json!({
            "threadId": "thread-1",
            "turn": {
                "id": "turn-1",
                "items": [],
                "status": "completed",
                "error": null,
                "startedAt": null,
                "completedAt": null,
                "durationMs": null
            }
        });

        let completed = parse_turn_completed_params(Some(&params)).expect("valid completion");
        assert_eq!(completed.turn.status, TurnStatus::Completed);
        assert!(parse_turn_completed_params(None).is_err());

        let malformed = json!({ "turn": { "status": "completed" } });
        assert!(parse_turn_completed_params(Some(&malformed)).is_err());
    }

    #[test]
    fn extracts_version_from_user_agent() {
        assert_eq!(
            extract_semver("codex/0.144.1 (Windows 10; x86_64) vibe-codex-executor"),
            Some("0.144.1".to_string())
        );
        assert_eq!(
            extract_semver("codex/1.2.3-alpha.1"),
            Some("1.2.3".to_string())
        );
        assert_eq!(extract_semver("no version here"), None);
    }

    #[test]
    fn codex_version_must_match_exactly() {
        assert!(ensure_codex_version("codex/0.144.1").is_ok());
        assert!(ensure_codex_version("codex/0.144.0").is_err());
        assert!(ensure_codex_version("codex/0.145.0").is_err());
        assert!(ensure_codex_version("unknown").is_err());
    }

    #[test]
    fn resumed_thread_must_keep_the_requested_id() {
        assert!(ensure_resumed_thread_id("thread-1", "thread-1").is_ok());

        let error = ensure_resumed_thread_id("thread-1", "thread-2")
            .expect_err("a resume response must not silently become a fork");
        assert!(
            error
                .to_string()
                .contains("requested thread-1, got thread-2")
        );
    }

    // Regression: request_id() must handle every ClientRequest variant the
    // client actually sends, or send_request panics at runtime. model_list()
    // sends ModelList, which was missing from the match.
    #[test]
    fn request_id_handles_model_list() {
        use codex_app_server_protocol::{ClientRequest, ModelListParams, RequestId};

        let req = ClientRequest::ModelList {
            request_id: RequestId::Integer(7),
            params: ModelListParams::default(),
        };
        assert_eq!(super::request_id(&req), RequestId::Integer(7));
    }

    #[test]
    fn request_id_handles_goal_and_settings_requests() {
        use codex_app_server_protocol::{
            ClientRequest, RequestId, ThreadGoalClearParams, ThreadGoalGetParams,
            ThreadGoalSetParams, ThreadSettingsUpdateParams,
        };

        let goal_set = ClientRequest::ThreadGoalSet {
            request_id: RequestId::Integer(8),
            params: ThreadGoalSetParams {
                thread_id: "thread_123".to_string(),
                objective: Some("ship slash commands".to_string()),
                status: None,
                token_budget: None,
            },
        };
        assert_eq!(super::request_id(&goal_set), RequestId::Integer(8));

        let goal_get = ClientRequest::ThreadGoalGet {
            request_id: RequestId::Integer(9),
            params: ThreadGoalGetParams {
                thread_id: "thread_123".to_string(),
            },
        };
        assert_eq!(super::request_id(&goal_get), RequestId::Integer(9));

        let goal_clear = ClientRequest::ThreadGoalClear {
            request_id: RequestId::Integer(10),
            params: ThreadGoalClearParams {
                thread_id: "thread_123".to_string(),
            },
        };
        assert_eq!(super::request_id(&goal_clear), RequestId::Integer(10));

        let settings_update = ClientRequest::ThreadSettingsUpdate {
            request_id: RequestId::Integer(11),
            params: ThreadSettingsUpdateParams {
                thread_id: "thread_123".to_string(),
                ..Default::default()
            },
        };
        assert_eq!(super::request_id(&settings_update), RequestId::Integer(11));
    }

    #[test]
    fn initial_collaboration_mode_includes_configured_reasoning_effort() {
        let client = AppServerClient::new(
            LogWriter::new(tokio::io::sink()),
            None,
            false,
            false,
            Some(ProtocolReasoningEffort::XHigh),
            Default::default(),
            false,
            String::new(),
            CancellationToken::new(),
        );
        client.set_resolved_model("gpt-test".to_string());

        let collaboration_mode = client
            .initial_collaboration_mode()
            .expect("resolved model should build collaboration mode");

        assert_eq!(collaboration_mode.mode, ModeKind::Default);
        assert_eq!(collaboration_mode.settings.model, "gpt-test");
        assert_eq!(
            collaboration_mode.settings.reasoning_effort,
            Some(ProtocolReasoningEffort::XHigh)
        );
    }

    #[test]
    fn turn_start_params_include_explicit_xhigh_effort() {
        let collaboration_mode = CollaborationMode {
            mode: ModeKind::Default,
            settings: Settings {
                model: "gpt-test".to_string(),
                reasoning_effort: Some(ProtocolReasoningEffort::XHigh),
                developer_instructions: None,
            },
        };

        let params = build_turn_start_params(
            "thread_123".to_string(),
            vec![],
            Some(collaboration_mode.clone()),
            Some(ProtocolReasoningEffort::XHigh),
        );

        assert_eq!(params.effort, Some(ProtocolReasoningEffort::XHigh));
        assert_eq!(
            params
                .collaboration_mode
                .as_ref()
                .and_then(|mode| mode.settings.reasoning_effort.clone()),
            Some(ProtocolReasoningEffort::XHigh)
        );
    }

    #[test]
    fn turn_start_params_omit_effort_when_no_override_exists() {
        let params = build_turn_start_params("thread_123".to_string(), vec![], None, None);

        assert_eq!(params.effort, None);
        assert_eq!(params.collaboration_mode, None);
    }

    #[test]
    fn thread_settings_update_params_include_explicit_xhigh_effort() {
        let params = build_thread_settings_update_params(
            "thread_123".to_string(),
            Some(ProtocolReasoningEffort::XHigh),
            None,
        );

        assert_eq!(params.thread_id, "thread_123");
        assert_eq!(params.effort, Some(ProtocolReasoningEffort::XHigh));
        assert_eq!(params.collaboration_mode, None);
    }

    #[test]
    fn live_reasoning_settings_update_sets_effort_in_collaboration_mode() {
        let client = AppServerClient::new(
            LogWriter::new(tokio::io::sink()),
            None,
            false,
            false,
            Some(ProtocolReasoningEffort::High),
            Default::default(),
            false,
            String::new(),
            CancellationToken::new(),
        );
        client.set_resolved_model("gpt-test".to_string());

        let params = client
            .build_reasoning_thread_settings_update_params(
                "thread_123".to_string(),
                Some(ProtocolReasoningEffort::XHigh),
            )
            .expect("resolved model should build settings update");

        assert_eq!(params.effort, Some(ProtocolReasoningEffort::XHigh));
        assert_eq!(
            params.collaboration_mode.as_ref().map(|mode| mode.mode),
            Some(ModeKind::Default)
        );
        assert_eq!(
            params
                .collaboration_mode
                .as_ref()
                .map(|mode| mode.settings.model.as_str()),
            Some("gpt-test")
        );
        assert_eq!(
            params
                .collaboration_mode
                .as_ref()
                .and_then(|mode| mode.settings.reasoning_effort.clone()),
            Some(ProtocolReasoningEffort::XHigh)
        );
    }

    #[test]
    fn live_reasoning_settings_update_can_clear_effort() {
        let client = AppServerClient::new(
            LogWriter::new(tokio::io::sink()),
            None,
            false,
            false,
            Some(ProtocolReasoningEffort::XHigh),
            Default::default(),
            false,
            String::new(),
            CancellationToken::new(),
        );
        client.set_resolved_model("gpt-test".to_string());

        let params = client
            .build_reasoning_thread_settings_update_params("thread_123".to_string(), None)
            .expect("resolved model should build settings update");

        assert_eq!(params.effort, None);
        assert_eq!(
            params.collaboration_mode.as_ref().map(|mode| mode.mode),
            Some(ModeKind::Default)
        );
        assert_eq!(
            params
                .collaboration_mode
                .as_ref()
                .map(|mode| mode.settings.model.as_str()),
            Some("gpt-test")
        );
        assert_eq!(
            params
                .collaboration_mode
                .as_ref()
                .and_then(|mode| mode.settings.reasoning_effort.clone()),
            None
        );
        match reasoning_update_from_thread_settings(&params) {
            ReasoningEffortUpdate::Set(None) => {}
            _ => panic!("clear update should be tracked as an explicit reasoning clear"),
        }
    }

    #[test]
    fn thread_settings_update_params_omit_effort_when_no_override_exists() {
        let params = build_thread_settings_update_params("thread_123".to_string(), None, None);

        assert_eq!(params.effort, None);
        assert_eq!(params.collaboration_mode, None);
    }
}
