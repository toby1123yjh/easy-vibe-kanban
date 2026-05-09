# AI Workflow V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AI Workflow V1 so a project issue can launch a saved multi-agent workflow graph with shared-worktree agent steps, isolated-worktree Arena attempts, human gates, run visualization, and a dashboard.

**Architecture:** Add a dedicated Rust `crates/workflow` crate for graph schema, validation, ready-node calculation, runner state, and pure node logic. The server crate owns local HTTP routes, workspace/session integration, SSE, and adapters from the workflow runner to existing workspace, executor, git, and Arena services. The React app adds workflow template management, a React Flow editor, issue entry point, read-only run canvas, dashboard, and Arena winner controls.

**Tech Stack:** Rust, SQLx/SQLite, Axum, ts-rs, Tokio broadcast/SSE, existing workspace/session/executor crates, React, TypeScript, TanStack Router/Query, `@xyflow/react`, Tailwind, existing web-core UI primitives.

---

## Source Documents

- Product spec: `docs/superpowers/specs/2026-05-08-ai-workflow-v1-design.md`
- Original future requirement: `docs/future/ai-workflow/spec.md`
- Closest implementation precedent: `crates/server/src/routes/local_remote.rs` Arena routes and `packages/web-core/src/features/arena/ui/*`

## Global Constraints

- Do not edit generated files by hand: `shared/types.ts`, `shared/remote-types.ts`, or `shared/schemas/*`.
- Add Rust TS exports in `crates/server/src/bin/generate_types.rs`, then run `pnpm run generate-types`.
- New routes are local-only under `/api/local/v1`.
- A normal workflow run uses one main workspace/worktree.
- Normal Agent nodes run serially when they write to the main workflow worktree.
- Arena node attempts run in separate workspaces/worktrees, then the manually selected winner diff is applied back to the main workflow worktree.
- System templates are built in, not directly editable. Project templates are editable and project-bound.
- V1 Transform modes are only `template`, `regex_extract`, and `truncate`.
- V1 event stream emits state/output events, not token-level streams.
- Before completing implementation work, run `pnpm run format`.
- If PowerShell reports `cargo` is not found, run Rust checks in a shell with Rust on PATH, WSL, or CI. Do not skip listing the intended Rust commands.

## File Structure

### Backend: New Workflow Crate

- Create: `crates/workflow/Cargo.toml`
- Create: `crates/workflow/src/lib.rs`
- Create: `crates/workflow/src/graph.rs`
  - Serializable graph schema, node/edge types, node data enums.
- Create: `crates/workflow/src/validation.rs`
  - Version, node type, edge type, required field, single Start, End presence, reachability, and no-cycle validation.
- Create: `crates/workflow/src/templates.rs`
  - Built-in system template definitions and role templates.
- Create: `crates/workflow/src/planner.rs`
  - Ready-node calculation, branch skipping, upstream-output collection.
- Create: `crates/workflow/src/transform.rs`
  - Safe `template`, `regex_extract`, and `truncate` logic.
- Create: `crates/workflow/src/events.rs`
  - `WorkflowEvent` and event kind definitions.
- Create: `crates/workflow/src/runner.rs`
  - Runner state machine, node dispatch, pause/resume primitives.
- Create: `crates/workflow/src/handlers.rs`
  - Pure handlers for Start, End, Condition, Transform, Human Gate state, and Arena wait state.
- Create: `crates/workflow/src/ports.rs`
  - Traits implemented by `crates/server` for DB store, agent execution, workspace creation, Arena creation, and diff apply.
- Test: unit tests in the same files with `#[cfg(test)]`; integration tests only if the unit files get too large.

### Backend: Database and Types

- Create: `crates/db/migrations/20260508130000_add_ai_workflow.sql`
- Create: `crates/db/src/models/workflow.rs`
- Modify: `crates/db/src/models/mod.rs`
- Modify: `crates/server/src/bin/generate_types.rs`

### Backend: Server Routes and Runtime Adapters

- Create: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/src/routes/mod.rs`
- Modify: `crates/server/src/routes/local_remote.rs`
- Create: `crates/server/src/workflow_runtime/mod.rs`
- Create: `crates/server/src/workflow_runtime/runner.rs`
- Create: `crates/server/src/workflow_runtime/workspace.rs`
- Create: `crates/server/src/workflow_runtime/arena.rs`
- Modify: `crates/server/src/lib.rs`
- Modify: `crates/server/Cargo.toml`
- Modify: root `Cargo.toml`

### Frontend: Workflow API, Hooks, and UI

- Modify: `packages/web-core/package.json`
- Create: `packages/web-core/src/shared/lib/workflowApi.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowTemplates.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowRun.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowRunEvents.ts`
- Create: `packages/web-core/src/features/workflow/index.ts`
- Create: `packages/web-core/src/features/workflow/model/workflowGraph.ts`
- Create: `packages/web-core/src/features/workflow/model/workflowNodeCatalog.ts`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowTemplateListPage.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowTemplateEditorPage.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowNodeInspector.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowValidationPanel.tsx`
- Create: `packages/web-core/src/features/workflow/ui/RunWorkflowDialog.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx`
- Create: `packages/web-core/src/pages/kanban/IssueWorkflowSectionContainer.tsx`
- Modify: `packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx`
- Modify: `packages/web-core/src/shared/lib/routes/appNavigation.ts`

