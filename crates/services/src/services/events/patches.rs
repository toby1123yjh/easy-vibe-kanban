use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessView},
    scratch::Scratch,
    workspace::WorkspaceWithStatus,
};
use json_patch::{AddOperation, Patch, PatchOperation, RemoveOperation, ReplaceOperation};
use uuid::Uuid;

// Shared helper to escape JSON Pointer segments
fn escape_pointer_segment(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

/// Helper functions for creating execution process-specific patches
pub mod execution_process_patch {
    use super::*;

    fn execution_process_path(process_id: Uuid) -> String {
        format!(
            "/execution_processes/{}",
            escape_pointer_segment(&process_id.to_string())
        )
    }

    /// Create patch for adding a new execution process
    pub fn add(process: &ExecutionProcess) -> Patch {
        Patch(vec![PatchOperation::Add(AddOperation {
            path: execution_process_path(process.id)
                .try_into()
                .expect("Execution process path should be valid"),
            value: serde_json::to_value(ExecutionProcessView::from_process(process.clone()))
                .expect("Execution process serialization should not fail"),
        })])
    }

    /// Create patch for updating an existing execution process
    pub fn replace(process: &ExecutionProcess) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: execution_process_path(process.id)
                .try_into()
                .expect("Execution process path should be valid"),
            value: serde_json::to_value(ExecutionProcessView::from_process(process.clone()))
                .expect("Execution process serialization should not fail"),
        })])
    }

    /// Create patch for removing an execution process
    pub fn remove(process_id: Uuid) -> Patch {
        Patch(vec![PatchOperation::Remove(RemoveOperation {
            path: execution_process_path(process_id)
                .try_into()
                .expect("Execution process path should be valid"),
        })])
    }
}

/// Helper functions for creating workspace-specific patches
pub mod workspace_patch {
    use super::*;

    fn workspace_path(workspace_id: Uuid) -> String {
        format!(
            "/workspaces/{}",
            escape_pointer_segment(&workspace_id.to_string())
        )
    }

    pub fn add(workspace: &WorkspaceWithStatus) -> Patch {
        Patch(vec![PatchOperation::Add(AddOperation {
            path: workspace_path(workspace.id)
                .try_into()
                .expect("Workspace path should be valid"),
            value: serde_json::to_value(workspace)
                .expect("Workspace serialization should not fail"),
        })])
    }

    pub fn replace(workspace: &WorkspaceWithStatus) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: workspace_path(workspace.id)
                .try_into()
                .expect("Workspace path should be valid"),
            value: serde_json::to_value(workspace)
                .expect("Workspace serialization should not fail"),
        })])
    }

    pub fn remove(workspace_id: Uuid) -> Patch {
        Patch(vec![PatchOperation::Remove(RemoveOperation {
            path: workspace_path(workspace_id)
                .try_into()
                .expect("Workspace path should be valid"),
        })])
    }
}

/// Helper functions for creating scratch-specific patches.
/// All patches use path "/scratch" - filtering is done by matching id and payload type in the value.
pub mod scratch_patch {
    use super::*;

    const SCRATCH_PATH: &str = "/scratch";

    /// Create patch for adding a new scratch
    pub fn add(scratch: &Scratch) -> Patch {
        Patch(vec![PatchOperation::Add(AddOperation {
            path: SCRATCH_PATH
                .try_into()
                .expect("Scratch path should be valid"),
            value: serde_json::to_value(scratch).expect("Scratch serialization should not fail"),
        })])
    }

    /// Create patch for updating an existing scratch
    pub fn replace(scratch: &Scratch) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: SCRATCH_PATH
                .try_into()
                .expect("Scratch path should be valid"),
            value: serde_json::to_value(scratch).expect("Scratch serialization should not fail"),
        })])
    }

    /// Create patch for removing a scratch.
    /// Uses Replace with deleted marker so clients can filter by id and payload type.
    pub fn remove(scratch_id: Uuid, scratch_type_str: &str) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: SCRATCH_PATH
                .try_into()
                .expect("Scratch path should be valid"),
            value: serde_json::json!({
                "id": scratch_id,
                "payload": { "type": scratch_type_str },
                "deleted": true
            }),
        })])
    }
}

/// Helper functions for creating approval-specific patches.
pub mod approvals_patch {
    use super::*;

    const PENDING_PATH: &str = "/pending";

    fn pending_path(approval_id: &str) -> String {
        format!("{}/{}", PENDING_PATH, escape_pointer_segment(approval_id))
    }

    pub fn snapshot(pending: &[crate::services::approvals::ApprovalInfo]) -> Patch {
        let pending: serde_json::Map<String, serde_json::Value> = pending
            .iter()
            .map(|info| {
                (
                    info.approval_id.clone(),
                    serde_json::to_value(info).unwrap_or(serde_json::Value::Null),
                )
            })
            .collect();

        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: PENDING_PATH
                .try_into()
                .expect("Pending approvals path should be valid"),
            value: serde_json::Value::Object(pending),
        })])
    }

    pub fn created(info: &crate::services::approvals::ApprovalInfo) -> Patch {
        let value = serde_json::to_value(info).unwrap_or(serde_json::Value::Null);
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: pending_path(&info.approval_id)
                .try_into()
                .expect("Approval path should be valid"),
            value,
        })])
    }

    pub fn resolved(approval_id: &str) -> Patch {
        Patch(vec![PatchOperation::Remove(RemoveOperation {
            path: pending_path(approval_id)
                .try_into()
                .expect("Approval path should be valid"),
        })])
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::execution_process::{
        ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus, ExecutorActionField,
    };
    use executors::actions::{
        ExecutorAction, ExecutorActionType,
        script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
    };
    use json_patch::PatchOperation;
    use uuid::Uuid;

    use super::execution_process_patch;

    fn script_process(status: ExecutionProcessStatus) -> ExecutionProcess {
        let now = Utc::now();

        ExecutionProcess {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            run_reason: ExecutionProcessRunReason::SetupScript,
            executor_action: sqlx::types::Json(ExecutorActionField::ExecutorAction(
                ExecutorAction::new(
                    ExecutorActionType::ScriptRequest(ScriptRequest {
                        script: "echo test".to_string(),
                        language: ScriptRequestLanguage::Bash,
                        context: ScriptContext::SetupScript,
                        working_dir: None,
                    }),
                    None,
                ),
            )),
            status,
            exit_code: None,
            dropped: false,
            started_at: now,
            completed_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn execution_process_patch_serializes_script_process() {
        let process = script_process(ExecutionProcessStatus::Running);
        let patch = execution_process_patch::add(&process);

        let PatchOperation::Add(op) = &patch.0[0] else {
            panic!("expected add operation");
        };

        assert_eq!(op.value["run_reason"], "setupscript");
        assert!(op.value.get("agent_runtime_lifecycle").is_none());
        assert!(op.value.get("agent_runtime_error").is_none());
    }
}
