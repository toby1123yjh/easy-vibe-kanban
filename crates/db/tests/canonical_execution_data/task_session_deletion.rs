use db::models::session::SessionError;

use super::*;

struct Fixture {
    pool: SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
    workspace_id: Uuid,
    session_id: Uuid,
    task_id: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let fixture = Self {
            pool: migrated_pool().await,
            project_id: uuid(20_001),
            issue_id: uuid(20_002),
            workspace_id: uuid(20_003),
            session_id: uuid(20_004),
            task_id: uuid(20_005),
        };
        insert_project(&fixture.pool, fixture.project_id, "Project", BASELINE).await;
        insert_issue(&fixture.pool, fixture.project_id, fixture.issue_id, 20).await;
        insert_workspace_and_session(
            &fixture.pool,
            fixture.workspace_id,
            fixture.session_id,
            "Selected Session",
            BASELINE,
        )
        .await;
        fixture.add_task(fixture.task_id, None, "agent").await;
        bind_agent(&fixture.pool, fixture.task_id, fixture.session_id).await;
        sqlx::query(
            "INSERT INTO scratch (id, scratch_type, payload) VALUES (?, 'draft_follow_up', '{}')",
        )
        .bind(fixture.session_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
        fixture
    }

    async fn add_task(&self, id: Uuid, parent_task_id: Option<Uuid>, kind: &str) {
        insert_task(
            &self.pool,
            id,
            self.project_id,
            self.issue_id,
            parent_task_id,
            "Task",
            kind,
            BASELINE,
        )
        .await;
    }

    async fn delete(&self) -> Result<(), SessionError> {
        Task::delete_agent_with_session(&self.pool, self.task_id, self.session_id).await
    }

    async fn assert_retained(&self) {
        let task = Task::find_agent_by_session_id(&self.pool, self.session_id)
            .await
            .unwrap()
            .expect("Task binding must survive failed deletion");
        assert_eq!(task.id, self.task_id);
        for (table, id) in [
            ("tasks", self.task_id),
            ("sessions", self.session_id),
            ("scratch", self.session_id),
            ("workspaces", self.workspace_id),
            ("local_issues", self.issue_id),
            ("projects", self.project_id),
        ] {
            assert_eq!(count(&self.pool, table, id).await, 1, "{table}");
        }
    }

    async fn add_run(&self, status: &str) -> Uuid {
        let run_id = uuid(21_001);
        insert_agent_run_state(
            &self.pool,
            run_id,
            self.session_id,
            self.workspace_id,
            status,
            BASELINE,
        )
        .await;
        run_id
    }

    async fn add_attempt(&self, run_id: Uuid, status: &str) -> Uuid {
        let turn_id = uuid(21_002);
        let attempt_id = uuid(21_003);
        sqlx::query(
            "INSERT INTO agent_turns (id, agent_run_id, request_id, intent, input_message) VALUES (?, ?, ?, 'initial', '{}')",
        )
        .bind(turn_id)
        .bind(run_id)
        .bind(uuid(21_004))
        .execute(&self.pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            INSERT INTO agent_run_attempts (
                id, agent_run_id, turn_id, request_id, idempotency_key,
                attempt_number, mode, transport, schema_version, payload_version,
                capability_snapshot, request_envelope, status
            ) VALUES (?, ?, ?, ?, 'test-attempt', 1, 'launch', 'stdio_cli', 1, 1, '{}', '{}', ?)
            "#,
        )
        .bind(attempt_id)
        .bind(run_id)
        .bind(turn_id)
        .bind(uuid(21_005))
        .bind(status)
        .execute(&self.pool)
        .await
        .unwrap();
        attempt_id
    }
}