### Frontend: Local Routes

- Create: `packages/local-web/src/routes/_app.projects.$projectId_.workflows.tsx`
- Create: `packages/local-web/src/routes/_app.projects.$projectId_.workflows.$workflowId.edit.tsx`
- Create: `packages/local-web/src/routes/_app.projects.$projectId_.workflow-runs.$runId.tsx`

## Phase 1: Data Model, Graph Schema, Built-In Templates

### Task 1.1: Add Workflow Crate Skeleton and Graph Types

**Files:**
- Modify: `Cargo.toml`
- Create: `crates/workflow/Cargo.toml`
- Create: `crates/workflow/src/lib.rs`
- Create: `crates/workflow/src/graph.rs`

- [ ] **Step 1: Add failing graph serialization tests**

Add tests in `crates/workflow/src/graph.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_start_end_graph() {
        let graph: WorkflowGraph = serde_json::from_value(serde_json::json!({
            "version": 1,
            "nodes": [
                { "id": "start", "type": "start", "data": { "display_name": "Start" } },
                { "id": "end", "type": "end", "data": { "display_name": "End" } }
            ],
            "edges": [
                { "id": "e1", "source": "start", "target": "end", "type": "default" }
            ]
        })).unwrap();

        assert_eq!(graph.version, 1);
        assert_eq!(graph.nodes.len(), 2);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p workflow parses_minimal_start_end_graph`

Expected: FAIL because crate/types do not exist yet.

- [ ] **Step 3: Add crate and graph structs**

Add `crates/workflow` as a workspace member in root `Cargo.toml`.

