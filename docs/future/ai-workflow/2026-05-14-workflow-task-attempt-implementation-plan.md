# Workflow Task Attempt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an issue-level workflow a first-class Task Attempt: a user designs one workflow attempt for an issue, runs it when ready, and inspects each step's agent session without treating the workflow as just a generic workspace.

**Architecture:** Add an issue-bound `workflow_attempts` persistence layer while keeping `workflows` as graph storage for the existing canvas editor and `workflow_runs` as runtime executions. A workflow row referenced by `workflow_attempts.workflow_id` is an attempt-owned backing graph and must be excluded from reusable template/library lists; the issue UI merges existing single-agent workspace attempts and workflow attempts into one Task Attempts surface.

**Tech Stack:** Rust, SQLx, SQLite migrations, ts-rs generated TypeScript, React, TanStack Query, React Flow, Vitest, Playwright.

---

## Scope And Business Contract

This plan implements the product definition:

```text
Issue
  -> Task Attempt
       -> Single Agent Attempt
          -> existing Workspace + Session + ExecutionProcess
       -> Workflow Attempt
          -> issue-bound workflow graph
          -> latest WorkflowRun
          -> shared run Workspace
          -> NodeExecutions with per-node Session/ExecutionProcess links
```

Key decisions:

- Use **Task Attempt** in user-facing issue UI.
- Keep `Workspace` as a backend/runtime container, not the top-level issue business term.
- Keep `Workflow Template` for reusable/project/system graphs.
- Add `Workflow Attempt` as the issue-bound draft/run object.
- Reuse the existing `workflows` table as the canvas backing graph in this increment, but hide attempt-owned workflow rows from template pickers and project workflow lists.
- A workflow attempt can be saved as a draft without creating a workspace.
- A workflow attempt creates or binds the shared workspace only when it runs.
- Each Agent Step still owns its own `Session` and `ExecutionProcess` through `node_executions.session_id` and `node_executions.execution_process_id`.
- Existing single-agent workspaces are not migrated; they are adapted into Task Attempt cards in the UI.

Out of scope:

- Renaming all internal `workspace` code.
- Replacing React Flow.
- Expanding the node catalog.
- Making each workflow node a workspace.
- Full template marketplace/gallery.

## File Structure

Backend files:

- Create: `crates/db/migrations/20260514110000_add_workflow_attempts.sql`
  - Adds `workflow_attempts`, nullable `workflow_runs.attempt_id`, and marks attempt-owned backing workflows through `workflow_attempts.workflow_id`.
- Modify: `crates/db/src/models/workflow.rs`
  - Adds `WorkflowAttemptStatus`, `WorkflowAttempt`, create/update request structs, and generated TS declarations.
- Modify: `crates/server/src/routes/workflows.rs`
  - Adds create/list/get/run workflow attempt API routes and response DTOs.
- Modify: `crates/server/src/workflow_runtime/runner.rs`
  - Adds optional attempt linkage when inserting workflow runs.
- Modify: `crates/server/src/bin/generate_types.rs`
  - Exports new route/model TS declarations.
- Modify: `crates/server/tests/workflow_routes.rs`
  - Adds attempt table test schema and route/runtime tests.
- Generated: `shared/types.ts`
  - Regenerated with `pnpm run generate-types`; do not edit manually.

Frontend files:

- Modify: `packages/web-core/src/shared/lib/workflowApi.ts`
  - Adds workflow attempt API client methods.
- Create: `packages/web-core/src/shared/hooks/useWorkflowAttempts.ts`
  - Adds list/create/run attempt hooks and query invalidation.
- Create: `packages/web-core/src/features/workflow/model/taskAttempt.ts`
  - Defines UI adapter union for single-agent and workflow attempts.
- Create: `packages/web-core/src/features/workflow/model/taskAttempt.test.ts`
  - Tests sorting, labels, and status mapping.
- Modify: `packages/web-core/src/features/workflow/model/issueWorkflow.ts`
  - Updates copy and draft naming for workflow attempts.
- Modify: `packages/web-core/src/features/workflow/model/issueWorkflow.test.ts`
  - Updates expectations for Task Attempt wording.
- Modify: `packages/web-core/src/features/workflow/ui/IssueWorkflowEntryCard.tsx`
  - Reframes the workflow entry as "new workflow attempt" / "open canvas".
- Modify: `packages/web-core/src/features/workflow/ui/RunWorkflowDialog.tsx`
  - Runs workflow attempts instead of arbitrary templates from issue entry.
- Modify: `packages/web-core/src/pages/kanban/IssueWorkflowSectionContainer.tsx`
  - Creates or opens the issue's workflow attempt draft.
- Create: `packages/web-core/src/pages/kanban/IssueTaskAttemptsSectionContainer.tsx`
  - Merges single-agent workspace attempts and workflow attempts for the issue panel.
- Modify: `packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx`
  - Replaces separate workflow/workspace sections with Task Attempts section.
- Modify: `packages/web-core/src/features/kanban/ui/KanbanContainer.tsx`
  - Optional card-level follow-up: continue showing single-agent workspace attempt cards until workflow attempts are available for board cards.
- Create: `packages/ui/src/components/IssueTaskAttemptCard.tsx`
  - Generic issue attempt card for single-agent and workflow attempts.
- Create: `packages/ui/src/components/IssueTaskAttemptsSection.tsx`
  - Collapsible issue panel section titled Task Attempts.
- Modify: `packages/web-core/src/i18n/locales/*/common.json`
  - Adds `attempts.*` copy keys.

Browser test files:

- Modify: `tests/workflow/fixture/src/main.tsx`
  - Adds a Task Attempts harness mode.
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`
  - Adds issue Task Attempt entry, create/open canvas, and run attempt smoke coverage.

---

### Task 1: Add Workflow Attempt Schema

**Files:**
- Create: `crates/db/migrations/20260514110000_add_workflow_attempts.sql`
- Modify: `crates/server/tests/workflow_routes.rs`

- [ ] **Step 1: Write the migration**

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE workflow_attempts (
    id             BLOB PRIMARY KEY,
    project_id     BLOB NOT NULL,
    issue_id       BLOB NOT NULL,
    workflow_id    BLOB NOT NULL,
    latest_run_id  BLOB,
    workspace_id   BLOB,
    name           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN (
                       'draft',
                       'ready',
                       'running',
                       'awaiting_human',
                       'awaiting_arena',
                       'succeeded',
                       'failed',
                       'canceled'
                   )),
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id)    REFERENCES projects(id)       ON DELETE CASCADE,
    FOREIGN KEY (issue_id)      REFERENCES local_issues(id)   ON DELETE CASCADE,
    FOREIGN KEY (workflow_id)   REFERENCES workflows(id)      ON DELETE RESTRICT,
    FOREIGN KEY (latest_run_id) REFERENCES workflow_runs(id)  ON DELETE SET NULL,
    FOREIGN KEY (workspace_id)  REFERENCES workspaces(id)     ON DELETE SET NULL,
    UNIQUE (workflow_id)
);

CREATE INDEX idx_workflow_attempts_issue_id ON workflow_attempts(issue_id);
CREATE INDEX idx_workflow_attempts_project_issue
    ON workflow_attempts(project_id, issue_id);
CREATE INDEX idx_workflow_attempts_workflow_id ON workflow_attempts(workflow_id);
CREATE INDEX idx_workflow_attempts_latest_run_id ON workflow_attempts(latest_run_id);

ALTER TABLE workflow_runs
ADD COLUMN attempt_id BLOB REFERENCES workflow_attempts(id) ON DELETE SET NULL;

CREATE INDEX idx_workflow_runs_attempt_id ON workflow_runs(attempt_id);

PRAGMA foreign_key_check;
```

- [ ] **Step 2: Update the in-memory workflow route test schema**

In `setup_workflow_pool()` in `crates/server/tests/workflow_routes.rs`, add minimal tables/columns needed by the new tests:

