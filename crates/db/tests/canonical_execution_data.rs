use db::models::{
    project::Project,
    session::Session,
    task::{Task, TaskError, TaskExecutionKind, TaskOpenTarget, TaskStatus},
};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use uuid::Uuid;

const BASELINE: &str = "2026-01-01T00:00:00.000Z";
const AGENT_ACTIVITY: &str = "2026-01-02T00:00:00.000Z";
const WORKFLOW_ACTIVITY: &str = "2026-01-03T00:00:00.000Z";
const NODE_ACTIVITY: &str = "2026-01-04T00:00:00.000Z";
const ARENA_ACTIVITY: &str = "2026-01-05T00:00:00.000Z";

fn uuid(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

async fn migrated_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .foreign_keys(true),
        )
        .await
        .expect("connect execution-data test database");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrate execution-data test database");
    pool
}

async fn insert_project(pool: &SqlitePool, id: Uuid, name: &str, updated_at: &str) {
    sqlx::query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(name)
        .bind(BASELINE)
        .bind(updated_at)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_issue(pool: &SqlitePool, project_id: Uuid, issue_id: Uuid, seed: u32) {
    let status_id = uuid(10_000 + u128::from(seed));
    sqlx::query(
        r#"
        INSERT INTO local_project_statuses (
            id, project_id, name, color, sort_order, hidden
        ) VALUES (?, ?, ?, '210 80% 52%', 100, 0)
        "#,
    )
    .bind(status_id)
    .bind(project_id)
    .bind(format!("Todo {seed}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO local_issues (
            id, project_id, issue_number, simple_id, status_id, title, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, 1001)
        "#,
    )
    .bind(issue_id)
    .bind(project_id)
    .bind(i64::from(seed))
    .bind(format!("LOCAL-{seed}"))
    .bind(status_id)
    .bind(format!("Issue {seed}"))
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_workspace_and_session(
    pool: &SqlitePool,
    workspace_id: Uuid,
    session_id: Uuid,
    title: &str,
    updated_at: &str,
) {
    sqlx::query(
        r#"
        INSERT INTO workspaces (id, branch, name, created_at, updated_at)
        VALUES (?, 'main', ?, ?, ?)
        "#,
    )
    .bind(workspace_id)
    .bind(title)
    .bind(BASELINE)
    .bind(updated_at)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO sessions (
            id, workspace_id, name, executor, created_at, updated_at
        ) VALUES (?, ?, ?, 'codex', ?, ?)
        "#,
    )
    .bind(session_id)
    .bind(workspace_id)
    .bind(title)
    .bind(BASELINE)
    .bind(updated_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_task(
    pool: &SqlitePool,
    id: Uuid,
    project_id: Uuid,
    issue_id: Uuid,
    parent_task_id: Option<Uuid>,
    title: &str,
    kind: &str,
    updated_at: &str,
) {
    sqlx::query(
        r#"
        INSERT INTO tasks (
            id, project_id, issue_id, parent_task_id, title, execution_kind,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(project_id)
    .bind(issue_id)
    .bind(parent_task_id)
    .bind(title)
    .bind(kind)
    .bind(BASELINE)
    .bind(updated_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn bind_agent(pool: &SqlitePool, task_id: Uuid, session_id: Uuid) {
    sqlx::query("INSERT INTO agent_task_bindings (task_id, session_id) VALUES (?, ?)")
        .bind(task_id)
        .bind(session_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_agent_run_state(
    pool: &SqlitePool,
    run_id: Uuid,
    session_id: Uuid,
    workspace_id: Uuid,
    status: &str,
    updated_at: &str,
) {
    sqlx::query(
        r#"
        INSERT INTO agent_runs (
            id, session_id, workspace_id, request_id, idempotency_key,
            correlation_id, schema_version, payload_version,
            runtime_profile_id, provider_id, workspace_mode, workspace_path,
            status, projection_status, request_envelope, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, 1, 1, 'test-profile', 'codex',
            'shared_workspace', 'C:/test', ?, 'current', '{}', ?, ?
        )
        "#,
    )
    .bind(run_id)
    .bind(session_id)
    .bind(workspace_id)
    .bind(uuid(run_id.as_u128() + 1_000_000))
    .bind(format!("run-{run_id}"))
    .bind(uuid(run_id.as_u128() + 2_000_000))
    .bind(status)
    .bind(BASELINE)
    .bind(updated_at)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO agent_run_state (
            agent_run_id, state_schema_version, reducer_version, status,
            projection_status, state_json, updated_at
        ) VALUES (?, 1, 1, ?, 'current', '{}', ?)
        "#,
    )
    .bind(run_id)
    .bind(status)
    .bind(updated_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn updated_at(pool: &SqlitePool, table: &str, id: Uuid) -> String {
    let query = format!("SELECT updated_at FROM {table} WHERE id = ?");
    sqlx::query_scalar(&query)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn project_session_and_task_cursors_are_stable_across_tied_timestamps() {
    let pool = migrated_pool().await;
    let project_ids = [uuid(1), uuid(2), uuid(3), uuid(4)];
    for (index, id) in project_ids.into_iter().enumerate() {
        insert_project(&pool, id, &format!("Project {index}"), BASELINE).await;
    }

    let first_projects = Project::list_recent(&pool, None, 2).await.unwrap();
    let second_projects = Project::list_recent(&pool, first_projects.next_cursor, 2)
        .await
        .unwrap();
    assert_eq!(
        first_projects
            .projects
            .iter()
            .chain(&second_projects.projects)
            .map(|project| project.id)
            .collect::<Vec<_>>(),
        project_ids
    );
    assert!(second_projects.next_cursor.is_none());

    let project_id = project_ids[0];
    let issue_id = uuid(100);
    insert_issue(&pool, project_id, issue_id, 1).await;
    let top_level_task_ids = [uuid(200), uuid(201), uuid(202), uuid(203)];
    let mut session_ids = Vec::new();
    for (index, task_id) in top_level_task_ids.into_iter().enumerate() {
        let workspace_id = uuid(300 + index as u128);
        let session_id = uuid(400 + index as u128);
        insert_workspace_and_session(
            &pool,
            workspace_id,
            session_id,
            &format!("Agent {index}"),
            BASELINE,
        )
        .await;
        insert_task(
            &pool,
            task_id,
            project_id,
            issue_id,
            None,
            &format!("Task {index}"),
            "agent",
            BASELINE,
        )
        .await;
        bind_agent(&pool, task_id, session_id).await;
        session_ids.push(session_id);
    }

    let child_task_id = uuid(250);
    let child_workspace_id = uuid(350);
    let child_session_id = uuid(450);
    insert_workspace_and_session(
        &pool,
        child_workspace_id,
        child_session_id,
        "Child agent",
        BASELINE,
    )
    .await;
    insert_task(
        &pool,
        child_task_id,
        project_id,
        issue_id,
        Some(top_level_task_ids[0]),
        "Child Task",
        "agent",
        BASELINE,
    )
    .await;
    bind_agent(&pool, child_task_id, child_session_id).await;

    let incidental_workspace_id = uuid(360);
    let incidental_session_id = uuid(460);
    insert_workspace_and_session(
        &pool,
        incidental_workspace_id,
        incidental_session_id,
        "Incidental setup Session",
        BASELINE,
    )
    .await;

    let first_tasks = Task::list_top_level(&pool, project_id, Some(issue_id), None, 2)
        .await
        .unwrap();
    let second_tasks = Task::list_top_level(
        &pool,
        project_id,
        Some(issue_id),
        first_tasks.next_cursor,
        2,
    )
    .await
    .unwrap();
    assert_eq!(
        first_tasks
            .tasks
            .iter()
            .chain(&second_tasks.tasks)
            .map(|task| task.id)
            .collect::<Vec<_>>(),
        top_level_task_ids
    );
    assert!(second_tasks.next_cursor.is_none());

    let children = Task::list_children(&pool, top_level_task_ids[0], None, 10)
        .await
        .unwrap();
    assert_eq!(
        children
            .tasks
            .iter()
            .map(|task| task.id)
            .collect::<Vec<_>>(),
        [child_task_id]
    );

    session_ids.push(child_session_id);
    session_ids.sort();
    let first_sessions = Session::list_recent_task_bound(&pool, Some(project_id), None, 3)
        .await
        .unwrap();
    let second_sessions =
        Session::list_recent_task_bound(&pool, Some(project_id), first_sessions.next_cursor, 3)
            .await
            .unwrap();
    assert_eq!(
        first_sessions
            .sessions
            .iter()
            .chain(&second_sessions.sessions)
            .map(|session| session.id)
            .collect::<Vec<_>>(),
        session_ids
    );
    assert!(second_sessions.next_cursor.is_none());
    assert!(
        first_sessions
            .sessions
            .iter()
            .chain(&second_sessions.sessions)
            .all(|session| session.id != incidental_session_id)
    );
}

#[tokio::test]
async fn recent_cursors_order_mixed_sqlite_and_rfc3339_timestamps_chronologically() {
    let pool = migrated_pool().await;
    let older_project_id = uuid(700);
    let newer_project_id = uuid(701);
    insert_project(
        &pool,
        older_project_id,
        "RFC3339 morning",
        "2026-01-01T01:00:00.000Z",
    )
    .await;
    insert_project(
        &pool,
        newer_project_id,
        "SQLite evening",
        "2026-01-01 23:00:00.000",
    )
    .await;

    let first_page = Project::list_recent(&pool, None, 1).await.unwrap();
    let second_page = Project::list_recent(&pool, first_page.next_cursor, 1)
        .await
        .unwrap();

    assert_eq!(first_page.projects[0].id, newer_project_id);
    assert_eq!(second_page.projects[0].id, older_project_id);
    assert!(second_page.next_cursor.is_none());
}

#[tokio::test]
async fn task_summary_projects_agent_workflow_and_arena_runtime_truth() {
    let pool = migrated_pool().await;
    let project_id = uuid(1_000);
    let issue_id = uuid(1_001);
    insert_project(&pool, project_id, "Projection project", BASELINE).await;
    insert_issue(&pool, project_id, issue_id, 2).await;

    let agent_task_id = uuid(1_100);
    let agent_workspace_id = uuid(1_101);
    let agent_session_id = uuid(1_102);
    insert_workspace_and_session(
        &pool,
        agent_workspace_id,
        agent_session_id,
        "Running Agent",
        BASELINE,
    )
    .await;
    insert_task(
        &pool,
        agent_task_id,
        project_id,
        issue_id,
        None,
        "Running Agent",
        "agent",
        BASELINE,
    )
    .await;
    bind_agent(&pool, agent_task_id, agent_session_id).await;
    insert_agent_run_state(
        &pool,
        uuid(1_103),
        agent_session_id,
        agent_workspace_id,
        "running",
        AGENT_ACTIVITY,
    )
    .await;

    let workflow_task_id = uuid(1_200);
    let workflow_id = uuid(1_201);
    let workflow_attempt_id = uuid(1_202);
    insert_task(
        &pool,
        workflow_task_id,
        project_id,
        issue_id,
        None,
        "Waiting Workflow",
        "workflow",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, graph_json)
        VALUES (?, 'project', ?, 'Waiting Workflow', '{}')
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workflow_attempts (id, task_id, workflow_id, status)
        VALUES (?, ?, ?, 'awaiting_human')
        "#,
    )
    .bind(workflow_attempt_id)
    .bind(workflow_task_id)
    .bind(workflow_id)
    .execute(&pool)
    .await
    .unwrap();

    let waiting_arena_task_id = uuid(1_300);
    let waiting_arena_group_id = uuid(1_301);
    let waiting_workspace_id = uuid(1_302);
    let waiting_session_id = uuid(1_303);
    insert_task(
        &pool,
        waiting_arena_task_id,
        project_id,
        issue_id,
        None,
        "Waiting Arena",
        "arena",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO arena_groups (id, task_id, prompt, base_branch)
        VALUES (?, ?, 'Compare waiting candidates', 'main')
        "#,
    )
    .bind(waiting_arena_group_id)
    .bind(waiting_arena_task_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_workspace_and_session(
        &pool,
        waiting_workspace_id,
        waiting_session_id,
        "Successful candidate",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO arena_candidates (
            id, arena_group_id, workspace_id, purpose, sort_order
        ) VALUES (?, ?, ?, 'attempt', 0)
        "#,
    )
    .bind(uuid(1_304))
    .bind(waiting_arena_group_id)
    .bind(waiting_workspace_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_agent_run_state(
        &pool,
        uuid(1_305),
        waiting_session_id,
        waiting_workspace_id,
        "succeeded",
        AGENT_ACTIVITY,
    )
    .await;

    let cancelled_arena_task_id = uuid(1_400);
    let cancelled_arena_group_id = uuid(1_401);
    let cancelled_workspace_id = uuid(1_402);
    let cancelled_session_id = uuid(1_403);
    insert_task(
        &pool,
        cancelled_arena_task_id,
        project_id,
        issue_id,
        None,
        "Cancelled Arena",
        "arena",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO arena_groups (id, task_id, prompt, base_branch)
        VALUES (?, ?, 'Compare cancelled candidates', 'main')
        "#,
    )
    .bind(cancelled_arena_group_id)
    .bind(cancelled_arena_task_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_workspace_and_session(
        &pool,
        cancelled_workspace_id,
        cancelled_session_id,
        "Cancelled candidate",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO arena_candidates (
            id, arena_group_id, workspace_id, purpose, sort_order
        ) VALUES (?, ?, ?, 'synthesis', 0)
        "#,
    )
    .bind(uuid(1_404))
    .bind(cancelled_arena_group_id)
    .bind(cancelled_workspace_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_agent_run_state(
        &pool,
        uuid(1_405),
        cancelled_session_id,
        cancelled_workspace_id,
        "cancelled",
        AGENT_ACTIVITY,
    )
    .await;

    let agent = Task::summary_by_id(&pool, agent_task_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(agent.execution_kind, TaskExecutionKind::Agent);
    assert_eq!(agent.status, TaskStatus::Running);
    assert_eq!(
        agent.open_target,
        TaskOpenTarget::Agent {
            session_id: agent_session_id,
            workspace_id: agent_workspace_id,
        }
    );

    let workflow = Task::summary_by_id(&pool, workflow_task_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(workflow.status, TaskStatus::Waiting);
    assert_eq!(
        workflow.open_target,
        TaskOpenTarget::Workflow {
            attempt_id: workflow_attempt_id,
            workflow_id,
            latest_run_id: None,
        }
    );

    let waiting_arena = Task::summary_by_id(&pool, waiting_arena_task_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(waiting_arena.status, TaskStatus::Waiting);
    assert_eq!(
        waiting_arena.open_target,
        TaskOpenTarget::Arena {
            arena_group_id: waiting_arena_group_id,
        }
    );
    let cancelled_arena = Task::summary_by_id(&pool, cancelled_arena_task_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cancelled_arena.status, TaskStatus::Cancelled);

    let invalid_task_id = uuid(1_500);
    insert_task(
        &pool,
        invalid_task_id,
        project_id,
        issue_id,
        None,
        "Missing binding",
        "agent",
        BASELINE,
    )
    .await;
    assert!(matches!(
        Task::summary_by_id(&pool, invalid_task_id).await,
        Err(TaskError::InvalidBinding { task_id, .. }) if task_id == invalid_task_id
    ));
    assert!(
        Task::summary_by_id(&pool, uuid(1_999))
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn runtime_activity_touches_owners_while_reads_and_seen_state_do_not() {
    let pool = migrated_pool().await;
    let project_id = uuid(2_000);
    let issue_id = uuid(2_001);
    let workflow_task_id = uuid(2_100);
    let workflow_id = uuid(2_101);
    let workflow_attempt_id = uuid(2_102);
    let child_task_id = uuid(2_200);
    let workspace_id = uuid(2_201);
    let session_id = uuid(2_202);
    let agent_run_id = uuid(2_203);

    insert_project(&pool, project_id, "Timestamp project", BASELINE).await;
    insert_issue(&pool, project_id, issue_id, 3).await;
    insert_task(
        &pool,
        workflow_task_id,
        project_id,
        issue_id,
        None,
        "Workflow parent",
        "workflow",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, graph_json)
        VALUES (?, 'project', ?, 'Timestamp Workflow', '{}')
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workflow_attempts (
            id, task_id, workflow_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, ?)
        "#,
    )
    .bind(workflow_attempt_id)
    .bind(workflow_task_id)
    .bind(workflow_id)
    .bind(BASELINE)
    .bind(BASELINE)
    .execute(&pool)
    .await
    .unwrap();
    insert_workspace_and_session(&pool, workspace_id, session_id, "Child Agent", BASELINE).await;
    insert_task(
        &pool,
        child_task_id,
        project_id,
        issue_id,
        Some(workflow_task_id),
        "Child Agent",
        "agent",
        BASELINE,
    )
    .await;
    bind_agent(&pool, child_task_id, session_id).await;

    sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
        .bind(BASELINE)
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    insert_agent_run_state(
        &pool,
        agent_run_id,
        session_id,
        workspace_id,
        "running",
        AGENT_ACTIVITY,
    )
    .await;
    assert_eq!(
        updated_at(&pool, "sessions", session_id).await,
        AGENT_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "tasks", child_task_id).await,
        AGENT_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "tasks", workflow_task_id).await,
        AGENT_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "projects", project_id).await,
        AGENT_ACTIVITY
    );

    let before_reads = (
        updated_at(&pool, "sessions", session_id).await,
        updated_at(&pool, "tasks", child_task_id).await,
        updated_at(&pool, "tasks", workflow_task_id).await,
        updated_at(&pool, "projects", project_id).await,
    );
    Project::list_recent(&pool, None, 10).await.unwrap();
    Session::list_recent_task_bound(&pool, Some(project_id), None, 10)
        .await
        .unwrap();
    Task::list_top_level(&pool, project_id, Some(issue_id), None, 10)
        .await
        .unwrap();
    Task::summary_by_id(&pool, child_task_id).await.unwrap();
    sqlx::query("INSERT INTO agent_run_seen (agent_run_id, seen_at) VALUES (?, ?)")
        .bind(agent_run_id)
        .bind(WORKFLOW_ACTIVITY)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        (
            updated_at(&pool, "sessions", session_id).await,
            updated_at(&pool, "tasks", child_task_id).await,
            updated_at(&pool, "tasks", workflow_task_id).await,
            updated_at(&pool, "projects", project_id).await,
        ),
        before_reads
    );

    sqlx::query("UPDATE workflow_attempts SET status = 'running', updated_at = ? WHERE id = ?")
        .bind(WORKFLOW_ACTIVITY)
        .bind(workflow_attempt_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        updated_at(&pool, "tasks", workflow_task_id).await,
        WORKFLOW_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "projects", project_id).await,
        WORKFLOW_ACTIVITY
    );

    let workflow_run_id = uuid(2_300);
    let node_execution_id = uuid(2_301);
    sqlx::query(
        r#"
        INSERT INTO workflow_runs (
            id, workflow_id, issue_id, attempt_id, input_text, status,
            graph_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'input', 'running', '{}', ?, ?)
        "#,
    )
    .bind(workflow_run_id)
    .bind(workflow_id)
    .bind(issue_id)
    .bind(workflow_attempt_id)
    .bind(BASELINE)
    .bind(BASELINE)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO node_executions (
            id, run_id, node_id, node_type, status, session_id, task_id,
            created_at, updated_at
        ) VALUES (?, ?, 'agent-1', 'agent', 'pending', ?, ?, ?, ?)
        "#,
    )
    .bind(node_execution_id)
    .bind(workflow_run_id)
    .bind(session_id)
    .bind(child_task_id)
    .bind(BASELINE)
    .bind(BASELINE)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE node_executions SET status = 'running', updated_at = ? WHERE id = ?")
        .bind(NODE_ACTIVITY)
        .bind(node_execution_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        updated_at(&pool, "tasks", child_task_id).await,
        NODE_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "tasks", workflow_task_id).await,
        NODE_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "projects", project_id).await,
        NODE_ACTIVITY
    );

    let arena_task_id = uuid(2_400);
    let arena_group_id = uuid(2_401);
    let candidate_workspace_id = uuid(2_402);
    let candidate_session_id = uuid(2_403);
    insert_task(
        &pool,
        arena_task_id,
        project_id,
        issue_id,
        None,
        "Arena activity",
        "arena",
        NODE_ACTIVITY,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO arena_groups (
            id, task_id, prompt, base_branch, created_at, updated_at
        ) VALUES (?, ?, 'Compare', 'main', ?, ?)
        "#,
    )
    .bind(arena_group_id)
    .bind(arena_task_id)
    .bind(BASELINE)
    .bind(BASELINE)
    .execute(&pool)
    .await
    .unwrap();
    insert_workspace_and_session(
        &pool,
        candidate_workspace_id,
        candidate_session_id,
        "Arena candidate",
        BASELINE,
    )
    .await;
    sqlx::query(
        r#"
        INSERT INTO arena_candidates (
            id, arena_group_id, workspace_id, purpose, sort_order,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'attempt', 0, ?, ?)
        "#,
    )
    .bind(uuid(2_404))
    .bind(arena_group_id)
    .bind(candidate_workspace_id)
    .bind(BASELINE)
    .bind(ARENA_ACTIVITY)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        updated_at(&pool, "tasks", arena_task_id).await,
        ARENA_ACTIVITY
    );
    assert_eq!(
        updated_at(&pool, "projects", project_id).await,
        ARENA_ACTIVITY
    );

    sqlx::query("UPDATE arena_groups SET lifecycle_status = 'closed', updated_at = ? WHERE id = ?")
        .bind("2026-01-06T00:00:00.000Z")
        .bind(arena_group_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        updated_at(&pool, "tasks", arena_task_id).await,
        "2026-01-06T00:00:00.000Z"
    );
    assert_eq!(
        updated_at(&pool, "projects", project_id).await,
        "2026-01-06T00:00:00.000Z"
    );
}