async fn count(pool: &SqlitePool, table: &str, id: Uuid) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn exact_deletion_cleans_owned_history_and_preserves_siblings_and_parents() {
    let fixture = Fixture::new().await;
    let pool = &fixture.pool;
    let sibling_session_id = uuid(20_006);
    let sibling_task_id = uuid(20_007);
    sqlx::query("INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, 'Sibling')")
        .bind(sibling_session_id)
        .bind(fixture.workspace_id)
        .execute(pool)
        .await
        .unwrap();
    fixture.add_task(sibling_task_id, None, "agent").await;
    bind_agent(pool, sibling_task_id, sibling_session_id).await;
    sqlx::query(
        "INSERT INTO scratch (id, scratch_type, payload) VALUES (?, 'draft_follow_up', '{}')",
    )
    .bind(sibling_session_id)
    .execute(pool)
    .await
    .unwrap();

    let run_id = fixture.add_run("succeeded").await;
    let attempt_id = fixture.add_attempt(run_id, "succeeded").await;
    sqlx::query(
        r#"
        INSERT INTO agent_events (
            event_id, session_id, agent_run_id, turn_id, run_attempt_id,
            run_attempt_number, sequence, correlation_id, schema_version,
            payload_version, event_envelope
        ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, 1, 1, '{}')
        "#,
    )
    .bind(uuid(21_009))
    .bind(fixture.session_id)
    .bind(run_id)
    .bind(uuid(21_002))
    .bind(attempt_id)
    .bind(uuid(21_010))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO agent_process_registry (
            id, run_attempt_id, registry_status, pid, process_started_at, observed_exited_at
        ) VALUES (?, ?, 'exited', 123, ?, ?)
        "#,
    )
    .bind(uuid(21_006))
    .bind(attempt_id)
    .bind(BASELINE)
    .bind(BASELINE)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO native_audit_streams (
            id, session_id, agent_run_id, run_attempt_id, audit_schema_version,
            adapter_version, mapper_version, manifest_relative_path, frames_relative_path
        ) VALUES (?, ?, ?, ?, 1, '1', '1', 'test/manifest.json', 'test/frames.jsonl')
        "#,
    )
    .bind(uuid(21_007))
    .bind(fixture.session_id)
    .bind(run_id)
    .bind(attempt_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO execution_processes (id, session_id, status) VALUES (?, ?, 'completed')",
    )
    .bind(uuid(21_008))
    .bind(fixture.session_id)
    .execute(pool)
    .await
    .unwrap();

    fixture.delete().await.unwrap();
    for (table, id) in [
        ("tasks", fixture.task_id),
        ("sessions", fixture.session_id),
        ("scratch", fixture.session_id),
        ("agent_runs", run_id),
        ("agent_turns", uuid(21_002)),
        ("agent_run_attempts", attempt_id),
        ("agent_process_registry", uuid(21_006)),
        ("native_audit_streams", uuid(21_007)),
        ("execution_processes", uuid(21_008)),
    ] {
        assert_eq!(count(pool, table, id).await, 0, "{table}");
    }
    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agent_events WHERE session_id = ?")
            .bind(fixture.session_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(event_count, 0);
    for (table, id) in [
        ("tasks", sibling_task_id),
        ("sessions", sibling_session_id),
        ("scratch", sibling_session_id),
        ("workspaces", fixture.workspace_id),
        ("local_issues", fixture.issue_id),
        ("projects", fixture.project_id),
    ] {
        assert_eq!(count(pool, table, id).await, 1, "{table}");
    }
    assert_eq!(
        Task::find_agent_by_session_id(pool, sibling_session_id)
            .await
            .unwrap()
            .unwrap()
            .id,
        sibling_task_id
    );
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap();
    assert!(violations.is_empty());
}

#[tokio::test]
async fn unknown_task_wrong_session_and_wrong_execution_kind_do_not_delete() {
    let fixture = Fixture::new().await;
    assert!(matches!(
        Task::delete_agent_with_session(&fixture.pool, uuid(99_999), fixture.session_id).await,
        Err(SessionError::Task(TaskError::NotFound { .. }))
    ));
    assert!(matches!(
        Task::delete_agent_with_session(&fixture.pool, fixture.task_id, uuid(99_999)).await,
        Err(SessionError::Task(TaskError::InvalidBinding { .. }))
    ));
    for kind in ["workflow", "arena"] {
        let task_id = Uuid::new_v4();
        fixture.add_task(task_id, None, kind).await;
        assert!(matches!(
            Task::delete_agent_with_session(&fixture.pool, task_id, fixture.session_id).await,
            Err(SessionError::Task(TaskError::DeletionBlocked { .. }))
        ));
        assert_eq!(count(&fixture.pool, "tasks", task_id).await, 1);
    }
    fixture.assert_retained().await;
}

#[tokio::test]
async fn missing_binding_is_not_repaired_by_deleting_the_supplied_session() {
    let fixture = Fixture::new().await;
    sqlx::query("DELETE FROM agent_task_bindings WHERE task_id = ?")
        .bind(fixture.task_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::Task(TaskError::InvalidBinding { .. }))
    ));
    assert_eq!(count(&fixture.pool, "tasks", fixture.task_id).await, 1);
    assert_eq!(
        count(&fixture.pool, "sessions", fixture.session_id).await,
        1
    );
}