```rust
r#"
CREATE TABLE local_issues (
    id BLOB PRIMARY KEY,
    project_id BLOB NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
)
"#,
r#"
CREATE TABLE workflow_attempts (
    id             BLOB PRIMARY KEY,
    project_id     BLOB NOT NULL,
    issue_id       BLOB NOT NULL,
    workflow_id    BLOB NOT NULL,
    latest_run_id  BLOB,
    workspace_id   BLOB,
    name           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft',
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    UNIQUE (workflow_id)
)
"#,
```

Also add `attempt_id BLOB` to the test `workflow_runs` table.

- [ ] **Step 3: Run the focused backend test compile**

Run: `cargo test -p server --test workflow_routes --no-run`

Expected before model/routes exist: FAIL with missing model/route symbols only after later tasks reference them. If this step is run immediately after only the schema change, it should compile.

- [ ] **Step 4: Commit**

```bash
git add crates/db/migrations/20260514110000_add_workflow_attempts.sql crates/server/tests/workflow_routes.rs
git commit -m "feat(workflow): add workflow attempt schema"
```

---

### Task 2: Add Workflow Attempt Rust Models And Generated Types

**Files:**
- Modify: `crates/db/src/models/workflow.rs`
- Modify: `crates/server/src/bin/generate_types.rs`
- Generated: `shared/types.ts`

- [ ] **Step 1: Write model tests for status serialization**

Add to `crates/db/src/models/workflow.rs` tests:

```rust
#[test]
fn workflow_attempt_status_serializes_with_snake_case_names() {
    assert_eq!(
        serde_json::to_string(&WorkflowAttemptStatus::AwaitingHuman).unwrap(),
        r#""awaiting_human""#
    );
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cargo test -p db workflow_attempt_status_serializes_with_snake_case_names`

Expected: FAIL because `WorkflowAttemptStatus` does not exist.

- [ ] **Step 3: Add the workflow attempt structs**

