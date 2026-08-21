use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

use agent_client_protocol::{self as acp};
use async_trait::async_trait;
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use workspace_utils::approvals::ApprovalStatus;

use crate::{
    approvals::{ExecutorApprovalError, ExecutorApprovalService},
    executors::acp::{AcpEvent, ApprovalResponse},
};

/// ACP client that handles agent-client protocol communication
#[derive(Clone)]
pub struct AcpClient {
    event_tx: mpsc::UnboundedSender<AcpEvent>,
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
    feedback_queue: Arc<Mutex<Vec<String>>>,
    cancel: CancellationToken,
    events_enabled: Arc<AtomicBool>,
    suppressed_events: Arc<AtomicU64>,
}

impl AcpClient {
    /// Create a new ACP client
    pub fn new(
        event_tx: mpsc::UnboundedSender<AcpEvent>,
        approvals: Option<Arc<dyn ExecutorApprovalService>>,
        cancel: CancellationToken,
    ) -> Self {
        Self {
            event_tx,
            approvals,
            feedback_queue: Arc::new(Mutex::new(Vec::new())),
            cancel,
            events_enabled: Arc::new(AtomicBool::new(true)),
            suppressed_events: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn record_user_prompt_event(&self, prompt: &str) {
        self.send_event(AcpEvent::User(prompt.to_string()));
    }

    /// Suppress provider events while an ACP native session replays its
    /// historical transcript. Suppressed events are counted so the harness can
    /// wait for a quiet replay boundary before forwarding the VK prompt.
    pub fn suppress_events(&self) {
        self.events_enabled.store(false, Ordering::Release);
    }

    pub fn suppressed_event_count(&self) -> u64 {
        self.suppressed_events.load(Ordering::Acquire)
    }

    /// Open the canonical event stream and record the first VK-owned prompt as
    /// one ordered operation. Native history is never emitted as VK events.
    pub fn enable_events_and_record_user_prompt(&self, prompt: &str) {
        self.events_enabled.store(true, Ordering::Release);
        self.record_user_prompt_event(prompt);
    }

    /// Send an event to the event channel
    fn send_event(&self, event: AcpEvent) {
        if !self.events_enabled.load(Ordering::Acquire) {
            self.suppressed_events.fetch_add(1, Ordering::Relaxed);
            return;
        }
        if let Err(e) = self.event_tx.send(event) {
            warn!("Failed to send ACP event: {}", e);
        }
    }

    /// Queue a user feedback message to be sent after a denial.
    pub async fn enqueue_feedback(&self, message: String) {
        let trimmed = message.trim().to_string();
        if !trimmed.is_empty() {
            let mut q = self.feedback_queue.lock().await;
            q.push(trimmed);
        }
    }

    /// Drain and return queued feedback messages.
    pub async fn drain_feedback(&self) -> Vec<String> {
        let mut q = self.feedback_queue.lock().await;
        q.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executors::acp::AcpEvent;

    #[tokio::test]
    async fn native_replay_gate_drops_events_until_enabled() {
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let client = AcpClient::new(event_tx, None, CancellationToken::new());

        client.suppress_events();
        client.record_user_prompt_event("adoption prompt");
        assert_eq!(client.suppressed_event_count(), 1);
        assert!(event_rx.try_recv().is_err());

        client.enable_events_and_record_user_prompt("adoption prompt");
        assert!(
            matches!(event_rx.recv().await, Some(AcpEvent::User(prompt)) if prompt == "adoption prompt")
        );
    }
}

#[async_trait(?Send)]
impl acp::Client for AcpClient {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> Result<acp::RequestPermissionResponse, acp::Error> {
        self.send_event(AcpEvent::RequestPermission(args.clone()));

        if self.approvals.is_none() {
            // Auto-approve with best available option when no approval service is configured
            let chosen_option = args
                .options
                .iter()
                .find(|o| matches!(o.kind, acp::PermissionOptionKind::AllowAlways))
                .or_else(|| {
                    args.options
                        .iter()
                        .find(|o| matches!(o.kind, acp::PermissionOptionKind::AllowOnce))
                })
                .or_else(|| args.options.first());

            let outcome = if let Some(opt) = chosen_option {
                debug!("Auto-approving permission with option: {}", opt.option_id);
                acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                    opt.option_id.clone(),
                ))
            } else {
                warn!("No permission options available, cancelling");
                acp::RequestPermissionOutcome::Cancelled
            };

            return Ok(acp::RequestPermissionResponse::new(outcome));
        }

        let tool_call_id = args.tool_call.tool_call_id.0.to_string();
        let tool_name = args.tool_call.fields.title.as_deref().unwrap_or("tool");
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)
            .map_err(|_| acp::Error::invalid_request())?;

        let approval_id = match approval_service.create_tool_approval(tool_name).await {
            Ok(id) => id,
            Err(err) => return self.handle_approval_error(err, &tool_call_id),
        };

        self.send_event(AcpEvent::ApprovalRequested {
            tool_call_id: tool_call_id.clone(),
            approval_id: approval_id.clone(),
        });

        let status = match approval_service
            .wait_tool_approval(&approval_id, self.cancel.clone())
            .await
        {
            Ok(s) => s,
            Err(err) => return self.handle_approval_error(err, &tool_call_id),
        };

        // Map our ApprovalStatus to ACP outcome
        let outcome = match &status {
            ApprovalStatus::Approved => {
                let chosen = args
                    .options
                    .iter()
                    .find(|o| matches!(o.kind, acp::PermissionOptionKind::AllowOnce));
                if let Some(opt) = chosen {
                    acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                        opt.option_id.clone(),
                    ))
                } else {
                    tracing::error!("No suitable approval option found, cancelling");
                    return Err(acp::Error::invalid_request());
                }
            }
            ApprovalStatus::Denied { reason } => {
                // If user provided a reason, queue it to send after denial
                if let Some(feedback) = reason.as_ref() {
                    self.enqueue_feedback(feedback.clone()).await;
                }
                let chosen = args
                    .options
                    .iter()
                    .find(|o| matches!(o.kind, acp::PermissionOptionKind::RejectOnce));
                if let Some(opt) = chosen {
                    acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                        opt.option_id.clone(),
                    ))
                } else {
                    warn!("No permission options for denial, cancelling");
                    acp::RequestPermissionOutcome::Cancelled
                }
            }
            ApprovalStatus::TimedOut => {
                warn!("Approval timed out");
                acp::RequestPermissionOutcome::Cancelled
            }
            ApprovalStatus::Pending => {
                // This should not occur after waiter resolves
                warn!("Approval resolved to Pending");
                acp::RequestPermissionOutcome::Cancelled
            }
        };

        self.send_event(AcpEvent::ApprovalResponse(ApprovalResponse {
            tool_call_id: tool_call_id.clone(),
            status: status.clone(),
        }));

        Ok(acp::RequestPermissionResponse::new(outcome))
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> Result<(), acp::Error> {
        // Convert to typed events
        let event = match args.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => Some(AcpEvent::Message(chunk.content)),
            acp::SessionUpdate::AgentThoughtChunk(chunk) => Some(AcpEvent::Thought(chunk.content)),
            acp::SessionUpdate::ToolCall(tc) => Some(AcpEvent::ToolCall(tc)),
            acp::SessionUpdate::ToolCallUpdate(update) => Some(AcpEvent::ToolUpdate(update)),
            acp::SessionUpdate::Plan(plan) => Some(AcpEvent::Plan(plan)),
            _ => Some(AcpEvent::Other(args)),
        };

        if let Some(event) = event {
            self.send_event(event);
        }

        Ok(())
    }

    // File system operations - not implemented as we don't expose FS
    async fn write_text_file(
        &self,
        _args: acp::WriteTextFileRequest,
    ) -> Result<acp::WriteTextFileResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    async fn read_text_file(
        &self,
        _args: acp::ReadTextFileRequest,
    ) -> Result<acp::ReadTextFileResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    // Terminal operations - not implemented
    async fn create_terminal(
        &self,
        _args: acp::CreateTerminalRequest,
    ) -> Result<acp::CreateTerminalResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    async fn terminal_output(
        &self,
        _args: acp::TerminalOutputRequest,
    ) -> Result<acp::TerminalOutputResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    async fn release_terminal(
        &self,
        _args: acp::ReleaseTerminalRequest,
    ) -> Result<acp::ReleaseTerminalResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    async fn wait_for_terminal_exit(
        &self,
        _args: acp::WaitForTerminalExitRequest,
    ) -> Result<acp::WaitForTerminalExitResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    async fn kill_terminal_command(
        &self,
        _args: acp::KillTerminalCommandRequest,
    ) -> Result<acp::KillTerminalCommandResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    // Extension methods
    async fn ext_method(&self, _args: acp::ExtRequest) -> Result<acp::ExtResponse, acp::Error> {
        Err(acp::Error::method_not_found())
    }

    async fn ext_notification(&self, _args: acp::ExtNotification) -> Result<(), acp::Error> {
        Ok(())
    }
}

impl AcpClient {
    fn handle_approval_error(
        &self,
        err: ExecutorApprovalError,
        tool_call_id: &str,
    ) -> Result<acp::RequestPermissionResponse, acp::Error> {
        if let ExecutorApprovalError::Cancelled = err {
            debug!("ACP approval cancelled for tool_call_id={}", tool_call_id);
            Ok(acp::RequestPermissionResponse::new(
                acp::RequestPermissionOutcome::Cancelled,
            ))
        } else {
            tracing::error!(
                "ACP approval wait failed for tool_call_id={}: {err}",
                tool_call_id
            );
            self.send_event(AcpEvent::ApprovalResponse(ApprovalResponse {
                tool_call_id: tool_call_id.to_string(),
                status: ApprovalStatus::TimedOut,
            }));
            Err(acp::Error::internal_error())
        }
    }
}
