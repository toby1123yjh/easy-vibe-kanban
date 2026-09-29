use std::path::PathBuf;

use chrono::Utc;
use executors::runtime::{
    AGENT_EVENT_PAYLOAD_VERSION, AGENT_EVENT_SCHEMA_VERSION, AgentFileChange, NativeAuditReference,
};
use sqlx::sqlite::SqlitePoolOptions;

use super::*;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("vk-file-evidence-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self(std::fs::canonicalize(root).unwrap())
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        // This directory was allocated exclusively by this test fixture.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE workflow_runs (id BLOB PRIMARY KEY, orchestration_run_id BLOB, status TEXT NOT NULL);
         CREATE TABLE agent_runs (id BLOB PRIMARY KEY, workspace_path TEXT NOT NULL, projection_status TEXT NOT NULL DEFAULT 'current');
         CREATE TABLE agent_events (event_id BLOB PRIMARY KEY, agent_run_id BLOB NOT NULL, run_attempt_id BLOB NOT NULL, event_envelope TEXT NOT NULL, UNIQUE(event_id, agent_run_id));
         CREATE TABLE orchestration_agent_run_links (orchestration_run_id BLOB NOT NULL, agent_run_id BLOB NOT NULL, UNIQUE(orchestration_run_id, agent_run_id));",
    ).execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20260929000300_workflow_file_changes.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    pool
}

async fn run(pool: &SqlitePool, root: &Path, status: &str) -> (Uuid, Uuid) {
    let workflow = Uuid::new_v4();
    let orchestration = Uuid::new_v4();
    let agent = Uuid::new_v4();
    sqlx::query("INSERT INTO workflow_runs VALUES (?, ?, ?)")
        .bind(workflow)
        .bind(orchestration)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO agent_runs (id, workspace_path) VALUES (?, ?)")
        .bind(agent)
        .bind(root.to_str().unwrap())
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO orchestration_agent_run_links VALUES (?, ?)")
        .bind(orchestration)
        .bind(agent)
        .execute(pool)
        .await
        .unwrap();
    (workflow, agent)
}

async fn evidence(
    pool: &SqlitePool,
    agent: Uuid,
    session: Uuid,
    path: &str,
    change_type: AgentFileChangeType,
) -> Uuid {
    let event = AgentEventEnvelope {
        schema_version: AGENT_EVENT_SCHEMA_VERSION,
        payload_version: AGENT_EVENT_PAYLOAD_VERSION,
        event_id: Uuid::new_v4(),
        session_id: session,
        agent_run_id: agent,
        turn_id: Uuid::new_v4(),
        run_attempt_id: Uuid::new_v4(),
        run_attempt_number: 1,
        sequence: 1,
        correlation_id: Uuid::new_v4(),
        orchestration_run_id: None,
        orchestration_node_execution_id: None,
        timestamp: Utc::now(),
        native_refs: vec![NativeAuditReference {
            stream_id: Uuid::new_v4(),
            sequence: 1,
            checksum: Some("checksum".to_string()),
        }],
        payload: AgentEventPayload::FileChanges {
            tool_call_id: "tool".to_string(),
            changes: vec![AgentFileChange {
                path: path.to_string(),
                change_type,
            }],
        },
    };
    sqlx::query("INSERT INTO agent_events VALUES (?, ?, ?, ?)")
        .bind(event.event_id)
        .bind(agent)
        .bind(event.run_attempt_id)
        .bind(Json(&event))
        .execute(pool)
        .await
        .unwrap();
    event.event_id
}

#[tokio::test]
async fn workflow_file_projection_is_run_scoped_and_idempotent_after_cancel() {
    let pool = pool().await;
    let root = TestDirectory::new();
    let (first_run, first_agent) = run(&pool, &root.0, "canceled").await;
    let (second_run, second_agent) = run(&pool, &root.0, "succeeded").await;
    let session = Uuid::new_v4();
    evidence(
        &pool,
        first_agent,
        session,
        "first.bin",
        AgentFileChangeType::Added,
    )
    .await;
    evidence(
        &pool,
        first_agent,
        session,
        "removed.txt",
        AgentFileChangeType::Deleted,
    )
    .await;
    evidence(
        &pool,
        second_agent,
        session,
        "second.txt",
        AgentFileChangeType::Modified,
    )
    .await;
    // These real directory changes must never become Agent evidence.
    std::fs::write(root.0.join("manual.txt"), "human edit").unwrap();
    std::fs::write(root.0.join("uploaded.txt"), "external upload").unwrap();

    for _ in 0..2 {
        let summary = WorkflowFileChanges::project(&pool, first_run, &root.0)
            .await
            .unwrap();
        assert_eq!(
            summary.collection_status,
            WorkflowFileCollectionStatus::Partial
        );
        assert_eq!(
            summary
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["first.bin", "removed.txt"]
        );
        assert!(!summary.reasons.is_empty());
        let json = serde_json::to_value(&summary.files).unwrap();
        assert!(
            json.as_array()
                .unwrap()
                .iter()
                .all(|file| file.as_object().unwrap().len() == 2)
        );
    }
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workflow_file_changes WHERE workflow_run_id = ?")
            .bind(first_run)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 2);
    let second = WorkflowFileChanges::project(&pool, second_run, &root.0)
        .await
        .unwrap();
    assert_eq!(second.files.len(), 1);
    assert_eq!(second.files[0].path, "second.txt");
}

