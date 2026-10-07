//! Provider file evidence is decoded once, at the native adapter boundary.
//! Tool intent, success text, shell/MCP results and directory observations are
//! deliberately insufficient. Unsupported providers keep their ordinary events
//! and the workflow projection explicitly reports incomplete coverage.

use codex_app_server_protocol::{PatchApplyStatus, PatchChangeKind, ThreadItem};
use serde_json::Value;

use super::DirectProvider;
use crate::runtime::{AgentEventPayload, AgentFileChange, AgentFileChangeType, ProviderEvent};

pub(super) fn completed_file_changes(
    provider: DirectProvider,
    event: &ProviderEvent,
) -> Option<AgentEventPayload> {
    if event.direction != crate::runtime::NativeAuditDirection::Output {
        return None;
    }
    let payload = event.payload_json.as_ref()?;
    match provider {
        DirectProvider::Gemini => return gemini_completed_file_changes(payload),
        DirectProvider::Codex => {}
        DirectProvider::ClaudeCode
        | DirectProvider::OhMyPi
        | DirectProvider::Opencode
        | DirectProvider::DeepseekHarness => return None,
    }
    if payload.get("method").and_then(Value::as_str) != Some("item/completed") {
        return None;
    }
    // Use the pinned protocol types, not loosely named "file" properties from
    // arbitrary tools. The diff exists in the original audit only; drop it here.
    let ThreadItem::FileChange {
        id,
        changes,
        status,
    } = serde_json::from_value(payload.get("params")?.get("item")?.clone()).ok()?
    else {
        return None;
    };
    if status != PatchApplyStatus::Completed || id.is_empty() {
        // Failed patches can have partial writes, but this protocol supplies no
        // per-file success proof for them. Do not report all intended changes.
        return None;
    }
    let changes = changes
        .into_iter()
        .filter_map(|change| {
            let change_type = match change.kind {
                // Codex AddFile can also overwrite an existing file. Its
                // app-server kind omits AppliedPatchFileChange.overwritten_content,
                // so it proves a write but not the required added/modified kind.
                PatchChangeKind::Add => return None,
                PatchChangeKind::Delete => AgentFileChangeType::Deleted,
                PatchChangeKind::Update { move_path: None } => AgentFileChangeType::Modified,
                // A move may overwrite a destination. Without prior existence
                // evidence its added/modified classification is not known.
                PatchChangeKind::Update { move_path: Some(_) } => return None,
            };
            Some(AgentFileChange {
                path: change.path,
                change_type,
            })
        })
        .collect::<Vec<_>>();
    (!changes.is_empty()).then_some(AgentEventPayload::FileChanges {
        tool_call_id: id,
        changes,
    })
}