#[tokio::test]
async fn child_and_descendant_tasks_are_never_deleted_recursively() {
    let fixture = Fixture::new().await;
    let child_id = uuid(22_001);
    let grandchild_id = uuid(22_002);
    fixture
        .add_task(child_id, Some(fixture.task_id), "agent")
        .await;
    fixture
        .add_task(grandchild_id, Some(child_id), "agent")
        .await;
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::Task(TaskError::DeletionBlocked { .. }))
    ));
    fixture.assert_retained().await;
    for id in [child_id, grandchild_id] {
        assert_eq!(count(&fixture.pool, "tasks", id).await, 1);
    }

    let child_fixture = Fixture::new().await;
    let parent_id = uuid(22_003);
    child_fixture.add_task(parent_id, None, "workflow").await;
    sqlx::query("UPDATE tasks SET parent_task_id = ? WHERE id = ?")
        .bind(parent_id)
        .bind(child_fixture.task_id)
        .execute(&child_fixture.pool)
        .await
        .unwrap();
    assert!(matches!(
        child_fixture.delete().await,
        Err(SessionError::Task(TaskError::DeletionBlocked { .. }))
    ));
    child_fixture.assert_retained().await;
}

#[tokio::test]
async fn active_and_reserved_runs_roll_back_task_and_session_deletion() {
    for status in [
        "pending",
        "starting",
        "running",
        "awaiting_input",
        "awaiting_approval",
        "cancelling",
    ] {
        let fixture = Fixture::new().await;
        fixture.add_run(status).await;
        assert!(
            matches!(fixture.delete().await, Err(SessionError::ActiveAgentRun)),
            "{status}"
        );
        fixture.assert_retained().await;
    }
    let fixture = Fixture::new().await;
    let run_id = fixture.add_run("failed").await;
    fixture.add_attempt(run_id, "pending").await;
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::ActiveAgentRun)
    ));
    fixture.assert_retained().await;
}

#[tokio::test]
async fn live_or_unreachable_registry_blocks_even_a_terminal_run() {
    for status in ["spawned", "running", "unreachable"] {
        let fixture = Fixture::new().await;
        let run_id = fixture.add_run("failed").await;
        let attempt_id = fixture.add_attempt(run_id, "failed").await;
        sqlx::query(
            "INSERT INTO agent_process_registry (id, run_attempt_id, registry_status, pid, process_started_at) VALUES (?, ?, ?, 123, ?)",
        )
        .bind(uuid(23_001))
        .bind(attempt_id)
        .bind(status)
        .bind(BASELINE)
        .execute(&fixture.pool)
        .await
        .unwrap();
        assert!(
            matches!(
                fixture.delete().await,
                Err(SessionError::ActiveAgentProcess)
            ),
            "{status}"
        );
        fixture.assert_retained().await;
    }
}

#[tokio::test]
async fn failed_launch_with_an_unspawned_reservation_can_be_deleted() {
    let fixture = Fixture::new().await;
    let run_id = fixture.add_run("failed").await;
    let attempt_id = fixture.add_attempt(run_id, "failed").await;
    sqlx::query("INSERT INTO agent_process_registry (id, run_attempt_id) VALUES (?, ?)")
        .bind(uuid(23_002))
        .bind(attempt_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    fixture.delete().await.unwrap();
    assert_eq!(
        count(&fixture.pool, "sessions", fixture.session_id).await,
        0
    );
}

#[tokio::test]
async fn running_scripts_roll_back_task_and_session_deletion() {
    let fixture = Fixture::new().await;
    sqlx::query("INSERT INTO execution_processes (id, session_id) VALUES (?, ?)")
        .bind(uuid(24_001))
        .bind(fixture.session_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::ActiveExecutionProcess)
    ));
    fixture.assert_retained().await;
}

#[tokio::test]
async fn orchestration_owned_runs_are_preserved_with_their_link() {
    let fixture = Fixture::new().await;
    let run_id = fixture.add_run("succeeded").await;
    let orchestration_id = uuid(25_001);
    let node_id = uuid(25_002);
    sqlx::query(
        r#"
        INSERT INTO orchestration_runs (
            id, request_id, idempotency_key, correlation_id, product_kind,
            source_definition_id, source_definition_version, plan_schema_version, plan_snapshot
        ) VALUES (?, ?, 'test-orchestration', ?, 'workflow', ?, '1', 1, '{}')
        "#,
    )
    .bind(orchestration_id)
    .bind(uuid(25_003))
    .bind(uuid(25_004))
    .bind(uuid(25_005))
    .execute(&fixture.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO orchestration_node_executions (id, orchestration_run_id, node_key, stable_order) VALUES (?, ?, 'agent', 0)",
    )
    .bind(node_id)
    .bind(orchestration_id)
    .execute(&fixture.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO orchestration_agent_run_links (id, orchestration_run_id, node_execution_id, agent_run_id, dispatch_idempotency_key) VALUES (?, ?, ?, ?, 'test-dispatch')",
    )
    .bind(uuid(25_006))
    .bind(orchestration_id)
    .bind(node_id)
    .bind(run_id)
    .execute(&fixture.pool)
    .await
    .unwrap();
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::DeletionDependency)
    ));
    fixture.assert_retained().await;
    assert_eq!(
        count(&fixture.pool, "orchestration_agent_run_links", uuid(25_006)).await,
        1
    );
}