#[tokio::test]
async fn workflow_file_projection_never_claims_empty_means_complete() {
    let pool = pool().await;
    let root = TestDirectory::new();
    let (run_id, agent) = run(&pool, &root.0, "running").await;
    let summary = WorkflowFileChanges::project(&pool, run_id, &root.0)
        .await
        .unwrap();
    assert!(summary.files.is_empty());
    assert_eq!(
        summary.collection_status,
        WorkflowFileCollectionStatus::Collecting
    );
    evidence(
        &pool,
        agent,
        Uuid::new_v4(),
        "kept.txt",
        AgentFileChangeType::Modified,
    )
    .await;
    let _ = WorkflowFileChanges::project(&pool, run_id, &root.0)
        .await
        .unwrap();
    sqlx::query("UPDATE agent_runs SET projection_status = 'projection_degraded' WHERE id = ?")
        .bind(agent)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE workflow_runs SET status = 'failed' WHERE id = ?")
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();
    let summary = WorkflowFileChanges::project(&pool, run_id, &root.0)
        .await
        .unwrap();
    assert_eq!(
        summary.collection_status,
        WorkflowFileCollectionStatus::Unavailable
    );
    assert_eq!(summary.files.len(), 1);
    let stored: String = sqlx::query_scalar(
        "SELECT collection_status FROM workflow_file_collections WHERE workflow_run_id = ?",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, "unavailable");
}