fn gemini_completed_file_changes(payload: &Value) -> Option<AgentEventPayload> {
    use agent_client_protocol::{
        SessionNotification, SessionUpdate, ToolCallContent, ToolCallStatus, ToolKind,
    };

    use crate::executors::acp::AcpEvent;

    // Support both the native ACP notification and the typed ACP harness
    // representation emitted to the audited stream. Never infer from locations
    // alone: a location can refer to a read or a proposed edit.
    let event = if payload.get("method").and_then(Value::as_str) == Some("session/update") {
        let notification: SessionNotification =
            serde_json::from_value(payload.get("params")?.clone()).ok()?;
        match notification.update {
            SessionUpdate::ToolCall(call) => AcpEvent::ToolCall(call),
            SessionUpdate::ToolCallUpdate(update) => AcpEvent::ToolUpdate(update),
            _ => return None,
        }
    } else {
        serde_json::from_value::<AcpEvent>(payload.clone()).ok()?
    };
    let (id, kind, status, content) = match event {
        AcpEvent::ToolCall(call) => (call.tool_call_id, call.kind, call.status, call.content),
        AcpEvent::ToolUpdate(update) => (
            update.tool_call_id,
            update.fields.kind?,
            update.fields.status?,
            update.fields.content?,
        ),
        _ => return None,
    };
    if kind != ToolKind::Edit || status != ToolCallStatus::Completed || id.0.is_empty() {
        return None;
    }
    let changes = content
        .into_iter()
        .filter_map(|content| {
            let ToolCallContent::Diff(diff) = content else {
                return None;
            };
            // ACP explicitly defines None as a new file. Some("") is an existing
            // empty file, not an addition. Empty new_text is not proof of deletion.
            Some(AgentFileChange {
                path: diff.path.to_str()?.to_string(),
                change_type: if diff.old_text.is_none() {
                    AgentFileChangeType::Added
                } else {
                    AgentFileChangeType::Modified
                },
            })
        })
        .collect::<Vec<_>>();
    (!changes.is_empty()).then_some(AgentEventPayload::FileChanges {
        tool_call_id: id.0.to_string(),
        changes,
    })
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::runtime::{NativeAuditChannel, NativeAuditDirection, NativeAuditFrame};

    fn decode(provider: DirectProvider, payload: Value) -> Option<AgentEventPayload> {
        decode_direction(provider, payload, NativeAuditDirection::Output)
    }

    fn decode_direction(
        provider: DirectProvider,
        payload: Value,
        direction: NativeAuditDirection,
    ) -> Option<AgentEventPayload> {
        // Exercise the real adapter/frame path, not the extraction function alone.
        let frame = NativeAuditFrame::from_bytes(
            1,
            Utc::now(),
            direction,
            NativeAuditChannel::Stdout,
            "application/json",
            Uuid::new_v4(),
            &serde_json::to_vec(&payload).unwrap(),
            None,
        );
        let decoded = provider.decode_native_frame(&frame).unwrap();
        let manifest = super::super::fixture_manifest(provider);
        let mapped = provider.map_provider_event(&decoded, &manifest).unwrap();
        mapped
            .into_iter()
            .map(|event| event.payload)
            .find(|payload| matches!(payload, AgentEventPayload::FileChanges { .. }))
    }

    fn patch(status: &str) -> Value {
        json!({"method":"item/completed", "params":{"item":{
            "type":"fileChange", "id":"patch-1", "status":status,
            "changes":[
                {"path":"notes/new.txt", "kind":{"type":"add"}, "diff":"private content"},
                {"path":"notes/edit.txt", "kind":{"type":"update", "move_path":null}, "diff":"private diff"},
                {"path":"notes/old.txt", "kind":{"type":"delete"}, "diff":"private old content"}
            ]
        }}})
    }

    #[test]
    fn completed_codex_patch_keeps_only_paths_and_kinds() {
        let payload = decode(DirectProvider::Codex, patch("completed")).unwrap();
        let AgentEventPayload::FileChanges { changes, .. } = &payload else {
            panic!()
        };
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].change_type, AgentFileChangeType::Modified);
        assert_eq!(changes[1].change_type, AgentFileChangeType::Deleted);
        assert!(changes.iter().all(|change| change.path != "notes/new.txt"));
        let serialized = serde_json::to_string(&payload).unwrap();
        assert!(!serialized.contains("private"));
        assert!(!serialized.contains("diff"));
    }

    #[test]
    fn failed_declined_and_started_patches_are_not_successful_writes() {
        for status in ["failed", "declined", "inProgress"] {
            assert!(decode(DirectProvider::Codex, patch(status)).is_none());
        }
        let mut started = patch("completed");
        started["method"] = json!("item/started");
        assert!(decode(DirectProvider::Codex, started).is_none());
        assert!(
            decode_direction(
                DirectProvider::Codex,
                patch("completed"),
                NativeAuditDirection::Input
            )
            .is_none()
        );
    }

    #[test]
    fn other_providers_and_generic_tool_success_are_not_file_evidence() {
        for provider in DirectProvider::ALL {
            assert!(decode(provider, json!({"type":"tool_result", "name":"Write", "id":"1", "result":{"path":"x.txt","success":true}})).is_none());
            if provider != DirectProvider::Codex {
                assert!(decode(provider, patch("completed")).is_none());
            }
        }
    }

    #[test]
    fn rename_does_not_guess_whether_destination_existed() {
        let mut moved = patch("completed");
        moved["params"]["item"]["changes"] = json!([
            {"path":"old.txt","kind":{"type":"update","move_path":"new.txt"},"diff":""}
        ]);
        assert!(decode(DirectProvider::Codex, moved).is_none());
    }

    #[test]
    fn gemini_completed_acp_diff_distinguishes_new_from_empty_existing_file() {
        let payload = json!({"ToolUpdate": {
            "toolCallId":"edit-1", "kind":"edit", "status":"completed",
            "content":[
                {"type":"diff","path":"new.txt","oldText":null,"newText":"new"},
                {"type":"diff","path":"empty.txt","oldText":"","newText":"changed"},
                {"type":"diff","path":"cleared.txt","oldText":"old","newText":""}
            ]
        }});
        let AgentEventPayload::FileChanges { changes, .. } =
            decode(DirectProvider::Gemini, payload.clone()).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            changes
                .iter()
                .map(|change| change.change_type)
                .collect::<Vec<_>>(),
            [
                AgentFileChangeType::Added,
                AgentFileChangeType::Modified,
                AgentFileChangeType::Modified
            ]
        );
        for status in ["pending", "in_progress", "failed"] {
            let mut pending = payload.clone();
            pending["ToolUpdate"]["status"] = json!(status);
            assert!(decode(DirectProvider::Gemini, pending).is_none());
        }
        // A completion without accompanying file-operation metadata does not
        // promote a previous request/diff proposal to a confirmed write.
        assert!(
            decode(
                DirectProvider::Gemini,
                json!({"ToolUpdate":{"toolCallId":"edit-1","status":"completed"}})
            )
            .is_none()
        );
    }

    #[test]
    fn gemini_native_notification_requires_completed_edit_metadata() {
        let native = json!({
            "jsonrpc":"2.0", "method":"session/update",
            "params": {"sessionId":"gemini-session", "update": {
                "sessionUpdate":"tool_call_update", "toolCallId":"edit-2",
                "kind":"edit", "status":"completed", "content":[
                    {"type":"diff", "path":"report.txt", "oldText":null, "newText":"private content"}
                ]
            }}
        });
        let evidence = decode(DirectProvider::Gemini, native.clone()).unwrap();
        let AgentEventPayload::FileChanges { changes, .. } = &evidence else {
            panic!()
        };
        assert_eq!(changes[0].path, "report.txt");
        assert_eq!(changes[0].change_type, AgentFileChangeType::Added);
        assert!(
            !serde_json::to_string(&evidence)
                .unwrap()
                .contains("private content")
        );
        assert!(
            decode_direction(
                DirectProvider::Gemini,
                native.clone(),
                NativeAuditDirection::Input
            )
            .is_none()
        );
        let mut read = native.clone();
        read["params"]["update"]["kind"] = json!("read");
        assert!(decode(DirectProvider::Gemini, read).is_none());
        let mut unclassified = native;
        unclassified["params"]["update"]
            .as_object_mut()
            .unwrap()
            .remove("kind");
        assert!(decode(DirectProvider::Gemini, unclassified).is_none());
    }
}