Add near the workflow run status definitions:

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "workflow_attempt_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum WorkflowAttemptStatus {
    #[default]
    Draft,
    Ready,
    Running,
    AwaitingHuman,
    AwaitingArena,
    Succeeded,
    Failed,
    Canceled,
}
```

Add after `WorkflowRun`:

```rust
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowAttempt {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub workflow_id: Uuid,
    pub latest_run_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub name: String,
    pub status: WorkflowAttemptStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflowAttempt {
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub workflow_id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateWorkflowAttemptRuntime {
    pub latest_run_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub status: WorkflowAttemptStatus,
}
```

Add nullable attempt linkage to `WorkflowRun` and create model:

```rust
pub attempt_id: Option<Uuid>,
```

- [ ] **Step 4: Export TS declarations**

In `crates/server/src/bin/generate_types.rs`, include:

```rust
db::models::workflow::WorkflowAttempt::decl(),
db::models::workflow::WorkflowAttemptStatus::decl(),
db::models::workflow::CreateWorkflowAttempt::decl(),
db::models::workflow::UpdateWorkflowAttemptRuntime::decl(),
```

Also export route DTOs added in Task 3 once those exist.

- [ ] **Step 5: Run model tests**

Run: `cargo test -p db workflow_attempt_status_serializes_with_snake_case_names`

Expected: PASS.

- [ ] **Step 6: Regenerate shared types**

Run: `pnpm run generate-types`

Expected: `shared/types.ts` includes `WorkflowAttempt`, `WorkflowAttemptStatus`, `CreateWorkflowAttempt`, and `UpdateWorkflowAttemptRuntime`.

- [ ] **Step 7: Commit**

```bash
git add crates/db/src/models/workflow.rs crates/server/src/bin/generate_types.rs shared/types.ts
git commit -m "feat(workflow): add workflow attempt models"
```

---

### Task 3: Add Workflow Attempt API Routes

**Files:**
- Modify: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/tests/workflow_routes.rs`
- Modify: `crates/server/src/bin/generate_types.rs`
- Generated: `shared/types.ts`

- [ ] **Step 1: Write route tests first**

Add helpers in `crates/server/tests/workflow_routes.rs`:

```rust
async fn insert_local_issue(pool: &SqlitePool, project_id: Uuid, issue_id: Uuid, title: &str) {
    sqlx::query("INSERT INTO local_issues (id, project_id, title) VALUES (?, ?, ?)")
        .bind(issue_id)
        .bind(project_id)
        .bind(title)
        .execute(pool)
        .await
        .expect("insert local issue");
}
```

Add a test:

```rust
#[tokio::test]
async fn create_workflow_attempt_creates_issue_bound_draft() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Build attempt model").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Workflow attempt".to_string()),
            graph_json: valid_graph_json(),
        },
    )
    .await
    .expect("create workflow attempt");

    assert_eq!(attempt.project_id, project_id);
    assert_eq!(attempt.issue_id, issue_id);
    assert_eq!(attempt.status, WorkflowAttemptStatus::Draft);
    assert!(attempt.latest_run_id.is_none());
    assert!(attempt.workspace_id.is_none());
}
```

Add route/helper coverage for list/get, issue validation, and template-list exclusion:

```rust
#[tokio::test]
async fn list_project_workflows_excludes_attempt_owned_backing_workflows() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Draft hidden attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Hidden attempt graph".to_string()),
            graph_json: valid_graph_json(),
        },
    )
    .await
    .expect("create workflow attempt");

    let workflows = list_project_workflows(&pool, project_id)
        .await
        .expect("list workflows");

    assert!(
        workflows.iter().all(|workflow| workflow.id != attempt.workflow_id),
        "attempt-owned backing graph must not appear as reusable template"
    );
}

#[tokio::test]
async fn workflow_attempt_create_rejects_issue_from_another_project() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let other_project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_project(&pool, other_project_id).await;
    insert_local_issue(&pool, other_project_id, issue_id, "Wrong project").await;

    let err = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Invalid".to_string()),
            graph_json: valid_graph_json(),
        },
    )
    .await
    .expect_err("issue must belong to project");

    assert!(err.to_string().contains("Issue not found for project"));
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cargo test -p server --test workflow_routes create_workflow_attempt_creates_issue_bound_draft`

Expected: FAIL with missing `CreateWorkflowAttemptRequest`, `WorkflowAttemptStatus`, or `create_issue_workflow_attempt`.

- [ ] **Step 3: Add route DTOs**

In `crates/server/src/routes/workflows.rs`:

```rust
#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflowAttemptRequest {
    pub name: Option<String>,
    pub graph_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowAttemptResponse {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub workflow_id: Uuid,
    pub latest_run_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub name: String,
    pub status: WorkflowAttemptStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowAttemptListResponse {
    pub attempts: Vec<WorkflowAttemptResponse>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct RunWorkflowAttemptRequest {
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
}
```

- [ ] **Step 4: Add routes**

Extend `router()`:

```rust
.route(
    "/v1/projects/{project_id}/issues/{issue_id}/workflow-attempts",
    get(list_issue_workflow_attempts).post(create_workflow_attempt),
)
.route(
    "/v1/workflow-attempts/{attempt_id}",
    get(get_workflow_attempt),
)
```

Do not add the `/run` route in this task. Task 3 must compile with create/list/get only; Task 4 adds run behavior and the route in the same commit.

- [ ] **Step 5: Implement issue/project validation helper**

```rust
async fn ensure_issue_belongs_to_project(
    pool: &SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<(), ApiError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM local_issues WHERE id = ? AND project_id = ?",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_one(pool)
    .await?;

    if count == 0 {
        return Err(ApiError::BadRequest("Issue not found for project".to_string()));
    }

    Ok(())
}
```

- [ ] **Step 6: Implement create/list/get helpers**

Keep SQL in `routes/workflows.rs` for this increment. Do not introduce a separate repository module unless this file becomes too hard to review.

Core create flow:

```rust
pub async fn create_issue_workflow_attempt(
    pool: &SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
    request: CreateWorkflowAttemptRequest,
) -> Result<WorkflowAttemptResponse, ApiError> {
    ensure_project_exists(pool, project_id).await?;
    ensure_issue_belongs_to_project(pool, project_id, issue_id).await?;
    validate_graph_json(&request.graph_json)?;

    let name = request
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Workflow attempt".to_string());

    let workflow = create_project_workflow(
        pool,
        project_id,
        CreateWorkflowRequest {
            name: name.clone(),
            description: Some(
                "Issue-bound workflow attempt backing graph. Hidden from template lists.".to_string(),
            ),
            graph_json: request.graph_json,
        },
    )
    .await?;

    let attempt_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workflow_attempts
            (id, project_id, issue_id, workflow_id, name, status)
        VALUES (?, ?, ?, ?, ?, 'draft')
        "#,
    )
    .bind(attempt_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(workflow.id)
    .bind(name)
    .execute(pool)
    .await?;

    workflow_attempt_by_id(pool, attempt_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow attempt not found after create".to_string()))
}
```

Update `list_project_workflows` and `list_all_workflows` to exclude attempt-owned backing workflows:

```sql
WHERE (source = 'system' OR project_id = ?)
  AND id NOT IN (SELECT workflow_id FROM workflow_attempts)
```

For `list_all_workflows`, add:

```sql
WHERE id NOT IN (SELECT workflow_id FROM workflow_attempts)
```

This keeps issue workflow attempts out of `Run existing workflow` and the project workflow library, avoiding duplicate `Workflow for ...` choices.

- [ ] **Step 7: Export route DTO types**

In `crates/server/src/bin/generate_types.rs`, export:

```rust
server::routes::workflows::CreateWorkflowAttemptRequest::decl(),
server::routes::workflows::WorkflowAttemptResponse::decl(),
server::routes::workflows::WorkflowAttemptListResponse::decl(),
server::routes::workflows::RunWorkflowAttemptRequest::decl(),
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
cargo test -p server --test workflow_routes create_workflow_attempt_creates_issue_bound_draft
cargo test -p server --test workflow_routes list_project_workflows_excludes_attempt_owned_backing_workflows
cargo test -p server --test workflow_routes workflow_attempt_create_rejects_issue_from_another_project
```

Expected: PASS.

- [ ] **Step 9: Regenerate shared types**

Run: `pnpm run generate-types`

Expected: `shared/types.ts` includes the new route DTOs.

- [ ] **Step 10: Commit**

```bash
git add crates/server/src/routes/workflows.rs crates/server/tests/workflow_routes.rs crates/server/src/bin/generate_types.rs shared/types.ts
git commit -m "feat(workflow): add issue workflow attempt routes"
```

---

### Task 4: Link Workflow Runs To Attempts

**Files:**
- Modify: `crates/server/src/workflow_runtime/runner.rs`
- Modify: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/tests/workflow_routes.rs`
- Modify: `crates/db/src/models/workflow.rs`
- Generated: `shared/types.ts`

- [ ] **Step 1: Write a run-linking test**

Add to `crates/server/tests/workflow_routes.rs`:

```rust
#[tokio::test]
async fn running_workflow_attempt_updates_latest_run_workspace_and_status() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Run workflow attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Attempt run".to_string()),
            graph_json: valid_graph_json(),
        },
    )
    .await
    .expect("create workflow attempt");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(Uuid::new_v4(), "unused");
    let run = run_workflow_attempt_runtime(
        &pool,
        attempt.id,
        RunWorkflowAttemptRequest {
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Implement by workflow".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("run workflow attempt");

    assert_eq!(run.attempt_id, Some(attempt.id));
    let refreshed = workflow_attempt_by_id(&pool, attempt.id)
        .await
        .expect("query attempt")
        .expect("attempt exists");
    assert_eq!(refreshed.latest_run_id, Some(run.id));
    assert_eq!(refreshed.workspace_id, Some(workspace_id));
    assert_eq!(refreshed.status, WorkflowAttemptStatus::Succeeded);
}
```

Add status sync tests for runtime mutations:

```rust
#[tokio::test]
async fn canceling_workflow_attempt_syncs_attempt_status() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Cancel workflow attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Cancel attempt".to_string()),
            graph_json: agent_graph_json(),
        },
    )
    .await
    .expect("create workflow attempt");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = StartedAgentExecutor::new(session_id);
    let running = run_workflow_attempt_runtime(
        &pool,
        attempt.id,
        RunWorkflowAttemptRequest {
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Long task".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("run workflow attempt");

    let canceller = FakeRunCanceller::default();
    let canceled = cancel_workflow_run_runtime(&pool, running.id, &canceller)
        .await
        .expect("cancel workflow run");
    sync_attempt_from_run(&pool, &canceled).await.expect("sync attempt");

    let refreshed = workflow_attempt_by_id(&pool, attempt.id)
        .await
        .expect("query attempt")
        .expect("attempt exists");
    assert_eq!(refreshed.status, WorkflowAttemptStatus::Canceled);
    assert_eq!(refreshed.latest_run_id, Some(running.id));
}

#[tokio::test]
async fn recovery_syncs_attempt_status_for_stale_running_run() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let node_execution_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Recover attempt").await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Recover Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert workflow");

    sqlx::query(
        r#"
        INSERT INTO workflow_attempts
            (id, project_id, issue_id, workflow_id, name, status)
        VALUES (?, ?, ?, ?, 'Recover attempt', 'running')
        "#,
    )
    .bind(attempt_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(workflow_id)
    .execute(&pool)
    .await
    .expect("insert attempt");

    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, attempt_id, issue_id, workspace_id, trigger_source, input_text, status)
        VALUES (?, ?, ?, ?, NULL, 'manual', 'Recover this', 'running')
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(attempt_id)
    .bind(issue_id)
    .execute(&pool)
    .await
    .expect("insert run");

    sqlx::query(
        "UPDATE workflow_attempts SET latest_run_id = ? WHERE id = ?",
    )
    .bind(run_id)
    .bind(attempt_id)
    .execute(&pool)
    .await
    .expect("link attempt latest run");

    sqlx::query(
        r#"
        INSERT INTO node_executions (id, run_id, node_id, node_type, iteration, status)
        VALUES (?, ?, 'agent', 'agent', 0, 'running')
        "#,
    )
    .bind(node_execution_id)
    .bind(run_id)
    .execute(&pool)
    .await
    .expect("insert stale node");

    let recovered = recover_stale_workflow_runs(&pool)
        .await
        .expect("recover stale workflow runs");
    assert_eq!(recovered, 1);

    let attempt_status: String =
        sqlx::query_scalar("SELECT status FROM workflow_attempts WHERE id = ?")
            .bind(attempt_id)
            .fetch_one(&pool)
            .await
            .expect("fetch attempt status");
    assert_eq!(attempt_status, "failed");
}
```

The recovery test mirrors the existing stale workflow recovery setup and must assert `workflow_attempts.status = 'failed'`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `cargo test -p server --test workflow_routes running_workflow_attempt_updates_latest_run_workspace_and_status`

Expected: FAIL with missing `attempt_id` response field or runtime helper.

- [ ] **Step 3: Add `attempt_id` to run DTOs and SQL**

In `WorkflowRunResponse` and fallback row structs in `crates/server/src/routes/workflows.rs`, add:

```rust
pub attempt_id: Option<Uuid>,
```

Update all `SELECT` queries from `workflow_runs`:

```sql
SELECT id, workflow_id, attempt_id, issue_id, workspace_id, ...
```

Update row conversion:

```rust
attempt_id: row.try_get("attempt_id")?,
```

Update `crates/db/src/models/workflow.rs` `WorkflowRun` and `CreateWorkflowRun` with `attempt_id: Option<Uuid>`.

- [ ] **Step 4: Change insert runtime to accept attempt id**

In `crates/server/src/workflow_runtime/runner.rs`, update `insert_workflow_run`:

```rust
async fn insert_workflow_run(
    pool: &SqlitePool,
    run_id: Uuid,
    workflow_id: Uuid,
    attempt_id: Option<Uuid>,
    workspace_id: Uuid,
    request: &TriggerWorkflowRequest,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, attempt_id, issue_id, workspace_id, trigger_source, input_text, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', datetime('now', 'subsec'))
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(attempt_id)
    .bind(request.issue_id)
    .bind(workspace_id)
    .bind(&request.trigger_source)
    .bind(&request.input_text)
    .execute(pool)
    .await?;

    Ok(())
}
```

Keep existing `trigger_workflow_run_with_arena` behavior by passing `None`.

- [ ] **Step 5: Add the run route in the same task as runtime support**

Extend `router()` now that `run_workflow_attempt` exists:

```rust
.route(
    "/v1/workflow-attempts/{attempt_id}/run",
    post(run_workflow_attempt),
)
```

The route handler should construct the deployment resolver/executor exactly like `trigger_workflow`, then call `run_workflow_attempt_runtime`.

- [ ] **Step 6: Add attempt-specific runtime wrapper**

In `routes/workflows.rs`, implement the route handler using a helper in `runner.rs` or local route helper:

```rust
pub async fn run_workflow_attempt_runtime<W, A>(
    pool: &SqlitePool,
    attempt_id: Uuid,
    request: RunWorkflowAttemptRequest,
    workspace_resolver: &W,
    agent_executor: &A,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
{
    let attempt = workflow_attempt_by_id(pool, attempt_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow attempt not found".to_string()))?;

    let run = trigger_workflow_run_for_attempt(
        pool,
        attempt.workflow_id,
        Some(attempt.id),
        TriggerWorkflowRequest {
            issue_id: attempt.issue_id,
            workspace_id: request.workspace_id,
            trigger_source: request.trigger_source,
            input_text: request.input_text,
        },
        workspace_resolver,
        agent_executor,
    )
    .await?;

    update_workflow_attempt_runtime(
        pool,
        attempt.id,
        Some(run.id),
        run.workspace_id,
        workflow_attempt_status_from_run(run.status),
    )
    .await?;

    get_workflow_run_response(pool, run.id).await
}
```

`trigger_workflow_run_for_attempt` can be a small internal variant of existing `trigger_workflow_run_with_arena` that passes `attempt_id` into `insert_workflow_run`.

- [ ] **Step 7: Keep attempt status synced after async reconciliation**

When `get_workflow_run`, `workflow_run_events`, cancel, approve, reject, retry, or arena-winner routes reconcile or mutate a run, update the linked attempt when `run.attempt_id` is present. Do this immediately in the route handlers after they receive the latest `WorkflowRunResponse`.

```rust
pub async fn sync_attempt_from_run(
    pool: &SqlitePool,
    run: &WorkflowRunResponse,
) -> Result<(), ApiError> {
    if let Some(attempt_id) = run.attempt_id {
        update_workflow_attempt_runtime(
            pool,
            attempt_id,
            Some(run.id),
            run.workspace_id,
            workflow_attempt_status_from_run(run.status),
        )
        .await?;
    }
    Ok(())
}
```

Use the returned run from reconciliation. For example, `workflow_run_events` currently reconciles before subscribing; preserve the returned value and sync it:

```rust
let run = reconcile_workflow_run_with_arena(
    &deployment.db().pool,
    run_id,
    &agent_executor,
    &arena_creator,
)
.await?;
sync_attempt_from_run(&deployment.db().pool, &run).await?;
```

Also call `sync_attempt_from_run` inside `recover_stale_workflow_runs` after a run is marked failed, or factor the recovery update SQL so it updates `workflow_attempts` in the same recovery pass:

```sql
UPDATE workflow_attempts
SET status = 'failed',
    updated_at = datetime('now', 'subsec')
WHERE latest_run_id = ?
   OR id = (SELECT attempt_id FROM workflow_runs WHERE id = ?)
```

This prevents attempts from staying `running` after server startup recovery.

- [ ] **Step 8: Add route-level API tests**

Add Axum or direct handler tests that prove:

- `POST /v1/projects/{project_id}/issues/{issue_id}/workflow-attempts` creates a draft without workspace creation.
- `GET /v1/projects/{project_id}/issues/{issue_id}/workflow-attempts` returns only attempts for that issue.
- `GET /v1/workflow-attempts/{attempt_id}` returns the attempt by id.
- `POST /v1/workflow-attempts/{attempt_id}/run` creates a run with `attempt_id`.
- Attempt-owned backing workflows are not returned by `/v1/projects/{project_id}/workflows`.

If the existing test harness makes full router requests too expensive, keep direct handler/helper tests but name the missing router coverage in the test comments and add one route smoke test for the new `/run` route.

- [ ] **Step 9: Run focused tests**

Run:

```bash
cargo test -p server --test workflow_routes running_workflow_attempt_updates_latest_run_workspace_and_status
cargo test -p server --test workflow_routes canceling_workflow_attempt_syncs_attempt_status
cargo test -p server --test workflow_routes recovery_syncs_attempt_status_for_stale_running_run
```

Expected: PASS.

- [ ] **Step 10: Regenerate types and run route tests**

Run:

```bash
pnpm run generate-types
cargo test -p server --test workflow_routes
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add crates/server/src/workflow_runtime/runner.rs crates/server/src/routes/workflows.rs crates/server/tests/workflow_routes.rs crates/db/src/models/workflow.rs shared/types.ts
git commit -m "feat(workflow): link runs to task attempts"
```

---

### Task 5: Add Frontend Workflow Attempt API And Hooks

**Files:**
- Modify: `packages/web-core/src/shared/lib/workflowApi.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowAttempts.ts`

- [ ] **Step 1: Add API client types and methods**

In `workflowApi.ts`, import new generated types:

```ts
import type {
  CreateWorkflowAttemptRequest,
  WorkflowAttemptListResponse,
  WorkflowAttemptResponse,
  RunWorkflowAttemptRequest,
} from 'shared/types';
```

Add methods:

```ts
async listAttempts(
  projectId: string,
  issueId: string
): Promise<WorkflowAttemptListResponse> {
  return getJson(
    await localFetch(`/projects/${projectId}/issues/${issueId}/workflow-attempts`),
    'Failed to list workflow attempts'
  );
},

async createAttempt(
  projectId: string,
  issueId: string,
  payload: CreateWorkflowAttemptRequest
): Promise<WorkflowAttemptResponse> {
  return mutate(
    await localFetch(`/projects/${projectId}/issues/${issueId}/workflow-attempts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    'Failed to create workflow attempt'
  );
},

async getAttempt(attemptId: string): Promise<WorkflowAttemptResponse> {
  return getJson(
    await localFetch(`/workflow-attempts/${attemptId}`),
    'Failed to get workflow attempt'
  );
},

async runAttempt(
  attemptId: string,
  payload: RunWorkflowAttemptRequest
): Promise<WorkflowRunResponse> {
  return mutate(
    await localFetch(`/workflow-attempts/${attemptId}/run`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    'Failed to run workflow attempt'
  );
},
```

- [ ] **Step 2: Add query keys and hooks**

Create `useWorkflowAttempts.ts`:

```ts
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { workflowApi } from '@/shared/lib/workflowApi';
import type {
  CreateWorkflowAttemptRequest,
  RunWorkflowAttemptRequest,
  WorkflowAttemptListResponse,
} from 'shared/types';
import { workflowRunQueryKeys } from './useWorkflowRun';
import { workflowTemplateQueryKeys } from './useWorkflowTemplates';

export const workflowAttemptQueryKeys = {
  all: ['workflow-attempts'] as const,
  issue: (projectId: string, issueId: string) =>
    ['workflow-attempts', 'project', projectId, 'issue', issueId] as const,
  detail: (attemptId: string) =>
    ['workflow-attempts', 'detail', attemptId] as const,
};

export function useWorkflowAttempts(
  projectId: string | null | undefined,
  issueId: string | null | undefined,
  options: { enabled?: boolean } = {}
): UseQueryResult<WorkflowAttemptListResponse> {
  const { enabled = true } = options;

  return useQuery({
    queryKey:
      projectId && issueId
        ? workflowAttemptQueryKeys.issue(projectId, issueId)
        : ['workflow-attempts', 'noop'],
    queryFn: () => workflowApi.listAttempts(projectId as string, issueId as string),
    enabled: !!projectId && !!issueId && enabled,
  });
}

export function useWorkflowAttemptMutations() {
  const queryClient = useQueryClient();

  const createAttemptMutation = useMutation({
    mutationFn: ({
      projectId,
      issueId,
      payload,
    }: {
      projectId: string;
      issueId: string;
      payload: CreateWorkflowAttemptRequest;
    }) => workflowApi.createAttempt(projectId, issueId, payload),
    onSuccess: (attempt, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.issue(
          variables.projectId,
          variables.issueId
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.list(variables.projectId),
      });
      queryClient.setQueryData(workflowAttemptQueryKeys.detail(attempt.id), attempt);
    },
  });

  const runAttemptMutation = useMutation({
    mutationFn: ({
      attemptId,
      payload,
    }: {
      attemptId: string;
      payload: RunWorkflowAttemptRequest;
    }) => workflowApi.runAttempt(attemptId, payload),
    onSuccess: (run) => {
      queryClient.setQueryData(workflowRunQueryKeys.detail(run.id), run);
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.all,
      });
    },
  });

  return {
    createAttempt: createAttemptMutation.mutateAsync,
    isCreatingAttempt: createAttemptMutation.isPending,
    runAttempt: runAttemptMutation.mutateAsync,
    isRunningAttempt: runAttemptMutation.isPending,
  };
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm --filter @vibe/web-core run check`

Expected: PASS after generated `shared/types.ts` exists.

- [ ] **Step 4: Commit**

```bash
git add packages/web-core/src/shared/lib/workflowApi.ts packages/web-core/src/shared/hooks/useWorkflowAttempts.ts
git commit -m "feat(workflow): add workflow attempt client hooks"
```

---

### Task 6: Add Task Attempt View Model

**Files:**
- Create: `packages/web-core/src/features/workflow/model/taskAttempt.ts`
- Create: `packages/web-core/src/features/workflow/model/taskAttempt.test.ts`

- [ ] **Step 1: Write view-model tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildTaskAttempts } from './taskAttempt';

describe('task attempt view model', () => {
  it('merges single-agent and workflow attempts newest first', () => {
    const attempts = buildTaskAttempts({
      workspaceAttempts: [
        {
          id: 'remote-workspace-1',
          localWorkspaceId: 'workspace-1',
          name: 'Codex try',
          archived: false,
          updatedAt: '2026-05-14T01:00:00Z',
          latestProcessStatus: 'completed',
          filesChanged: 2,
          linesAdded: 10,
          linesRemoved: 1,
          prs: [],
          owner: null,
          isOwnedByCurrentUser: true,
        },
      ],
      workflowAttempts: [
        {
          id: 'workflow-attempt-1',
          project_id: 'project-1',
          issue_id: 'issue-1',
          workflow_id: 'workflow-1',
          latest_run_id: 'run-1',
          workspace_id: 'workspace-2',
          name: 'Plan -> Implement',
          status: 'running',
          created_at: '2026-05-14T00:00:00Z',
          updated_at: '2026-05-14T02:00:00Z',
        },
      ],
    });

    expect(attempts.map((attempt) => attempt.id)).toEqual([
      'workflow-attempt-1',
      'remote-workspace-1',
    ]);
    expect(attempts[0]).toMatchObject({
      kind: 'workflow',
      title: 'Plan -> Implement',
      statusLabel: 'Running',
      primaryActionLabel: 'Open canvas',
    });
    expect(attempts[1]).toMatchObject({
      kind: 'single_agent',
      title: 'Codex try',
      statusLabel: 'Completed',
      primaryActionLabel: 'Open session',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run packages/web-core/src/features/workflow/model/taskAttempt.test.ts`

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Implement the view model**

```ts
import type { WorkflowAttemptResponse } from 'shared/types';
import type { WorkspaceWithStats } from '@vibe/ui/components/IssueWorkspaceCard';

export type TaskAttemptKind = 'single_agent' | 'workflow';
export type TaskAttemptStatusTone =
  | 'draft'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'neutral';

export interface TaskAttemptView {
  id: string;
  kind: TaskAttemptKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: TaskAttemptStatusTone;
  updatedAt: string;
  primaryActionLabel: string;
  localWorkspaceId?: string | null;
  workflowId?: string;
  workflowAttemptId?: string;
  latestRunId?: string | null;
  workspaceId?: string | null;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface BuildTaskAttemptsInput {
  workspaceAttempts: WorkspaceWithStats[];
  workflowAttempts: WorkflowAttemptResponse[];
}

export function buildTaskAttempts({
  workspaceAttempts,
  workflowAttempts,
}: BuildTaskAttemptsInput): TaskAttemptView[] {
  return [
    ...workflowAttempts.map(workflowAttemptToTaskAttempt),
    ...workspaceAttempts.map(workspaceToTaskAttempt),
  ].sort((left, right) => {
    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
}

function workflowAttemptToTaskAttempt(
  attempt: WorkflowAttemptResponse
): TaskAttemptView {
  return {
    id: attempt.id,
    kind: 'workflow',
    title: attempt.name || 'Workflow attempt',
    subtitle: attempt.latest_run_id
      ? `Run ${attempt.latest_run_id.slice(0, 8)}`
      : 'Draft workflow attempt',
    statusLabel: workflowAttemptStatusLabel(attempt.status),
    statusTone: workflowAttemptStatusTone(attempt.status),
    updatedAt: attempt.updated_at,
    primaryActionLabel: attempt.latest_run_id ? 'Open run' : 'Open canvas',
    workflowId: attempt.workflow_id,
    workflowAttemptId: attempt.id,
    latestRunId: attempt.latest_run_id,
    workspaceId: attempt.workspace_id,
  };
}

function workspaceToTaskAttempt(workspace: WorkspaceWithStats): TaskAttemptView {
  return {
    id: workspace.id,
    kind: 'single_agent',
    title: workspace.name || 'Single agent attempt',
    subtitle: workspace.localWorkspaceId
      ? `Workspace ${workspace.localWorkspaceId.slice(0, 8)}`
      : 'Remote workspace',
    statusLabel: workspaceStatusLabel(workspace),
    statusTone: workspaceStatusTone(workspace),
    updatedAt: workspace.latestProcessCompletedAt ?? workspace.updatedAt,
    primaryActionLabel: 'Open session',
    localWorkspaceId: workspace.localWorkspaceId,
    filesChanged: workspace.filesChanged,
    linesAdded: workspace.linesAdded,
    linesRemoved: workspace.linesRemoved,
  };
}
```

Complete status helpers in the same file with exhaustive switch statements.

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run packages/web-core/src/features/workflow/model/taskAttempt.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-core/src/features/workflow/model/taskAttempt.ts packages/web-core/src/features/workflow/model/taskAttempt.test.ts
git commit -m "feat(workflow): add task attempt view model"
```

---

### Task 7: Add Task Attempt UI Components

**Files:**
- Create: `packages/ui/src/components/IssueTaskAttemptCard.tsx`
- Create: `packages/ui/src/components/IssueTaskAttemptsSection.tsx`
- Modify: `packages/web-core/src/i18n/locales/en/common.json`
- Modify: `packages/web-core/src/i18n/locales/zh-Hans/common.json`
- Modify: other locale `common.json` files with English fallback strings if localization is not ready.

- [ ] **Step 1: Write minimal component expectations in Playwright fixture later**

No Vitest component harness currently exists for `packages/ui`. This task is verified by TypeScript and the Playwright harness in Task 11.

- [ ] **Step 2: Implement card props**

Create `IssueTaskAttemptCard.tsx`:

```tsx
import { GitBranch, MessageSquare, Play, Workflow } from 'lucide-react';
import { cn } from '../lib/cn';

export type IssueTaskAttemptKind = 'single_agent' | 'workflow';
export type IssueTaskAttemptStatusTone =
  | 'draft'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'neutral';

export interface IssueTaskAttemptCardData {
  id: string;
  kind: IssueTaskAttemptKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: IssueTaskAttemptStatusTone;
  updatedAt: string;
  primaryActionLabel: string;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface IssueTaskAttemptCardProps {
  attempt: IssueTaskAttemptCardData;
  onOpen?: () => void;
  onRun?: () => void;
}

const toneClasses: Record<IssueTaskAttemptStatusTone, string> = {
  draft: 'bg-secondary text-low',
  running: 'bg-brand/10 text-brand',
  waiting: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  canceled: 'bg-secondary text-low',
  neutral: 'bg-secondary text-low',
};

export function IssueTaskAttemptCard({
  attempt,
  onOpen,
  onRun,
}: IssueTaskAttemptCardProps) {
  const Icon = attempt.kind === 'workflow' ? Workflow : MessageSquare;

  return (
    <div
      data-testid={`task-attempt-${attempt.id}`}
      className="flex flex-col gap-half rounded-sm bg-panel p-base transition-colors hover:bg-secondary/70"
    >
      <div className="flex items-center justify-between gap-base">
        <div className="flex min-w-0 items-center gap-half">
          <Icon className="h-4 w-4 shrink-0 text-brand" />
          <span className="truncate text-sm text-high">{attempt.title}</span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
            toneClasses[attempt.statusTone]
          )}
        >
          {attempt.statusLabel}
        </span>
      </div>

      <div className="flex items-center justify-between gap-base">
        <span className="min-w-0 truncate text-xs text-low">
          {attempt.subtitle}
        </span>
        <div className="flex shrink-0 items-center gap-half">
          {onRun && (
            <button
              type="button"
              onClick={onRun}
              className="rounded-sm border border-secondary bg-primary p-half text-low hover:text-high"
              aria-label="Run workflow attempt"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            disabled={!onOpen}
            className="inline-flex h-8 items-center gap-half rounded-sm bg-brand-secondary px-base text-xs font-medium text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>{attempt.primaryActionLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement section component**

Create `IssueTaskAttemptsSection.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import {
  CollapsibleSectionHeader,
  type SectionAction,
} from './CollapsibleSectionHeader';
import {
  IssueTaskAttemptCard,
  type IssueTaskAttemptCardData,
} from './IssueTaskAttemptCard';

export interface IssueTaskAttemptsSectionProps {
  attempts: IssueTaskAttemptCardData[];
  isLoading?: boolean;
  actions?: SectionAction[];
  onOpenAttempt?: (attempt: IssueTaskAttemptCardData) => void;
  onRunAttempt?: (attempt: IssueTaskAttemptCardData) => void;
  onCreateAttempt?: () => void;
}

export function IssueTaskAttemptsSection({
  attempts,
  isLoading,
  actions = [],
  onOpenAttempt,
  onRunAttempt,
  onCreateAttempt,
}: IssueTaskAttemptsSectionProps) {
  const { t } = useTranslation('common');

  return (
    <CollapsibleSectionHeader
      title={t('attempts.title', 'Task Attempts')}
      persistKey="kanban-issue-task-attempts"
      defaultExpanded={true}
      actions={actions}
    >
      <div className="flex flex-col gap-base border-t p-base px-base">
        {isLoading ? (
          <p className="py-half text-low">
            {t('attempts.loading', 'Loading attempts...')}
          </p>
        ) : attempts.length === 0 ? (
          <button
            type="button"
            onClick={onCreateAttempt}
            className="rounded-sm border border-dashed border-border bg-panel p-base text-left text-sm text-low hover:bg-secondary/70"
          >
            {t('attempts.empty', 'Create a task attempt to solve this issue.')}
          </button>
        ) : (
          attempts.map((attempt) => (
            <IssueTaskAttemptCard
              key={attempt.id}
              attempt={attempt}
              onOpen={() => onOpenAttempt?.(attempt)}
              onRun={
                attempt.kind === 'workflow'
                  ? () => onRunAttempt?.(attempt)
                  : undefined
              }
            />
          ))
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
```

- [ ] **Step 4: Add i18n keys**

Add to each `common.json`:

```json
{
  "attempts": {
    "title": "Task Attempts",
    "loading": "Loading attempts...",
    "empty": "Create a task attempt to solve this issue.",
    "newWorkflow": "New workflow attempt",
    "newSingleAgent": "New single-agent attempt"
  }
}
```

For `zh-Hans/common.json`:

```json
{
  "attempts": {
    "title": "\u4efb\u52a1\u5c1d\u8bd5",
    "loading": "\u6b63\u5728\u52a0\u8f7d\u4efb\u52a1\u5c1d\u8bd5...",
    "empty": "\u521b\u5efa\u4e00\u6b21\u4efb\u52a1\u5c1d\u8bd5\u6765\u89e3\u51b3\u8fd9\u4e2a Issue\u3002",
    "newWorkflow": "\u65b0\u5efa\u5de5\u4f5c\u6d41\u5c1d\u8bd5",
    "newSingleAgent": "\u65b0\u5efa\u5355\u667a\u80fd\u4f53\u5c1d\u8bd5"
  }
}
```

- [ ] **Step 5: Run UI TypeScript check**

Run: `pnpm --filter @vibe/ui run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/IssueTaskAttemptCard.tsx packages/ui/src/components/IssueTaskAttemptsSection.tsx packages/web-core/src/i18n/locales
git commit -m "feat(workflow): add task attempt issue UI"
```

---

### Task 8: Replace Issue Workflow/Workspace Sections With Task Attempts

**Files:**
- Create: `packages/web-core/src/pages/kanban/IssueTaskAttemptsSectionContainer.tsx`
- Modify: `packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx`
- Modify: `packages/web-core/src/pages/kanban/IssueWorkflowSectionContainer.tsx`
- Modify: `packages/web-core/src/features/workflow/model/issueWorkflow.ts`
- Modify: `packages/web-core/src/features/workflow/model/issueWorkflow.test.ts`

- [ ] **Step 1: Update issue workflow copy tests**

In `issueWorkflow.test.ts`, replace canvas-first copy expectations:

```ts
it('presents workflow as an issue task attempt', () => {
  expect(ISSUE_WORKFLOW_ENTRY_COPY.title).toBe('Workflow attempt');
  expect(ISSUE_WORKFLOW_ENTRY_COPY.primaryActionLabel).toBe('Open canvas');
  expect(ISSUE_WORKFLOW_ENTRY_COPY.secondaryActionLabel).toBe('Run attempt');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run packages/web-core/src/features/workflow/model/issueWorkflow.test.ts`

Expected: FAIL until copy is updated.

- [ ] **Step 3: Update issue workflow helper copy**

In `issueWorkflow.ts`:

```ts
export const ISSUE_WORKFLOW_ENTRY_COPY = {
  title: 'Workflow attempt',
  subtitle: 'Design the task attempt before running agents',
  primaryActionLabel: 'Open canvas',
  primaryActionAriaLabel: 'Open workflow attempt canvas',
  secondaryActionLabel: 'Run attempt',
  secondaryActionAriaLabel: 'Run workflow attempt',
};
```

Update draft helper:

```ts
return {
  name: `Workflow attempt for ${issueTitle}`,
  description:
    'Issue-bound workflow task attempt. Design the canvas before starting the run.',
  graph_json: JSON.stringify(createDefaultWorkflowGraph()),
};
```

- [ ] **Step 4: Create Task Attempts container**

`IssueTaskAttemptsSectionContainer.tsx` should:

- Preserve the single-agent behavior from `IssueWorkspacesSectionContainer`:
  - read `projectId` from route params;
  - read remote issue workspaces and PRs from `useProjectContext`;
  - read local active/archived workspaces from `useWorkspaceContext`;
  - read owner/member data from `useOrgContext`;
  - read current user from `useAuth`;
  - build `WorkspaceWithStats[]` with the same `filesChanged`, `linesAdded`, `linesRemoved`, PR, owner, running, approval, dev-server, unseen activity, and latest process fields;
  - keep `handleAddWorkspace` for creating a single-agent workspace draft;
  - keep `handleLinkWorkspace` if the product still needs linking an existing workspace from the section action menu;
  - keep single-agent attempt click navigation to `goToProjectIssueWorkspace`;
  - keep unlink/delete behavior only if the new `IssueTaskAttemptCard` exposes a secondary menu in the same increment. If the generic card does not expose a menu yet, explicitly defer unlink/delete and leave `IssueWorkspacesSectionContainer` available as fallback until the menu is implemented.
- Get workflow attempts using `useWorkflowAttempts(projectId, issueId)`.
- Merge them with `buildTaskAttempts`.
- Navigate single-agent attempts to existing workspace session routes.
- Navigate workflow draft attempts to `goToProjectWorkflowEdit(projectId, workflowId)`.
- Navigate workflow attempts with latest runs to `goToProjectWorkflowRun(projectId, latestRunId)`.
- Run workflow attempts through `useWorkflowAttemptMutations().runAttempt`.
- Keep plus actions for:
  - create single-agent attempt;
  - create workflow attempt.

Do not silently drop existing workspace actions. If a behavior is not carried into the new Task Attempts card, add a visible TODO in this plan's implementation PR and keep the old `IssueWorkspacesSectionContainer` rendered behind a temporary fallback flag until parity is restored.

Core structure:

```tsx
export function IssueTaskAttemptsSectionContainer({
  issueId,
  issueTitle,
  issueDescription,
}: {
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
}) {
  const { projectId } = useParams({ strict: false });
  const navigation = useAppNavigation();
  const { data: workflowAttemptData, isLoading: workflowAttemptsLoading } =
    useWorkflowAttempts(projectId, issueId);
  const { createAttempt, runAttempt, isCreatingAttempt, isRunningAttempt } =
    useWorkflowAttemptMutations();

  // Copy the existing workspace-attempt mapping from
  // IssueWorkspacesSectionContainer, including archived workspaces and PR stats.
  // Extract to a shared hook only after this container is working and tested.

  const attempts = useMemo(
    () =>
      buildTaskAttempts({
        workspaceAttempts: workspacesWithStats,
        workflowAttempts: workflowAttemptData?.attempts ?? [],
      }),
    [workspacesWithStats, workflowAttemptData]
  );

  const handleCreateWorkflowAttempt = useCallback(async () => {
    if (!projectId) return;
    const draft = await createAttempt({
      projectId,
      issueId,
      payload: buildIssueWorkflowDraft({
        title: issueTitle,
        description: issueDescription,
      }),
    });
    navigation.goToProjectWorkflowEdit(projectId, draft.workflow_id);
  }, [projectId, issueId, issueTitle, issueDescription, createAttempt, navigation]);

  return (
    <IssueTaskAttemptsSection
      attempts={attempts}
      isLoading={workflowAttemptsLoading || projectLoading || orgLoading}
      actions={actions}
      onOpenAttempt={handleOpenAttempt}
      onRunAttempt={handleRunAttempt}
      onCreateAttempt={handleCreateWorkflowAttempt}
    />
  );
}
```

- [ ] **Step 5: Replace issue panel render**

In `KanbanIssuePanelContainer.tsx`, replace:

```tsx
<IssueWorkflowSectionContainer ... />
<IssueArenaSectionContainer issueId={issueId} />
<IssueWorkspacesSectionContainer issueId={issueId} />
```

with:

```tsx
<IssueTaskAttemptsSectionContainer
  issueId={issueId}
  issueTitle={displayData.title}
  issueDescription={displayData.description}
/>
<IssueArenaSectionContainer issueId={issueId} />
```

Keep `IssueWorkspacesSectionContainer.tsx` in the repo for now if other routes still import it. Do not delete it in this task.

- [ ] **Step 6: Run frontend tests**

Run:

```bash
pnpm exec vitest run packages/web-core/src/features/workflow/model/issueWorkflow.test.ts packages/web-core/src/features/workflow/model/taskAttempt.test.ts
pnpm --filter @vibe/web-core run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web-core/src/pages/kanban/IssueTaskAttemptsSectionContainer.tsx packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx packages/web-core/src/pages/kanban/IssueWorkflowSectionContainer.tsx packages/web-core/src/features/workflow/model/issueWorkflow.ts packages/web-core/src/features/workflow/model/issueWorkflow.test.ts
git commit -m "feat(workflow): show workflows as issue task attempts"
```

---

### Task 9: Update Run Dialog To Run Attempts, Not Detached Templates

**Files:**
- Modify: `packages/web-core/src/features/workflow/ui/RunWorkflowDialog.tsx`
- Modify: `packages/web-core/src/pages/kanban/IssueTaskAttemptsSectionContainer.tsx`

- [ ] **Step 1: Define desired behavior**

From the issue panel:

- `Open canvas` opens a workflow attempt draft.
- `Run attempt` runs that attempt.
- The user should not be forced to choose among duplicate `Workflow for ...` project templates.
- Template selection remains in the project workflow library, not the issue attempt quick path.

- [ ] **Step 2: Add a focused test through Playwright in Task 11**

This component is modal-heavy. Validate with browser coverage after the harness is updated.

- [ ] **Step 3: Change dialog props**

Replace template-oriented props:

```ts
export interface RunWorkflowDialogProps {
  projectId: string;
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
  attemptId: string;
  attemptName: string;
  workspaces?: WorkflowWorkspaceOption[];
}
```

Remove `useWorkflowTemplates(projectId)` and `selectedTemplateId`.

- [ ] **Step 4: Submit through `runAttempt`**

Use `useWorkflowAttemptMutations()`:

```ts
const { runAttempt, isRunningAttempt } = useWorkflowAttemptMutations();

const run = await runAttempt({
  attemptId,
  payload: {
    workspace_id: workspaceId,
    trigger_source: 'manual',
    input_text: trimmedInput,
  },
});
```

Navigate to `goToProjectWorkflowRun(projectId, run.id)`.

- [ ] **Step 5: Update copy**

Dialog title: `Run workflow attempt`.

Description: `Start this issue-bound workflow attempt.`

Main workspace copy can stay, because the runtime still creates/binds a shared workspace.

- [ ] **Step 6: Run checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm exec vitest run packages/web-core/src/features/workflow/model/taskAttempt.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/RunWorkflowDialog.tsx packages/web-core/src/pages/kanban/IssueTaskAttemptsSectionContainer.tsx
git commit -m "feat(workflow): run issue-bound workflow attempts"
```

---

### Task 10: Make Workflow Attempt Status Visible On Run Pages

**Files:**
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx`
- Modify: `packages/web-core/src/features/workflow/model/workflowRunView.ts`
- Modify: `packages/web-core/src/features/workflow/model/workflowRunView.test.ts`

- [ ] **Step 1: Write view test for attempt label**

In `workflowRunView.test.ts`:

```ts
it('labels workflow runs as task attempts when attempt id is present', () => {
  const label = getWorkflowRunTaskAttemptLabel({
    id: 'run-12345678',
    attempt_id: 'attempt-abcdef',
  } as WorkflowRunResponse);

  expect(label).toBe('Task attempt attempt-a');
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm exec vitest run packages/web-core/src/features/workflow/model/workflowRunView.test.ts`

Expected: FAIL until helper exists.

- [ ] **Step 3: Implement helper**

```ts
export function getWorkflowRunTaskAttemptLabel(run: WorkflowRunResponse): string {
  if (run.attempt_id) {
    return `Task attempt ${run.attempt_id.slice(0, 9)}`;
  }
  return `Workflow run ${run.id.slice(0, 8)}`;
}
```

- [ ] **Step 4: Surface attempt identity**

In `WorkflowRunPage.tsx` header metadata, show:

- `Task Attempt` when `run.attempt_id` exists.
- `Workflow Run` for old runs with no attempt link.

Do not over-explain this in page body.

- [ ] **Step 5: Run checks**

Run:

```bash
pnpm exec vitest run packages/web-core/src/features/workflow/model/workflowRunView.test.ts
pnpm --filter @vibe/web-core run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx packages/web-core/src/features/workflow/model/workflowRunView.ts packages/web-core/src/features/workflow/model/workflowRunView.test.ts
git commit -m "feat(workflow): surface task attempt identity on runs"
```

---

### Task 11: Add Playwright Coverage For The Core Issue Attempt Flow

**Files:**
- Modify: `tests/workflow/fixture/src/main.tsx`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`
- Optional Modify: `tests/workflow/fixture/src/style.css`

- [ ] **Step 1: Add Task Attempts harness mode**

In `tests/workflow/fixture/src/main.tsx`, add:

```tsx
function TaskAttemptsHarness() {
  const attempts = [
    {
      id: 'workflow-attempt-1',
      kind: 'workflow' as const,
      title: 'Workflow attempt for Familiarize code',
      subtitle: 'Draft workflow attempt',
      statusLabel: 'Draft',
      statusTone: 'draft' as const,
      updatedAt: '2026-05-14T02:00:00Z',
      primaryActionLabel: 'Open canvas',
    },
    {
      id: 'workspace-attempt-1',
      kind: 'single_agent' as const,
      title: 'Codex try',
      subtitle: 'Workspace workspace-1',
      statusLabel: 'Completed',
      statusTone: 'succeeded' as const,
      updatedAt: '2026-05-14T01:00:00Z',
      primaryActionLabel: 'Open session',
    },
  ];
  const [lastAction, setLastAction] = useState('none');

  return (
    <main>
      <IssueTaskAttemptsSection
        attempts={attempts}
        onOpenAttempt={(attempt) => setLastAction(`open:${attempt.kind}`)}
        onRunAttempt={(attempt) => setLastAction(`run:${attempt.id}`)}
        onCreateAttempt={() => setLastAction('create-workflow')}
      />
      <output data-testid="task-attempt-action">{lastAction}</output>
    </main>
  );
}
```

Add render branch:

```tsx
mode === "task-attempts" ? <TaskAttemptsHarness /> : ...
```

- [ ] **Step 2: Add Playwright test for merged attempts**

```ts
test("shows workflow as an issue task attempt", async ({ page }) => {
  await page.goto("/?mode=task-attempts");

  await expect(page.getByText("Task Attempts")).toBeVisible();
  await expect(
    page.getByTestId("task-attempt-workflow-attempt-1")
  ).toContainText("Workflow attempt for Familiarize code");
  await expect(
    page.getByTestId("task-attempt-workspace-attempt-1")
  ).toContainText("Codex try");

  await page
    .getByTestId("task-attempt-workflow-attempt-1")
    .getByRole("button", { name: /Open canvas/i })
    .click();
  await expect(page.getByTestId("task-attempt-action")).toHaveText(
    "open:workflow"
  );
});
```

- [ ] **Step 3: Add Playwright test for run action**

```ts
test("runs a workflow task attempt from the issue attempt card", async ({
  page,
}) => {
  await page.goto("/?mode=task-attempts");

  await page.getByRole("button", { name: "Run workflow attempt" }).click();

  await expect(page.getByTestId("task-attempt-action")).toHaveText(
    "run:workflow-attempt-1"
  );
});
```

- [ ] **Step 4: Add an API-backed issue attempt flow harness**

The static section harness proves rendering only. Add a second fixture mode named `issue-attempt-flow` that uses `QueryClientProvider`, `IssueTaskAttemptsSectionContainer`, and mocked `workflowApi` methods or route-level fetch interception to prove the real container flow:

- initial issue has no workflow attempt;
- clicking `New workflow attempt` calls create attempt;
- create response contains `workflow_id`;
- harness records navigation to `project-workflow-edit`;
- running the attempt calls `runAttempt`;
- run response contains `attempt_id` and `id`;
- harness records navigation to `project-workflow-run`;
- single-agent workspace attempt still records navigation to `project-issue-workspace`.

If direct context providers are too expensive, create a thin test-only container that accepts the same data and handlers as `IssueTaskAttemptsSectionContainer`, but the test must still exercise `useWorkflowAttempts`, `useWorkflowAttemptMutations`, `buildTaskAttempts`, and navigation decisions. Do not stop at the presentational `IssueTaskAttemptsSection`.

- [ ] **Step 5: Add Playwright test for create/open canvas flow**

```ts
test("creates a workflow task attempt and opens the design canvas before run", async ({
  page,
}) => {
  await page.goto("/?mode=issue-attempt-flow");

  await page.getByRole("button", { name: /New workflow attempt/i }).click();

  await expect(page.getByTestId("task-attempt-action")).toHaveText(
    "navigate:project-workflow-edit:workflow-created"
  );
  await expect(page.getByTestId("run-created")).toHaveText("false");
});
```

- [ ] **Step 6: Add Playwright test for real run attempt flow**

```ts
test("runs an issue-bound workflow attempt without template selection", async ({
  page,
}) => {
  await page.goto("/?mode=issue-attempt-flow&withAttempt=1");

  await page.getByRole("button", { name: "Run workflow attempt" }).click();

  await expect(page.getByTestId("selected-template-id")).toHaveText("none");
  await expect(page.getByTestId("task-attempt-action")).toHaveText(
    "navigate:project-workflow-run:run-created"
  );
});
```

- [ ] **Step 7: Add installed-app smoke test instructions**

Add a short script or documented Playwright command for release verification against the real local app:

```bash
pnpm run build:npx
npx --yes ./npx-cli --data-dir ./tmp-workflow-attempt-smoke
```

Then use Playwright against the printed localhost URL to:

1. create/open an issue;
2. create a workflow task attempt;
3. verify the design canvas opens before any run appears;
4. add `Start -> Agent -> End`;
5. start the run;
6. verify the run page shows `Task Attempt` and the Agent Step session panel.

This smoke can remain manual if deterministic project/repo seeding is not ready, but it must be run before release builds until an automated app-level fixture exists.

- [ ] **Step 8: Run workflow Playwright tests**

Run: `pnpm run workflow:e2e`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add tests/workflow/fixture/src/main.tsx tests/workflow/specs/workflow-canvas.spec.ts tests/workflow/fixture/src/style.css
git commit -m "test(workflow): cover issue task attempt flow"
```

---

### Task 12: End-To-End Local Verification

**Files:**
- No source edits unless checks reveal issues.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
pnpm exec vitest run packages/web-core/src/features/workflow/model/issueWorkflow.test.ts packages/web-core/src/features/workflow/model/taskAttempt.test.ts packages/web-core/src/features/workflow/model/workflowRunView.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run browser workflow tests**

Run: `pnpm run workflow:e2e`

Expected: PASS.

- [ ] **Step 3: Run backend workflow tests**

Run: `cargo test -p server --test workflow_routes`

Expected: PASS.

- [ ] **Step 4: Run generated type check**

Run: `pnpm run generate-types:check`

Expected: PASS, no generated diff.

- [ ] **Step 5: Run full project checks**

Run:

```bash
pnpm run check
pnpm run format
git diff --check
```

Expected:

- TypeScript checks pass.
- Rust check passes.
- Formatting applies only expected touched files.
- `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit verification fixes if needed**

```bash
git add <fixed-files>
git commit -m "fix(workflow): stabilize task attempt checks"
```

Only commit if fixes were required.

---

## Manual Product Smoke Test

After implementation, run the app and test this exact flow:

1. Open a project issue.
2. Confirm the issue panel section is named `Task Attempts`.
3. Create a workflow attempt.
4. Confirm it opens the design canvas without starting a run.
5. Build `Start -> Agent Step -> End`.
6. Save the canvas.
7. Return to the issue and confirm the workflow attempt appears in Task Attempts.
8. Run the workflow attempt.
9. Confirm a workflow run opens.
10. Double-click the Agent Step and confirm the node session panel shows `session_id` and `execution_process_id`.
11. Return to the issue and confirm the attempt status reflects the latest run.

Acceptance:

- No duplicate template picker is required for the issue quick path.
- The old single-agent workspace attempts still open.
- A workflow attempt draft does not require a workspace until Run.
- A workflow run still creates or binds one shared workspace.
- Agent Step sessions remain node-level and visible inside the workflow run view.

## Rollback Plan

If the schema/API path causes release risk:

1. Keep the migration because it is additive.
2. Hide the new Task Attempts section behind a frontend flag or revert `KanbanIssuePanelContainer.tsx` to render the old sections.
3. Keep old `/v1/workflows/{workflow_id}/trigger` routes unchanged.
4. Do not delete old project workflow templates.

This rollback preserves existing workspace and workflow behavior.