#[tokio::test]
async fn workflow_file_projection_rejects_cross_run_evidence_in_database() {
    let pool = pool().await;
    let root = TestDirectory::new();
    let (first, _) = run(&pool, &root.0, "succeeded").await;
    let (_, other_agent) = run(&pool, &root.0, "succeeded").await;
    let event = evidence(
        &pool,
        other_agent,
        Uuid::new_v4(),
        "other.txt",
        AgentFileChangeType::Added,
    )
    .await;
    assert!(
        sqlx::query("INSERT INTO workflow_file_evidence_events VALUES (?, ?, ?)")
            .bind(first)
            .bind(event)
            .bind(other_agent)
            .execute(&pool)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn workflow_file_projection_does_not_rebase_captured_paths() {
    let pool = pool().await;
    let root = TestDirectory::new();
    let replacement = TestDirectory::new();
    let (run_id, agent) = run(&pool, &root.0, "succeeded").await;
    evidence(
        &pool,
        agent,
        Uuid::new_v4(),
        "owned.txt",
        AgentFileChangeType::Modified,
    )
    .await;
    WorkflowFileChanges::project(&pool, run_id, &root.0)
        .await
        .unwrap();
    let summary = WorkflowFileChanges::project(&pool, run_id, &replacement.0)
        .await
        .unwrap();
    assert_eq!(
        summary.collection_status,
        WorkflowFileCollectionStatus::Unavailable
    );
    assert_eq!(summary.files[0].path, "owned.txt");
    assert!(
        summary
            .reasons
            .contains(&"project_root_binding_changed".to_string())
    );
}

#[tokio::test]
async fn workflow_file_projection_recovers_root_and_preserves_gap_reasons() {
    let pool = pool().await;
    let root = TestDirectory::new();
    let (run_id, agent) = run(&pool, &root.0, "succeeded").await;
    let missing = root.0.join("unavailable");
    let summary = WorkflowFileChanges::project(&pool, run_id, &missing)
        .await
        .unwrap();
    assert_eq!(
        summary.collection_status,
        WorkflowFileCollectionStatus::Unavailable
    );
    assert_eq!(summary.reasons, ["project_root_unavailable"]);
    evidence(
        &pool,
        agent,
        Uuid::new_v4(),
        "retained.txt",
        AgentFileChangeType::Modified,
    )
    .await;
    let recovered = WorkflowFileChanges::project(&pool, run_id, &root.0)
        .await
        .unwrap();
    assert_eq!(
        recovered.collection_status,
        WorkflowFileCollectionStatus::Partial
    );
    assert_eq!(recovered.files[0].path, "retained.txt");
    let failed = WorkflowFileChanges::unavailable(&pool, run_id, "projection_query_failed")
        .await
        .unwrap();
    assert_eq!(failed.files, recovered.files);
    for reason in recovered.reasons {
        assert!(failed.reasons.contains(&reason));
    }
    assert!(
        failed
            .reasons
            .contains(&"projection_query_failed".to_string())
    );
}

#[tokio::test]
async fn workflow_file_projection_rejects_missing_audit_and_mismatched_attempt() {
    let pool = pool().await;
    let root = TestDirectory::new();
    let (run_id, agent) = run(&pool, &root.0, "succeeded").await;
    for (path, mutation) in [
        (
            "unaudited.txt",
            "json_set(event_envelope, '$.native_refs', json('[]'))",
        ),
        (
            "wrong-attempt.txt",
            "json_set(event_envelope, '$.run_attempt_id', '00000000-0000-0000-0000-000000000000')",
        ),
    ] {
        let event = evidence(
            &pool,
            agent,
            Uuid::new_v4(),
            path,
            AgentFileChangeType::Modified,
        )
        .await;
        sqlx::query(&format!(
            "UPDATE agent_events SET event_envelope = {mutation} WHERE event_id = ?"
        ))
        .bind(event)
        .execute(&pool)
        .await
        .unwrap();
    }
    for _ in 0..2 {
        let summary = WorkflowFileChanges::project(&pool, run_id, &root.0)
            .await
            .unwrap();
        assert!(summary.files.is_empty());
        assert!(
            summary
                .reasons
                .contains(&"invalid_or_unaudited_file_evidence".to_string())
        );
    }
}

#[tokio::test]
async fn workflow_file_paths_support_deleted_files_and_reject_escape() {
    let root = TestDirectory::new();
    assert_eq!(
        relative_evidence_path(&root.0, &root.0, "gone/sub/file.bin")
            .await
            .as_deref(),
        Some("gone/sub/file.bin")
    );
    for path in [
        "../outside.txt",
        "safe/../../outside.txt",
        "C:drive-relative.txt",
        "bad\0name",
        "",
    ] {
        assert!(
            relative_evidence_path(&root.0, &root.0, path)
                .await
                .is_none(),
            "{path}"
        );
    }
    let outside = TestDirectory::new();
    assert!(
        relative_evidence_path(
            &root.0,
            &root.0,
            outside.0.join("secret.txt").to_str().unwrap()
        )
        .await
        .is_none()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn workflow_file_paths_reject_symlink_escape_even_after_target_deletion() {
    let root = TestDirectory::new();
    let outside = TestDirectory::new();
    std::os::unix::fs::symlink(&outside.0, root.0.join("link")).unwrap();
    assert!(
        relative_evidence_path(&root.0, &root.0, "link/removed.txt")
            .await
            .is_none()
    );
}

#[cfg(any(unix, windows))]
#[tokio::test]
async fn workflow_file_projection_does_not_attribute_retargeted_paths_to_another_file() {
    let pool = pool().await;
    let root = TestDirectory::new();
    std::fs::create_dir(root.0.join("agent-directory")).unwrap();
    std::fs::create_dir(root.0.join("human-directory")).unwrap();
    std::fs::write(root.0.join("agent-directory/report.txt"), b"agent output").unwrap();
    std::fs::write(root.0.join("human-directory/report.txt"), b"human output").unwrap();
    let (run_id, agent) = run(&pool, &root.0, "succeeded").await;
    evidence(
        &pool,
        agent,
        Uuid::new_v4(),
        "agent-directory/report.txt",
        AgentFileChangeType::Modified,
    )
    .await;
    // The Agent's operation happened before the directory was replaced.
    std::fs::rename(
        root.0.join("agent-directory"),
        root.0.join("original-directory"),
    )
    .unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        root.0.join("human-directory"),
        root.0.join("agent-directory"),
    )
    .unwrap();
    #[cfg(windows)]
    {
        let result = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(root.0.join("agent-directory"))
            .arg(root.0.join("human-directory"))
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    let summary = WorkflowFileChanges::project(&pool, run_id, &root.0)
        .await
        .unwrap();
    assert!(summary.files.is_empty());
    assert_eq!(
        summary.collection_status,
        WorkflowFileCollectionStatus::Partial
    );
    assert!(
        summary
            .reasons
            .contains(&"file_path_outside_project_or_unverifiable".to_owned())
    );
}