#[tokio::test]
async fn arena_candidate_session_is_not_deleted_independently() {
    let fixture = Fixture::new().await;
    let arena_task_id = uuid(26_001);
    let arena_group_id = uuid(26_002);
    fixture.add_task(arena_task_id, None, "arena").await;
    sqlx::query("INSERT INTO arena_groups (id, task_id, prompt, base_branch) VALUES (?, ?, 'Compare', 'main')")
        .bind(arena_group_id)
        .bind(arena_task_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO arena_candidates (id, arena_group_id, workspace_id, purpose, sort_order) VALUES (?, ?, ?, 'attempt', 0)")
        .bind(uuid(26_003))
        .bind(arena_group_id)
        .bind(fixture.workspace_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::DeletionDependency)
    ));
    fixture.assert_retained().await;
    assert_eq!(
        count(&fixture.pool, "arena_groups", arena_group_id).await,
        1
    );
}

#[tokio::test]
async fn legacy_workflow_session_reference_cannot_be_silently_cleared() {
    let fixture = Fixture::new().await;
    let workflow_id = uuid(27_001);
    let workflow_task_id = uuid(27_002);
    let attempt_id = uuid(27_003);
    let workflow_run_id = uuid(27_004);
    fixture.add_task(workflow_task_id, None, "workflow").await;
    sqlx::query("INSERT INTO workflows (id, source, project_id, name, graph_json) VALUES (?, 'project', ?, 'Workflow', '{}')")
        .bind(workflow_id)
        .bind(fixture.project_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO workflow_attempts (id, task_id, workflow_id) VALUES (?, ?, ?)")
        .bind(attempt_id)
        .bind(workflow_task_id)
        .bind(workflow_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO workflow_runs (id, workflow_id, issue_id, attempt_id, input_text, graph_snapshot) VALUES (?, ?, ?, ?, 'input', '{}')")
        .bind(workflow_run_id)
        .bind(workflow_id)
        .bind(fixture.issue_id)
        .bind(attempt_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    // A migrated node may reference the Session without a canonical child Task.
    sqlx::query("INSERT INTO node_executions (id, run_id, node_id, node_type, session_id) VALUES (?, ?, 'agent', 'agent', ?)")
        .bind(uuid(27_005))
        .bind(workflow_run_id)
        .bind(fixture.session_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(matches!(
        fixture.delete().await,
        Err(SessionError::DeletionDependency)
    ));
    fixture.assert_retained().await;
    let retained_session: Uuid =
        sqlx::query_scalar("SELECT session_id FROM node_executions WHERE id = ?")
            .bind(uuid(27_005))
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(retained_session, fixture.session_id);
}

#[tokio::test]
async fn unexpected_foreign_key_dependency_rolls_back_task_binding_and_scratch() {
    // A fixture-only FK models an additional dependent record missed by the
    // explicit guards, including a conflict deferred until transaction commit.
    for constraint in ["RESTRICT", "NO ACTION DEFERRABLE INITIALLY DEFERRED"] {
        let fixture = Fixture::new().await;
        sqlx::query(&format!(
            "CREATE TABLE test_session_dependency (session_id BLOB REFERENCES sessions(id) ON DELETE {constraint})"
        ))
        .execute(&fixture.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO test_session_dependency (session_id) VALUES (?)")
            .bind(fixture.session_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        let result = fixture.delete().await;
        assert!(
            matches!(result, Err(SessionError::DeletionDependency)),
            "{constraint}: {result:?}"
        );
        fixture.assert_retained().await;
    }
}

#[tokio::test]
async fn unknown_standalone_session_is_not_found() {
    let pool = migrated_pool().await;
    assert!(matches!(
        Session::delete(&pool, uuid(99_999)).await,
        Err(SessionError::NotFound)
    ));
}
