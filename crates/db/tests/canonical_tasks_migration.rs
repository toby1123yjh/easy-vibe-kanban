use std::borrow::Cow;

use db::models::{
    arena_group::ArenaCandidatePurpose,
    task::{Task, TaskExecutionKind, TaskOpenTarget, TaskStatus},
};
use sqlx::{
    SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use uuid::Uuid;

const CANONICAL_TASKS_VERSION: i64 = 20260828000000;

async fn test_pool() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .foreign_keys(true),
        )
        .await
        .expect("connect migration test database")
}

fn migrations_before_canonical_tasks() -> Migrator {
    let all = sqlx::migrate!("./migrations");
    Migrator {
        migrations: Cow::Owned(
            all.iter()
                .filter(|migration| migration.version < CANONICAL_TASKS_VERSION)
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    }
}

async fn schema_signature(pool: &SqlitePool) -> Vec<(String, String, String)> {
    sqlx::query_as(
        r#"
        SELECT type, name, COALESCE(sql, '')
        FROM sqlite_master
        WHERE name IN (
            'tasks', 'agent_task_bindings', 'arena_groups', 'arena_candidates',
            'workflow_attempts', 'workspaces'
        )
           OR name LIKE 'idx_tasks_%'
           OR name LIKE 'idx_arena_%'
           OR name LIKE 'tasks_%_guard'
           OR name = 'tasks_execution_kind_immutable'
        ORDER BY type, name
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("read canonical schema signature")
}

async fn assert_final_schema(pool: &SqlitePool) {
    let foreign_keys_enabled: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(pool)
        .await
        .expect("read foreign_keys pragma");
    assert_eq!(foreign_keys_enabled, 1);

    let violations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
        .fetch_one(pool)
        .await
        .expect("run foreign key check");
    assert_eq!(violations, 0);

    let workspace_columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('workspaces') ORDER BY cid")
            .fetch_all(pool)
            .await
            .expect("read Workspace columns");
    for removed in ["task_id", "arena_group_id", "arena_status"] {
        assert!(!workspace_columns.iter().any(|column| column == removed));
    }

    let legacy_links: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'local_workspace_links'",
    )
    .fetch_one(pool)
    .await
    .expect("check removed local Workspace links");
    assert_eq!(legacy_links, 0);
}

#[tokio::test]
async fn fresh_and_upgraded_databases_converge_on_the_canonical_schema() {
    let fresh = test_pool().await;
    sqlx::migrate!("./migrations")
        .run(&fresh)
        .await
        .expect("migrate fresh database");
    assert_final_schema(&fresh).await;

    let upgraded = test_pool().await;
    migrations_before_canonical_tasks()
        .run(&upgraded)
        .await
        .expect("migrate database to the pre-canonical schema");

    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let standalone_workspace_id = Uuid::new_v4();
    let standalone_session_id = Uuid::new_v4();
    let node_workspace_id = Uuid::new_v4();
    let node_session_id = Uuid::new_v4();
    let arena_workspace_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let agent_node_execution_id = Uuid::new_v4();
    let arena_node_execution_id = Uuid::new_v4();
    let arena_group_id = Uuid::new_v4();

    sqlx::query("INSERT INTO projects (id, name) VALUES (?, 'Migration fixture')")
        .bind(project_id)
        .execute(&upgraded)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tasks (id, project_id, title) VALUES (?, ?, 'Legacy Issue')")
        .bind(issue_id)
        .bind(project_id)
        .execute(&upgraded)
        .await
        .unwrap();
    let todo_status_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO local_project_statuses (
            id, project_id, name, color, sort_order, hidden
        ) VALUES (?, ?, 'Todo', '210 80% 52%', 100, 0)
        "#,
    )
    .bind(todo_status_id)
    .bind(project_id)
    .execute(&upgraded)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO local_issues (
            id, project_id, issue_number, simple_id, status_id, title, sort_order
        ) VALUES (?, ?, 1, 'LOCAL-1', ?, 'Legacy Issue', 1001)
        "#,
    )
    .bind(issue_id)
    .bind(project_id)
    .bind(todo_status_id)
    .execute(&upgraded)
    .await
    .unwrap();

    for (workspace_id, name) in [
        (standalone_workspace_id, "Standalone Agent"),
        (node_workspace_id, "Workflow Agent"),
        (arena_workspace_id, "Arena synthesis candidate"),
    ] {
        sqlx::query("INSERT INTO workspaces (id, task_id, branch, name) VALUES (?, ?, 'main', ?)")
            .bind(workspace_id)
            .bind(issue_id)
            .bind(name)
            .execute(&upgraded)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO local_workspace_links (workspace_id, project_id, issue_id) VALUES (?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(issue_id)
        .execute(&upgraded)
        .await
        .unwrap();
    }
    for (session_id, workspace_id, name) in [
        (
            standalone_session_id,
            standalone_workspace_id,
            "Standalone Agent",
        ),
        (node_session_id, node_workspace_id, "Workflow Agent"),
    ] {
        sqlx::query(
            "INSERT INTO sessions (id, workspace_id, name, executor) VALUES (?, ?, ?, 'codex')",
        )
        .bind(session_id)
        .bind(workspace_id)
        .bind(name)
        .execute(&upgraded)
        .await
        .unwrap();
    }

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, graph_json)
        VALUES (?, 'project', ?, 'Fixture Workflow', '{}')
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .execute(&upgraded)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workflow_attempts (
            id, project_id, issue_id, workflow_id, name, status
        ) VALUES (?, ?, ?, ?, 'Fixture Workflow Task', 'running')
        "#,
    )
    .bind(attempt_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(workflow_id)
    .execute(&upgraded)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workflow_runs (
            id, workflow_id, issue_id, attempt_id, input_text, status
        ) VALUES (?, ?, ?, ?, 'Run fixture', 'running')
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(issue_id)
    .bind(attempt_id)
    .execute(&upgraded)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO arena_groups (
            id, issue_id, project_id, prompt, base_branch,
            promoted_workspace_id, lifecycle_status
        ) VALUES (?, ?, ?, 'Compare implementations', 'main', ?, 'adopted')
        "#,
    )
    .bind(arena_group_id)
    .bind(issue_id)
    .bind(project_id)
    .bind(arena_workspace_id)
    .execute(&upgraded)
    .await
    .unwrap();
    sqlx::query("UPDATE workspaces SET arena_group_id = ? WHERE id = ?")
        .bind(arena_group_id)
        .bind(arena_workspace_id)
        .execute(&upgraded)
        .await
        .unwrap();
    sqlx::query(
        r#"
        INSERT INTO node_executions (
            id, run_id, node_id, node_type, status, session_id
        ) VALUES (?, ?, 'agent-1', 'agent', 'running', ?)
        "#,
    )
    .bind(agent_node_execution_id)
    .bind(run_id)
    .bind(node_session_id)
    .execute(&upgraded)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO node_executions (
            id, run_id, node_id, node_type, status, arena_group_id
        ) VALUES (?, ?, 'arena-1', 'arena', 'awaiting_arena', ?)
        "#,
    )
    .bind(arena_node_execution_id)
    .bind(run_id)
    .bind(arena_group_id)
    .execute(&upgraded)
    .await
    .unwrap();

    sqlx::migrate!("./migrations")
        .run(&upgraded)
        .await
        .expect("upgrade fixture to canonical schema");
    assert_final_schema(&upgraded).await;
    assert_eq!(
        schema_signature(&fresh).await,
        schema_signature(&upgraded).await
    );

    let standalone_task = Task::find_agent_by_session_id(&upgraded, standalone_session_id)
        .await
        .unwrap()
        .expect("standalone Session binding");
    assert_eq!(standalone_task.execution_kind, TaskExecutionKind::Agent);
    assert_eq!(standalone_task.parent_task_id, None);

    let workflow_summary = Task::summary_by_id(&upgraded, attempt_id)
        .await
        .unwrap()
        .expect("Workflow Task summary");
    assert_eq!(workflow_summary.status, TaskStatus::Running);
    assert!(matches!(
        workflow_summary.open_target,
        TaskOpenTarget::Workflow {
            attempt_id: id,
            workflow_id: workflow,
            ..
        } if id == attempt_id && workflow == workflow_id
    ));

    let child_task_id: Uuid =
        sqlx::query_scalar("SELECT task_id FROM node_executions WHERE id = ?")
            .bind(agent_node_execution_id)
            .fetch_one(&upgraded)
            .await
            .unwrap();
    let child_task = Task::find_by_id(&upgraded, child_task_id)
        .await
        .unwrap()
        .expect("Agent Node child Task");
    assert_eq!(child_task.parent_task_id, Some(attempt_id));

    let candidate: (Uuid, ArenaCandidatePurpose) =
        sqlx::query_as("SELECT id, purpose FROM arena_candidates WHERE arena_group_id = ?")
            .bind(arena_group_id)
            .fetch_one(&upgraded)
            .await
            .unwrap();
    assert_eq!(candidate.0, arena_workspace_id);
    assert_eq!(candidate.1, ArenaCandidatePurpose::Synthesis);
    sqlx::query("UPDATE workspaces SET name = 'Renamed ordinary workspace' WHERE id = ?")
        .bind(arena_workspace_id)
        .execute(&upgraded)
        .await
        .unwrap();
    let purpose_after_rename: ArenaCandidatePurpose =
        sqlx::query_scalar("SELECT purpose FROM arena_candidates WHERE id = ?")
            .bind(candidate.0)
            .fetch_one(&upgraded)
            .await
            .unwrap();
    assert_eq!(purpose_after_rename, ArenaCandidatePurpose::Synthesis);

    let arena_summary = Task::summary_by_id(&upgraded, arena_group_id)
        .await
        .unwrap()
        .expect("Arena Task summary");
    assert_eq!(arena_summary.status, TaskStatus::Succeeded);

    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(arena_group_id)
        .execute(&upgraded)
        .await
        .expect("delete Arena Task with selected winner");
    let remaining_group: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM arena_groups WHERE id = ?")
        .bind(arena_group_id)
        .fetch_one(&upgraded)
        .await
        .unwrap();
    let remaining_candidates: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM arena_candidates WHERE arena_group_id = ?")
            .bind(arena_group_id)
            .fetch_one(&upgraded)
            .await
            .unwrap();
    assert_eq!((remaining_group, remaining_candidates), (0, 0));
}
