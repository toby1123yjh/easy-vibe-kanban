//! Content-free file evidence scoped to one WorkflowRun, not Session history.
//! This projection never inspects file contents or infers a writer from a diff.

use std::{
    collections::BTreeSet,
    path::{Component, Path},
};

use executors::runtime::{AgentEventEnvelope, AgentEventPayload, AgentFileChangeType};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, types::Json};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct WorkflowFileChange {
    /// Project-relative slash-normalized path; downloads resolve current files.
    pub path: String,
    pub change_type: AgentFileChangeType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowFileCollectionStatus {
    Collecting,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowFileChangeSummary {
    /// Observed operations, not a net diff. A path can have multiple kinds.
    pub files: Vec<WorkflowFileChange>,
    pub collection_status: WorkflowFileCollectionStatus,
    /// Stable reason codes. An empty list never proves that no files changed.
    pub reasons: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkflowFileProjectionError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
}

#[derive(FromRow)]
struct RunScope {
    status: String,
    orchestration_run_id: Option<Uuid>,
}

#[derive(FromRow)]
struct Evidence {
    event_id: Uuid,
    agent_run_id: Uuid,
    run_attempt_id: Uuid,
    workspace_path: String,
    event_envelope: Json<AgentEventEnvelope>,
}

pub struct WorkflowFileChanges;

impl WorkflowFileChanges {
    /// Call after project authorization with the run's captured project root.
    /// Projection errors must not alter workflow lifecycle or queue ownership.
    pub async fn project(
        pool: &SqlitePool,
        workflow_run_id: Uuid,
        project_root: &Path,
    ) -> Result<WorkflowFileChangeSummary, WorkflowFileProjectionError> {
        let run = sqlx::query_as::<_, RunScope>(
            "SELECT status, orchestration_run_id FROM workflow_runs WHERE id = ?",
        )
        .bind(workflow_run_id)
        .fetch_one(pool)
        .await?;
        let mut reasons = BTreeSet::from([
            "unobserved_command_script_mcp_or_provider_writes".to_string(),
            "codex_add_and_move_destination_existence_unverified".to_string(),
            "claude_and_pi_file_completion_evidence_unavailable".to_string(),
        ]);
        let root = match tokio::fs::canonicalize(project_root).await {
            Ok(root) if root.is_dir() => root,
            _ => return Self::unavailable(pool, workflow_run_id, "project_root_unavailable").await,
        };
        let root_string = root.to_string_lossy().into_owned();
        sqlx::query("INSERT INTO workflow_file_collections (workflow_run_id, project_root, collection_status) VALUES (?, ?, 'collecting') ON CONFLICT(workflow_run_id) DO NOTHING")
            .bind(workflow_run_id).bind(&root_string).execute(pool).await?;
        sqlx::query("UPDATE workflow_file_collections SET project_root = ? WHERE workflow_run_id = ? AND project_root = ''")
            .bind(&root_string).bind(workflow_run_id).execute(pool).await?;
        let (captured_root, previous_reasons): (String, String) = sqlx::query_as(
            "SELECT project_root, reasons_json FROM workflow_file_collections WHERE workflow_run_id = ?",
        ).bind(workflow_run_id).fetch_one(pool).await?;
        if captured_root != root_string {
            return Self::unavailable(pool, workflow_run_id, "project_root_binding_changed").await;
        }
        reasons.extend(serde_json::from_str::<Vec<String>>(&previous_reasons)?);

        let mut unavailable = false;
        if let Some(orchestration_run_id) = run.orchestration_run_id {
            let degraded: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM orchestration_agent_run_links l JOIN agent_runs ar ON ar.id = l.agent_run_id WHERE l.orchestration_run_id = ? AND ar.projection_status != 'current')",
            ).bind(orchestration_run_id).fetch_one(pool).await?;
            if degraded {
                unavailable = true;
                reasons.insert("agent_event_projection_degraded".to_string());
            }
            // Bound each DB read. Consumed event identities, not a Session time
            // window, make replay safe and allow late-linked events to be seen.
            loop {
                let events = sqlx::query_as::<_, Evidence>(
                    "SELECT e.event_id, e.agent_run_id, e.run_attempt_id, ar.workspace_path, e.event_envelope
                     FROM orchestration_agent_run_links l
                     JOIN agent_runs ar ON ar.id = l.agent_run_id
                     JOIN agent_events e ON e.agent_run_id = ar.id
                     WHERE l.orchestration_run_id = ?
                       AND json_extract(e.event_envelope, '$.payload.type') = 'file_changes'
                       AND NOT EXISTS (SELECT 1 FROM workflow_file_evidence_events p WHERE p.workflow_run_id = ? AND p.event_id = e.event_id)
                     ORDER BY e.rowid LIMIT 500",
                ).bind(orchestration_run_id).bind(workflow_run_id).fetch_all(pool).await?;
                if events.is_empty() {
                    break;
                }
                for row in events {
                    let event = &row.event_envelope.0;
                    let mut changes = Vec::new();
                    let identity_valid = event.event_id == row.event_id
                        && event.agent_run_id == row.agent_run_id
                        && event.run_attempt_id == row.run_attempt_id
                        && event.validate_for_projection().is_ok()
                        && !event.native_refs.is_empty();
                    if identity_valid {
                        if let AgentEventPayload::FileChanges {
                            changes: native_changes,
                            ..
                        } = &event.payload
                        {
                            for change in native_changes {
                                match relative_evidence_path(
                                    &root,
                                    Path::new(&row.workspace_path),
                                    &change.path,
                                )
                                .await
                                {
                                    Some(path) => changes.push((path, change.change_type)),
                                    None => {
                                        reasons.insert(
                                            "file_path_outside_project_or_unverifiable".to_string(),
                                        );
                                    }
                                }
                            }
                        }
                    } else {
                        reasons.insert("invalid_or_unaudited_file_evidence".to_string());
                    }
                    let mut tx = pool.begin().await?;
                    let inserted = sqlx::query("INSERT INTO workflow_file_evidence_events (workflow_run_id, event_id, agent_run_id) VALUES (?, ?, ?) ON CONFLICT(workflow_run_id, event_id) DO NOTHING")
                        .bind(workflow_run_id).bind(row.event_id).bind(row.agent_run_id).execute(&mut *tx).await?.rows_affected();
                    if inserted != 0 {
                        for (path, change_type) in changes {
                            let kind = match change_type {
                                AgentFileChangeType::Added => "added",
                                AgentFileChangeType::Modified => "modified",
                                AgentFileChangeType::Deleted => "deleted",
                            };
                            sqlx::query("INSERT INTO workflow_file_changes (workflow_run_id, event_id, path, change_type) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
                                .bind(workflow_run_id).bind(row.event_id).bind(path).bind(kind).execute(&mut *tx).await?;
                        }
                    }
                    tx.commit().await?;
                }
            }
        }
        let status = if unavailable {
            WorkflowFileCollectionStatus::Unavailable
        } else if matches!(run.status.as_str(), "succeeded" | "failed" | "canceled") {
            WorkflowFileCollectionStatus::Partial
        } else {
            WorkflowFileCollectionStatus::Collecting
        };
        let summary =
            Self::read(pool, workflow_run_id, status, reasons.into_iter().collect()).await?;
        Self::persist_status(pool, workflow_run_id, &summary).await?;
        Ok(summary)
    }

    /// Best-effort fallback for callers: retain already confirmed operations.
    /// The caller may return this independently of a successful run status.
    pub async fn unavailable(
        pool: &SqlitePool,
        workflow_run_id: Uuid,
        reason: &str,
    ) -> Result<WorkflowFileChangeSummary, WorkflowFileProjectionError> {
        sqlx::query("INSERT INTO workflow_file_collections (workflow_run_id, project_root, collection_status) VALUES (?, '', 'unavailable') ON CONFLICT(workflow_run_id) DO NOTHING")
            .bind(workflow_run_id).execute(pool).await?;
        let previous_reasons: String = sqlx::query_scalar(
            "SELECT reasons_json FROM workflow_file_collections WHERE workflow_run_id = ?",
        )
        .bind(workflow_run_id)
        .fetch_one(pool)
        .await?;
        let mut reasons = serde_json::from_str::<BTreeSet<String>>(&previous_reasons)?;
        reasons.insert(reason.to_string());
        let summary = Self::read(
            pool,
            workflow_run_id,
            WorkflowFileCollectionStatus::Unavailable,
            reasons.into_iter().collect(),
        )
        .await?;
        Self::persist_status(pool, workflow_run_id, &summary).await?;
        Ok(summary)
    }

    async fn read(
        pool: &SqlitePool,
        run_id: Uuid,
        status: WorkflowFileCollectionStatus,
        reasons: Vec<String>,
    ) -> Result<WorkflowFileChangeSummary, WorkflowFileProjectionError> {
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT DISTINCT path, change_type FROM workflow_file_changes WHERE workflow_run_id = ? ORDER BY path, change_type")
            .bind(run_id).fetch_all(pool).await?;
        let files = rows
            .into_iter()
            .map(|(path, kind)| {
                Ok(WorkflowFileChange {
                    path,
                    change_type: serde_json::from_value(serde_json::Value::String(kind))?,
                })
            })
            .collect::<Result<Vec<_>, serde_json::Error>>()?;
        Ok(WorkflowFileChangeSummary {
            files,
            collection_status: status,
            reasons,
        })
    }

    async fn persist_status(
        pool: &SqlitePool,
        run_id: Uuid,
        summary: &WorkflowFileChangeSummary,
    ) -> Result<(), WorkflowFileProjectionError> {
        let status = match summary.collection_status {
            WorkflowFileCollectionStatus::Collecting => "collecting",
            WorkflowFileCollectionStatus::Partial => "partial",
            WorkflowFileCollectionStatus::Unavailable => "unavailable",
        };
        sqlx::query("UPDATE workflow_file_collections SET collection_status = ?, reasons_json = ?, updated_at = datetime('now', 'subsec') WHERE workflow_run_id = ?")
            .bind(status).bind(serde_json::to_string(&summary.reasons)?).bind(run_id).execute(pool).await?;
        Ok(())
    }
}

/// Also works after deletion: canonicalize the nearest surviving ancestor.
/// No file bytes are opened. A missing/unverifiable path is omitted, never used
/// to widen the project root or infer that the file was deleted by the Agent.
async fn relative_evidence_path(root: &Path, cwd: &Path, native: &str) -> Option<String> {
    if native.is_empty() || native.contains('\0') {
        return None;
    }
    let normalized = native.replace('\\', "/");
    if normalized.split('/').any(|part| part == "..") {
        return None;
    }
    let path = Path::new(&normalized);
    if !path.is_absolute() && normalized.contains(':') {
        return None;
    }
    let target = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    if !target.is_absolute() {
        return None;
    }
    // Evidence may be queried after a human replaces a path with a symlink or
    // junction. Resolving it now must not attribute the Agent's old operation
    // to the replacement target. Without operation-time link identity, omit
    // such evidence conservatively (the collection is explicitly partial).
    for component in target.ancestors() {
        match tokio::fs::symlink_metadata(component).await {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return None;
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
                    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                        return None;
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return None,
        }
        if component == root {
            break;
        }
    }
    let mut ancestor = target.as_path();
    let mut missing = Vec::new();
    let canonical = loop {
        match tokio::fs::symlink_metadata(ancestor).await {
            Ok(_) => break tokio::fs::canonicalize(ancestor).await.ok()?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(ancestor.file_name()?.to_owned());
                ancestor = ancestor.parent()?;
            }
            Err(_) => return None,
        }
    };
    let mut resolved = canonical;
    for component in missing.into_iter().rev() {
        resolved.push(component);
    }
    let relative = resolved.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(relative.to_str()?.replace('\\', "/"))
}

#[cfg(test)]
mod tests;