Implement `WorkflowGraph`, `WorkflowNode`, `WorkflowEdge`, `WorkflowNodeKind`, `WorkflowEdgeKind`, and data structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowGraph {
    pub version: u32,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: WorkflowNodeKind,
    pub data: WorkflowNodeData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeKind {
    Start,
    End,
    Agent,
    Condition,
    HumanGate,
    Transform,
    Arena,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p workflow parses_minimal_start_end_graph`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/workflow
git commit -m "feat(workflow): add graph schema crate"
```

### Task 1.2: Implement Graph Validation

**Files:**
- Create: `crates/workflow/src/validation.rs`
- Modify: `crates/workflow/src/lib.rs`
- Modify: `crates/workflow/src/graph.rs`

- [ ] **Step 1: Write failing validation tests**

Add tests for:

- accepts one Start plus at least one End
- rejects missing Start
- rejects multiple Start nodes
- rejects cycles
- rejects unreachable executable nodes
- rejects edges pointing at missing node ids

Core test shape:

```rust
#[test]
fn rejects_cycle() {
    let graph = graph_with_edges([("start", "agent"), ("agent", "start")]);
    let err = validate_graph(&graph).unwrap_err();
    assert!(err.to_string().contains("cycle"));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p workflow validation`

Expected: FAIL because `validate_graph` does not exist or returns incomplete checks.

- [ ] **Step 3: Implement validation**

Implement:

- `ValidatedGraph`
- `ValidationError`
- `validate_graph(&WorkflowGraph) -> Result<ValidatedGraph, ValidationError>`
- adjacency maps by node id
- Kahn or DFS cycle detection
- BFS reachability from Start

Keep validation pure; no DB or server dependencies.

- [ ] **Step 4: Run tests**

Run: `cargo test -p workflow validation`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/workflow/src/lib.rs crates/workflow/src/graph.rs crates/workflow/src/validation.rs
git commit -m "feat(workflow): validate workflow graphs"
```

### Task 1.3: Add Built-In Templates and Role Templates

**Files:**
- Create: `crates/workflow/src/templates.rs`
- Modify: `crates/workflow/src/lib.rs`

- [ ] **Step 1: Write failing template tests**

Add tests:

```rust
#[test]
fn built_in_templates_are_valid() {
    for template in built_in_templates() {
        validate_graph(&template.graph).expect(template.name);
    }
}

#[test]
fn role_templates_include_required_v1_roles() {
    let ids: Vec<_> = role_templates().iter().map(|role| role.id).collect();
    assert!(ids.contains(&"architect"));
    assert!(ids.contains(&"researcher"));
    assert!(ids.contains(&"implementer"));
    assert!(ids.contains(&"reviewer"));
    assert!(ids.contains(&"fixer"));
    assert!(ids.contains(&"custom"));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p workflow templates`

Expected: FAIL because templates do not exist.

- [ ] **Step 3: Implement templates**

Implement at least:

- `plan-approve-implement-review`
- `plan-arena-pick-winner-review`
- `research-architect-implement-review-fix`

Use stable UUIDs for system template ids. Document the UUIDs near the template declarations.

- [ ] **Step 4: Run tests**

Run: `cargo test -p workflow templates`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/workflow/src/lib.rs crates/workflow/src/templates.rs
git commit -m "feat(workflow): add built-in workflow templates"
```

### Task 1.4: Add DB Migration and Workflow Models

**Files:**
- Create: `crates/db/migrations/20260508130000_add_ai_workflow.sql`
- Create: `crates/db/src/models/workflow.rs`
- Modify: `crates/db/src/models/mod.rs`

- [ ] **Step 1: Write SQL migration**

Use this schema as the starting point:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE workflows (
    id          BLOB PRIMARY KEY,
    source      TEXT NOT NULL CHECK (source IN ('system','project')),
    project_id  BLOB,
    name        TEXT NOT NULL,
    description TEXT,
    graph_json  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CHECK (
        (source = 'system' AND project_id IS NULL) OR
        (source = 'project' AND project_id IS NOT NULL)
    )
);

CREATE TABLE workflow_runs (
    id             BLOB PRIMARY KEY,
    workflow_id    BLOB NOT NULL,
    issue_id       BLOB NOT NULL,
    workspace_id   BLOB,
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    input_text     TEXT NOT NULL,
    output_text    TEXT,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','awaiting_human','awaiting_arena','succeeded','failed','canceled')),
    started_at     TEXT,
    finished_at    TEXT,
    error_text     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (workflow_id)  REFERENCES workflows(id)     ON DELETE RESTRICT,
    FOREIGN KEY (issue_id)     REFERENCES local_issues(id)  ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)    ON DELETE SET NULL
);

CREATE TABLE node_executions (
    id            BLOB PRIMARY KEY,
    run_id        BLOB NOT NULL,
    node_id       TEXT NOT NULL,
    node_type     TEXT NOT NULL,
    iteration     INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','awaiting_human','awaiting_arena','succeeded','failed','skipped')),
    input_text    TEXT,
    output_text   TEXT,
    session_id    BLOB,
    arena_group_id BLOB,
    tokens_used   INTEGER,
    cost_estimate REAL,
    started_at    TEXT,
    finished_at   TEXT,
    error_text    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (run_id)         REFERENCES workflow_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id)     REFERENCES sessions(id)      ON DELETE SET NULL,
    FOREIGN KEY (arena_group_id) REFERENCES arena_groups(id)  ON DELETE SET NULL,
    UNIQUE (run_id, node_id, iteration)
);
```

Add indexes:

- `idx_workflows_project_id`
- `idx_workflows_source`
- `idx_workflow_runs_issue_id`
- `idx_workflow_runs_status`
- `idx_node_executions_run_id`
- `idx_node_executions_status`
- `idx_node_executions_arena_group_id`

- [ ] **Step 2: Add DB model structs**

In `crates/db/src/models/workflow.rs`, add:

- `WorkflowSource`
- `WorkflowRunStatus`
- `NodeExecutionStatus`
- `Workflow`
- `WorkflowRun`
- `NodeExecution`
- create/update input structs used by routes

Derive `Debug`, `Clone`, `Serialize`, `Deserialize`, `TS`, and `sqlx::FromRow` where appropriate.

- [ ] **Step 3: Export module**

Add `pub mod workflow;` to `crates/db/src/models/mod.rs`.

- [ ] **Step 4: Verify DB/model compile**

Run:

```bash
cargo check -p db
pnpm run prepare-db
```

Expected: PASS. If SQLx prepare needs a full toolchain, run it in the environment used for normal backend work.

- [ ] **Step 5: Commit**

```bash
git add crates/db/migrations/20260508130000_add_ai_workflow.sql crates/db/src/models/mod.rs crates/db/src/models/workflow.rs
git commit -m "feat(workflow): add workflow persistence model"
```

### Task 1.5: Export Workflow Types to TypeScript

**Files:**
- Modify: `crates/server/src/bin/generate_types.rs`
- Generated: `shared/types.ts`

- [ ] **Step 1: Add TS export declarations**

Add workflow DB models and upcoming API DTO names to `generate_types_content()` after Arena declarations.

- [ ] **Step 2: Run type generation**

Run: `pnpm run generate-types`

Expected: updates `shared/types.ts`; do not hand-edit generated output.

- [ ] **Step 3: Verify generated types**

Run: `pnpm run generate-types:check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/bin/generate_types.rs shared/types.ts shared/schemas
git commit -m "feat(workflow): export workflow types"
```

## Phase 2: Template API, Runner Core, Event Stream

### Task 2.1: Add Local Workflow Route Module

**Files:**
- Create: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/src/routes/mod.rs`
- Modify: `crates/server/src/routes/local_remote.rs`
- Modify: `crates/server/Cargo.toml`

- [ ] **Step 1: Write route DTOs and router stub**

Add `#[derive(TS)]` DTOs:

- `WorkflowTemplateResponse`
- `WorkflowTemplateListResponse`
- `CreateWorkflowRequest`
- `UpdateWorkflowRequest`
- `TriggerWorkflowRequest`
- `WorkflowRunResponse`
- `WorkflowNodeExecutionResponse`
- `WorkflowActionResponse`

Add router paths:

```rust
pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .route("/v1/projects/{project_id}/workflows", get(list_workflows).post(create_workflow))
        .route("/v1/workflows/{workflow_id}", get(get_workflow).put(update_workflow).delete(delete_workflow))
        .route("/v1/workflows/{workflow_id}/trigger", post(trigger_workflow))
        .route("/v1/workflow-runs/{run_id}", get(get_workflow_run))
        .route("/v1/workflow-runs/{run_id}/cancel", post(cancel_workflow_run))
        .route("/v1/workflow-runs/{run_id}/events", get(workflow_run_events))
        .route("/v1/workflow-runs/{run_id}/nodes/{node_id}/retry", post(retry_node))
        .route("/v1/workflow-runs/{run_id}/nodes/{node_id}/approve", post(approve_node))
        .route("/v1/workflow-runs/{run_id}/nodes/{node_id}/reject", post(reject_node))
        .route("/v1/workflow-runs/{run_id}/nodes/{node_id}/arena-winner", post(select_arena_winner))
        .with_state(deployment.clone())
}
```

- [ ] **Step 2: Wire route under local API**

In `crates/server/src/routes/mod.rs`, add `pub mod workflows;`.

In `crates/server/src/routes/local_remote.rs`, merge the workflow router so paths resolve under `/api/local/v1/...`.

- [ ] **Step 3: Compile**

Run: `cargo check -p server`

Expected: PASS with handlers returning placeholder `501` or empty responses if persistence is not wired yet.

- [ ] **Step 4: Commit**

```bash
git add crates/server/Cargo.toml crates/server/src/routes/mod.rs crates/server/src/routes/local_remote.rs crates/server/src/routes/workflows.rs
git commit -m "feat(workflow): add local workflow route surface"
```

### Task 2.2: Implement Template CRUD and Fallback Rows

**Files:**
- Modify: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/src/routes/local_remote.rs`

- [x] **Step 1: Write route tests or handler-level tests**

Cover:

- listing returns system templates plus project templates
- creating project template validates graph
- updating system template returns 403
- deleting system template returns 403
- fallback endpoints return `{ "workflows": [...] }`, `{ "workflow_runs": [...] }`, `{ "node_executions": [...] }`

- [x] **Step 2: Run tests to verify failure**

Run: `cargo test -p server workflow`

Expected: FAIL before persistence logic exists.

- [x] **Step 3: Implement handlers**

Implement:

- `GET /projects/{project_id}/workflows`
- `POST /projects/{project_id}/workflows`
- `GET /workflows/{workflow_id}`
- `PUT /workflows/{workflow_id}`
- `DELETE /workflows/{workflow_id}`
- fallback routes in local remote:
  - `/v1/fallback/workflows`
  - `/v1/fallback/workflow_runs`
  - `/v1/fallback/node_executions`

On server startup or first listing, ensure system template rows exist with stable UUIDs from `crates/workflow/src/templates.rs`.

- [x] **Step 4: Run tests**

Run: `cargo test -p server workflow`

Expected: PASS.

Verified with GitHub Actions Test run `25592127339` on `3eed4444072396d7a8d8ef809d0c48e83388ff87`.

- [x] **Step 5: Commit**

```bash
git add crates/server/src/routes/workflows.rs crates/server/src/routes/local_remote.rs
git commit -m "feat(workflow): add workflow template API"
```

Committed as `1b56e07b` and follow-up clippy fix `3eed4444`.

### Task 2.3: Implement Runner Store, Ready-Node Planner, and Events

**Files:**
- Create: `crates/workflow/src/planner.rs`
- Create: `crates/workflow/src/events.rs`
- Create: `crates/workflow/src/runner.rs`
- Create: `crates/workflow/src/ports.rs`
- Modify: `crates/workflow/src/lib.rs`

- [x] **Step 1: Write planner tests**

Cover:

- Start is ready first.
- Downstream node becomes ready after upstream succeeds.
- Join node waits for all selected upstream nodes.
- Skipped branches unblock downstream only when graph semantics allow it.
- Multiple Agent nodes ready on main worktree are serialized by planner output or runner lock.

- [x] **Step 2: Run tests to verify failure**

Run: `cargo test -p workflow planner`

Expected: FAIL.

Local attempt was blocked by the Windows/MSVC linker before crate compile: `LINK : fatal error LNK1171: unable to load mspdb140.dll`.

- [x] **Step 3: Implement planner and events**

Add:

- `ReadyNode`
- `RunSnapshot`
- `NodeExecutionSnapshot`
- `WorkflowEventKind`
- `WorkflowEvent`
- `WorkflowEventBus`

Event kinds:

- `run_status`
- `node_status`
- `node_output`
- `node_error`
- `node_waiting_human`
- `node_waiting_arena`

- [x] **Step 4: Run tests**

Run: `cargo test -p workflow planner events`

Expected: PASS.

Verified with GitHub Actions Test run `25592503074` on `0b6906482ff007e7dd6cf0d769df61625449a862`.

- [x] **Step 5: Commit**

```bash
git add crates/workflow/src/lib.rs crates/workflow/src/planner.rs crates/workflow/src/events.rs crates/workflow/src/runner.rs crates/workflow/src/ports.rs
git commit -m "feat(workflow): plan ready workflow nodes"
```

Committed as `0b690648`.

### Task 2.4: Implement Pure Node Handlers

**Files:**
- Create: `crates/workflow/src/handlers.rs`
- Create: `crates/workflow/src/transform.rs`
- Modify: `crates/workflow/src/lib.rs`

- [x] **Step 1: Write failing handler tests**

Cover:

- Start outputs `run.input_text`.
- End combines upstream outputs.
- Condition routes true/false/default branch.
- Transform template wraps upstream text.
- Transform regex_extract returns first capture.
- Transform truncate respects character limit.
- Human Gate returns paused state.
- Arena returns awaiting arena state.

- [x] **Step 2: Run tests to verify failure**

Run: `cargo test -p workflow handlers transform`

Expected: FAIL.

Local attempt was blocked by the Windows/MSVC linker before workflow crate tests could run: `LINK : fatal error LNK1171: unable to load mspdb140.dll`.

- [x] **Step 3: Implement handlers**

Keep Agent and Arena side effects behind traits in `ports.rs`; pure handlers only compute state transitions.

- [x] **Step 4: Run tests**

Run: `cargo test -p workflow handlers transform`

Expected: PASS.

Verified with GitHub Actions Test run `25592815794` on `85704d2a1a28d5145eb9050b830c2698068bd494`.

- [x] **Step 5: Commit**

```bash
git add crates/workflow/src/lib.rs crates/workflow/src/handlers.rs crates/workflow/src/transform.rs crates/workflow/src/ports.rs
git commit -m "feat(workflow): add workflow node handlers"
```

Committed as `85704d2a`.

### Task 2.5: Implement Server Runner Adapter for Workspace and Agent Nodes

**Files:**
- Create: `crates/server/src/workflow_runtime/mod.rs`
- Create: `crates/server/src/workflow_runtime/runner.rs`
- Create: `crates/server/src/workflow_runtime/workspace.rs`
- Modify: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/src/lib.rs`

- [x] **Step 1: Write adapter tests with fake ports where possible**

Cover:

- trigger creates a workflow run
- trigger creates or binds main workflow workspace
- node executions are initialized from graph nodes
- Agent node creates/uses a session in the main workflow workspace
- Agent node stores `session_id` and final output

- [x] **Step 2: Run tests to verify failure**

Run: `cargo test -p server workflow_runner`

Expected: FAIL.

Note: Local `cargo test -p server workflow_runner` reached the known Windows/MSVC linker blocker (`LNK1171: unable to load mspdb140.dll`) after the failing tests were added, so RED was verified as blocked by local toolchain before implementation. Remote CI is the authoritative verification path for this branch.

- [x] **Step 3: Implement trigger and adapter**

Use existing workspace/session patterns from:

- `crates/server/src/routes/workspaces/create.rs`
- `crates/server/src/routes/workspaces/execution.rs`
- `crates/server/src/routes/sessions/mod.rs`
- `crates/local-deployment/src/container.rs`

Branch naming:

```text
vk/<issue_id>-wf-<run_short_id>
```

Agent prompt input comes from rendered upstream outputs. Agent nodes sharing the main worktree must not run concurrently in V1.

- [x] **Step 4: Run tests**

Run: `cargo test -p server workflow_runner`

Expected: PASS.

Result: GitHub Actions Test run `25594619826` on `776020df` completed successfully.

- [x] **Step 5: Commit**

```bash
git add crates/server/src/workflow_runtime crates/server/src/routes/workflows.rs crates/server/src/lib.rs
git commit -m "feat(workflow): run workflow agent nodes"
```

### Task 2.6: Add Human Gate, Cancel, Retry, Recovery, and SSE

**Files:**
- Modify: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/src/workflow_runtime/runner.rs`
- Modify: `crates/server/src/startup.rs`
- Modify: `crates/server/src/main.rs`
- Modify: `crates/server/tests/workflow_routes.rs`

- [x] **Step 1: Write tests**

Cover:

- Human Gate sets run `awaiting_human`.
- approve resumes run.
- reject fails run.
- cancel marks run canceled and attempts to stop running session.
- retry supports failed Agent, Condition, and Transform nodes.
- startup recovery marks stale `running` nodes failed/recoverable.
- SSE emits run/node status changes.

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test -p server workflow_human --test workflow_routes
cargo test -p server workflow_events --test workflow_routes
```

Expected: FAIL.

Note: Local cargo verification is blocked before project compilation by the Windows/MSVC toolchain:

- `link.exe`: `LINK : fatal error LNK1171: unable to load mspdb140.dll`
- `rust-lld`: missing Windows SDK import libs such as `kernel32.lib`

Remote GitHub Actions is the authoritative verification path for this task.

- [x] **Step 3: Implement route actions**

Implement:

- `POST /workflow-runs/{run_id}/cancel`
- `GET /workflow-runs/{run_id}/events`
- `POST /workflow-runs/{run_id}/nodes/{node_id}/retry`
- `POST /workflow-runs/{run_id}/nodes/{node_id}/approve`
- `POST /workflow-runs/{run_id}/nodes/{node_id}/reject`

Use Axum SSE and `tokio::sync::broadcast` for state/output events.

- [ ] **Step 4: Run tests**

Run:

```bash
cargo test -p server workflow_human --test workflow_routes
cargo test -p server workflow_events --test workflow_routes
```

Expected: PASS.

Result: Pending remote GitHub Actions verification because local Rust linking fails before compiling the server crate.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/routes/workflows.rs crates/server/src/workflow_runtime/runner.rs crates/server/src/startup.rs crates/server/src/main.rs crates/server/tests/workflow_routes.rs docs/superpowers/plans/2026-05-08-ai-workflow-v1.md
git commit -m "feat(workflow): add workflow pause resume and events"
```

## Phase 3: React Flow Template Editor and Project Template Save/Load

### Task 3.1: Add Frontend Workflow API and Hooks

**Files:**
- Create: `packages/web-core/src/shared/lib/workflowApi.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowTemplates.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowRun.ts`
- Create: `packages/web-core/src/shared/hooks/useWorkflowRunEvents.ts`

- [x] **Step 1: Write hook/API tests if local test harness exists**

If there is no matching frontend unit harness, write type-level usage examples in the hook files and rely on `tsc` for this task.

- [x] **Step 2: Implement API wrapper**

Mirror the smaller style of `packages/web-core/src/shared/lib/arenaApi.ts`:

- `list(projectId)`
- `create(projectId, payload)`
- `get(workflowId)`
- `update(workflowId, payload)`
- `delete(workflowId)`
- `trigger(workflowId, payload)`
- `getRun(runId)`
- `cancelRun(runId)`
- `approve(runId, nodeId, payload)`
- `reject(runId, nodeId, payload)`
- `retry(runId, nodeId)`
- `selectArenaWinner(runId, nodeId, payload)`
- `eventsUrl(runId)`

- [x] **Step 3: Run typecheck**

Run: `pnpm --filter @vibe/web-core run check`

Expected: PASS.

Result: PASS. Also verified the four new files with Prettier directly:

```bash
pnpm --filter @vibe/web-core run check
packages/web-core/node_modules/.bin/prettier.cmd --check src/shared/lib/workflowApi.ts src/shared/hooks/useWorkflowTemplates.ts src/shared/hooks/useWorkflowRun.ts src/shared/hooks/useWorkflowRunEvents.ts
```

Note: Full `pnpm --filter @vibe/web-core run format:check` still fails due existing unrelated formatting drift across the package, so this task used scoped formatting checks for the newly added files.

- [x] **Step 4: Commit**

```bash
git add packages/web-core/src/shared/lib/workflowApi.ts packages/web-core/src/shared/hooks/useWorkflowTemplates.ts packages/web-core/src/shared/hooks/useWorkflowRun.ts packages/web-core/src/shared/hooks/useWorkflowRunEvents.ts
git commit -m "feat(workflow): add frontend workflow API hooks"
```

Result: committed as `14fda327`.

### Task 3.2: Add React Flow Dependency and Graph Model

**Files:**
- Modify: `packages/web-core/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/web-core/src/features/workflow/model/workflowGraph.ts`
- Create: `packages/web-core/src/features/workflow/model/workflowNodeCatalog.ts`
- Create: `packages/web-core/src/features/workflow/model/workflowGraph.test.ts`
- Create: `packages/web-core/src/features/workflow/index.ts`

- [x] **Step 1: Add dependency**

Run:

```bash
pnpm --filter @vibe/web-core add @xyflow/react
```

Expected: `packages/web-core/package.json` and `pnpm-lock.yaml` update.

- [x] **Step 2: Implement TS graph helpers**

Add node catalog for:

- Start
- End
- Agent
- Condition
- Human Gate
- Transform
- Arena

Include default node data matching backend schema.

- [x] **Step 3: Run typecheck**

Run: `pnpm --filter @vibe/web-core run check`

Expected: PASS.

Result: PASS. Also verified the focused graph model test and scoped Prettier check:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowGraph.test.ts --root packages/web-core --pool forks
pnpm --filter @vibe/web-core run check
packages/web-core/node_modules/.bin/prettier.cmd --check src/features/workflow/model/workflowGraph.ts src/features/workflow/model/workflowNodeCatalog.ts src/features/workflow/index.ts src/features/workflow/model/workflowGraph.test.ts
```

- [x] **Step 4: Commit**

```bash
git add packages/web-core/package.json pnpm-lock.yaml packages/web-core/src/features/workflow
git commit -m "feat(workflow): add workflow graph editor model"
```

Result: committed as `d180304f`.

### Task 3.3: Build Template List and Editor Pages

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/WorkflowTemplateListPage.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowTemplateEditorPage.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowNodeInspector.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowValidationPanel.tsx`
- Create: `packages/local-web/src/routes/_app.projects.$projectId_.workflows.tsx`
- Create: `packages/local-web/src/routes/_app.projects.$projectId_.workflows_.$workflowId.edit.tsx`
- Modify: `packages/web-core/src/shared/lib/routes/appNavigation.ts`
- Modify: `packages/local-web/src/app/navigation/AppNavigation.ts`
- Modify: `packages/local-web/src/routeTree.gen.ts`
- Modify: `packages/remote-web/src/app/navigation/AppNavigation.ts`

- [x] **Step 1: Build editor shell**

Use layout:

- left node library
- center React Flow canvas
- right inspector
- top Save / Validate / Run test
- bottom validation panel

Use cards only for individual repeated items and inspector panels. Do not create a landing page.

Result: implemented template list, editor toolbar, React Flow canvas, node library, inspector, and validation panel.

- [x] **Step 2: Implement save/load**

Rules:

- system templates open read-only
- copying system template creates a project template
- project templates can save name, description, graph JSON
- validation calls backend before save or uses same constraints mirrored in frontend for immediate feedback

Result: implemented list/detail hooks integration, project template create/update, system template read-only mode, copy-to-project, and mirrored frontend validation.

- [x] **Step 3: Run frontend checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
pnpm --filter @vibe/remote-web run check
```

Expected: PASS.

Result: PASS. Also ran scoped Prettier checks for touched frontend files and `git diff --check` (only Windows LF/CRLF warnings).

- [ ] **Step 4: Manual smoke test**

Run: `pnpm run dev`

Expected:

- `/projects/:projectId/workflows` renders template list.
- opening a system template shows read-only editor.
- copy creates project template.
- project template save persists and reloads graph.

Result: not run in this pass; backend-dependent smoke remains pending because local Rust backend execution is still blocked by the Windows toolchain issues recorded earlier.

- [x] **Step 5: Commit**

```bash
git add packages/web-core/src/features/workflow packages/web-core/src/shared/lib/routes/appNavigation.ts packages/local-web/src/routes/_app.projects.$projectId_.workflows.tsx packages/local-web/src/routes/_app.projects.$projectId_.workflows_.$workflowId.edit.tsx packages/local-web/src/app/navigation/AppNavigation.ts packages/local-web/src/routeTree.gen.ts packages/remote-web/src/app/navigation/AppNavigation.ts
git commit -m "feat(workflow): add workflow template editor"
```

Result: committed in `feat(workflow): add workflow template editor`.

## Phase 4: Issue Entry Point, Run Canvas, Full Dashboard

### Task 4.1: Add Issue Detail Workflow Entry

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/RunWorkflowDialog.tsx`
- Create: `packages/web-core/src/pages/kanban/IssueWorkflowSectionContainer.tsx`
- Modify: `packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx`
- Modify: `packages/web-core/src/shared/lib/routes/appNavigation.ts`

- [ ] **Step 1: Implement dialog**

Dialog fields:

- template select with system/project templates
- run input textarea defaulting to issue title plus description
- main repo/branch selection using existing project/workspace defaults where available
- start button

- [ ] **Step 2: Trigger run and navigate**

After `workflowApi.trigger`, navigate to:

```text
/projects/:projectId/workflow-runs/:runId
```

- [ ] **Step 3: Run frontend checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/RunWorkflowDialog.tsx packages/web-core/src/pages/kanban/IssueWorkflowSectionContainer.tsx packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx packages/web-core/src/shared/lib/routes/appNavigation.ts
git commit -m "feat(workflow): add issue workflow entry point"
```

### Task 4.2: Build Run Page Canvas Tab

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
- Modify: `packages/local-web/src/routes/_app.projects.$projectId_.workflow-runs.$runId.tsx`

- [ ] **Step 1: Implement route and page shell**

Page has tabs:

- Canvas
- Dashboard

Default tab can be Dashboard, but Canvas must be directly selectable.

- [ ] **Step 2: Implement read-only run canvas**

Canvas displays:

- node status color
- edge status
- selected node detail drawer
- Human Gate approve/reject controls when applicable
- Arena open/pick-winner link when applicable

- [ ] **Step 3: Connect event stream**

Use `useWorkflowRunEvents` to refresh run state on:

- run status
- node status
- node output
- node error
- waiting human
- waiting arena

- [ ] **Step 4: Run checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx packages/local-web/src/routes/_app.projects.$projectId_.workflow-runs.$runId.tsx
git commit -m "feat(workflow): add workflow run canvas"
```

### Task 4.3: Build Full Dashboard Tab

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx`

- [ ] **Step 1: Implement seven dashboard sections**

Sections:

1. Header: issue, workflow, run id, status.
2. Progress: step count, elapsed time, cancel action.
3. Steps Timeline: node status, duration, session link.
4. Selected Step Detail: input, output, error, approval controls.
5. Decisions Made: Condition results, Human Gate decisions, Arena winner.
6. Agent Contribution: executor summary, step counts, durations, nullable token fields.
7. Code Changes: link to main workflow workspace diff.

- [ ] **Step 2: Add cancel and retry UI**

Use existing button/icon patterns and `workflowApi.cancelRun` / `workflowApi.retry`.

- [ ] **Step 3: Run checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm run dev`

Expected:

- run page loads by run id
- Dashboard tab shows all seven sections
- Canvas tab does not overlap text on desktop or mobile width
- approve/reject buttons call correct API

- [ ] **Step 5: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx packages/web-core/src/features/workflow/ui/WorkflowRunPage.tsx
git commit -m "feat(workflow): add workflow run dashboard"
```

## Phase 5: Arena Node Fan-Out, Manual Winner Selection, Diff Apply Backfill

### Task 5.1: Add Arena Node Server Integration

**Files:**
- Create: `crates/server/src/workflow_runtime/arena.rs`
- Modify: `crates/server/src/workflow_runtime/runner.rs`
- Modify: `crates/server/src/routes/workflows.rs`
- Modify: `crates/server/src/routes/local_remote.rs` only if Arena helper extraction is needed.

- [ ] **Step 1: Write tests with fake Arena port**

Cover:

- Arena node renders prompt from upstream outputs.
- Arena node creates one arena group.
- Arena attempts create independent workspaces.
- node execution stores `arena_group_id`.
- run and node become `awaiting_arena`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p server workflow_arena`

Expected: FAIL.

- [ ] **Step 3: Extract reusable Arena group creation helper**

The current Arena implementation lives in `crates/server/src/routes/local_remote.rs`. Extract only the minimum helper needed to create a group from workflow without changing existing Arena behavior.

Do not regress:

- `/api/local/v1/issues/{issue_id}/arena`
- `/api/local/v1/arena/{group_id}`
- `/api/local/v1/arena/{group_id}/promote`

- [ ] **Step 4: Implement Arena node handler adapter**

Arena branch naming:

```text
vk/<issue_id>-wf-<run_short_id>-arena-<idx>
```

Each attempt must use its own workspace/worktree. This is the "draw more candidates, pick best" behavior and must not share the main workflow worktree.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test -p server workflow_arena
cargo test -p server arena
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/workflow_runtime/arena.rs crates/server/src/workflow_runtime/runner.rs crates/server/src/routes/workflows.rs crates/server/src/routes/local_remote.rs
git commit -m "feat(workflow): add arena workflow node"
```

### Task 5.2: Implement Manual Winner Selection and Diff Apply

**Files:**
- Modify: `crates/server/src/workflow_runtime/arena.rs`
- Modify: `crates/server/src/routes/workflows.rs`

- [ ] **Step 1: Write tests**

Cover:

- selecting winner requires node status `awaiting_arena`
- winner workspace must belong to stored `arena_group_id`
- `git diff` from winner applies cleanly to main workflow worktree
- apply conflict fails node/run with conflict text
- successful apply stores winner output and resumes downstream nodes

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p server workflow_arena_winner`

Expected: FAIL.

- [ ] **Step 3: Implement diff apply**

Use existing git/workspace helpers where available. V1 strategy:

```text
winner worktree: git diff
main workflow worktree: git apply
```

If apply succeeds:

- Arena node status -> `succeeded`
- Arena node output -> winner final output plus diff summary
- workflow run status -> `running`
- runner resumes downstream nodes

If apply fails:

- Arena node status -> `failed`
- workflow run status -> `failed`
- error includes conflict message and winner workspace id

- [ ] **Step 4: Run tests**

Run: `cargo test -p server workflow_arena_winner`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/workflow_runtime/arena.rs crates/server/src/routes/workflows.rs
git commit -m "feat(workflow): apply workflow arena winner"
```

### Task 5.3: Add Arena Winner UI Backfill

**Files:**
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx`
- Modify: `packages/web-core/src/shared/lib/workflowApi.ts`
- Modify: `packages/web-core/src/features/arena/ui/ArenaView.tsx` only if an explicit "Return to workflow" affordance is needed.

- [ ] **Step 1: Add UI states**

When node is `awaiting_arena`, show:

- Arena group link
- attempt list if present in run response
- winner picker
- apply status/error

- [ ] **Step 2: Wire winner API**

Call:

```text
POST /api/local/v1/workflow-runs/{run_id}/nodes/{node_id}/arena-winner
```

Payload:

```json
{ "workspace_id": "<winner workspace uuid>" }
```

- [ ] **Step 3: Run checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Expected:

- workflow run pauses at Arena
- Arena page opens
- user can inspect attempts
- selecting winner resumes workflow
- conflict surfaces on dashboard if diff apply fails

- [ ] **Step 5: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx packages/web-core/src/features/workflow/ui/WorkflowRunDashboardTab.tsx packages/web-core/src/shared/lib/workflowApi.ts packages/web-core/src/features/arena/ui/ArenaView.tsx
git commit -m "feat(workflow): add arena winner controls"
```

## Final Integration and Acceptance

### Task 6.1: End-to-End Acceptance Pass

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run generated type check**

Run:

```bash
pnpm run generate-types
pnpm run generate-types:check
```

Expected: PASS and no unexpected generated churn.

- [ ] **Step 2: Run database prepare**

Run:

```bash
pnpm run prepare-db
```

Expected: PASS.

- [ ] **Step 3: Run backend checks**

Run:

```bash
cargo test -p workflow
cargo test -p db workflow
cargo test -p server workflow
cargo test --workspace
cargo check --workspace
```

Expected: PASS. If local `cargo` is unavailable, run these in CI or a Rust-enabled shell and record the blocker in the final handoff.

- [ ] **Step 4: Run frontend checks**

Run:

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
pnpm run check
pnpm run lint
```

Expected: PASS.

- [ ] **Step 5: Run formatter**

Run:

```bash
pnpm run format
```

Expected: formatting completes successfully.

- [ ] **Step 6: Manual product acceptance**

Run: `pnpm run dev`

Verify:

1. Create or open an issue.
2. Click Run workflow.
3. Choose built-in `Plan -> Arena -> Pick Winner -> Review`.
4. Start run.
5. Run creates one main workflow workspace.
6. Normal Agent nodes serialize on the main worktree.
7. Human Gate pauses and approve resumes.
8. Arena creates independent attempt worktrees.
9. Manual winner selection applies winner diff to main worktree.
10. Run continues and completes.
11. Dashboard shows final status, node outputs, decisions, session links, and code diff link.
12. Existing Arena issue flow still works.

- [ ] **Step 7: Final commit**

```bash
git status --short
git add .
git commit -m "feat(workflow): complete workflow v1"
```

## Known Risks and Guardrails

- `crates/server/src/routes/local_remote.rs` is already large. Extract only reusable Arena helpers needed by workflow; avoid unrelated route refactors.
- The workflow runner must not depend on `server` directly. Use traits in `crates/workflow/src/ports.rs` and server-side adapters.
- System template ids must be stable because `workflow_runs.workflow_id` references `workflows.id`.
- Do not allow project template save if backend validation fails.
- Do not let Arena attempts share the main workflow worktree.
- Do not add arbitrary JS transforms in V1.
- Do not implement global user templates, automatic LLM judging, loop nodes, checkpoint replay, or conflict-free shared-worktree concurrency in this plan.

## Review Note

The writing-plans skill normally asks for a dedicated plan-review subagent. Current tool policy only allows spawning subagents when the user explicitly asks for delegation/parallel agent work, so this document should be reviewed before execution by either:

- the user choosing Subagent-Driven execution, or
- an inline self-review pass using `superpowers:executing-plans`.
