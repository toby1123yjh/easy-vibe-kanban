# AI Arena v2 Implementation Plan

> This plan is the local execution guide for the v2 implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AI Arena v2 as a workspace-backed design discussion mode with side-by-side conversation panes, explicit implementation handoff, and no default commit behavior.

**Architecture:** Keep the existing arena group plus workspace model, but add mode and lifecycle semantics so Design Arena and Implementation Arena share infrastructure without sharing product meaning. Design Arena creates isolated `workspace / worktree / session` attempts, disables automatic commit paths, and renders conversation timelines as the primary comparison surface. Implementation Arena keeps the current diff/promote behavior as the advanced path.

**Tech Stack:** Rust, Axum, SQLx, SQLite, ts-rs, React, TypeScript, TanStack Query, existing workspace chat components, GitHub Actions, Playwright MCP, npm package workflow.

---

## Source Requirements

Use `docs/future/ai-arena/spec-v2.md` as the product source of truth.

Non-negotiable requirements:

- Design Arena still creates one workspace, worktree, and session per attempt.
- Those worktrees are discussion and context environments, not default implementation artifacts.
- The Arena page primarily shows side-by-side conversation panes, not diff summary cards.
- Agent output remains free text. Do not force structured response templates.
- No default commit: no automatic `git commit`, no executor commit reminder, no PR, no push, no promote.
- If code diff exists, show it as secondary state only.
- "Ask all", "challenge", and "synthesize" must be explicit user actions.
- "Start implementation from this" is the boundary where the selected workspace can become an implementation workspace.

## Scope Check

This plan covers one working v2 MVP. It intentionally does not implement scoring, voting, mandatory structured templates, automatic judging, or fully autonomous agent-to-agent debate.

The feature touches several layers, but they are not independent products. The backend mode/lifecycle work, execution policy, and conversation UI must land together to avoid shipping another diff-first Arena.

## File Structure

### Backend and Data

- Do not modify `crates/db/migrations/20260504000000_add_ai_arena.sql`
  - Treat the v1 migration as shipped history. Add a new migration for v2 changes.
- Create `crates/db/migrations/20260506000000_ai_arena_v2_design_mode.sql`
  - Adds arena mode, lifecycle status, close/adopt metadata, and indexes.
- Modify `crates/db/src/models/arena_group.rs`
  - Add `ArenaMode`, `ArenaLifecycleStatus`, new fields, lifecycle helpers, and active lookup semantics.
- Modify `crates/db/src/models/workspace.rs`
  - Add helper for resolving a workspace's arena group/mode when needed.
- Modify `crates/server/src/routes/local_remote.rs`
  - Extend Arena request/response types.
  - Default new groups to Design Arena.
  - Add close and start-implementation endpoints.
  - Add page-level message endpoint for ask-all/challenge/synthesize.
- Modify `crates/server/src/routes/sessions/mod.rs`
  - Preserve Design Arena no-commit prompt guard for follow-up messages inside design groups.
- Modify `crates/server/src/bin/generate_types.rs`
  - Export new arena enums and request/response types.

### Execution Policy

- Modify `crates/local-deployment/src/container.rs`
  - Disable auto-commit for open Design Arena workspaces.
  - Disable executor commit reminder for open Design Arena workspaces.
- Modify `crates/services/src/services/container.rs`
  - Add a small shared helper if needed, but prefer keeping policy lookup in local deployment if that is the only implementation.

### Frontend

- Modify `packages/web-core/src/shared/lib/arenaApi.ts`
  - Replace hand-maintained local arena types with generated types where possible.
  - Add close, message, and start-implementation calls.
- Modify `packages/web-core/src/shared/hooks/useArenaGroup.ts`
  - Poll by agent execution status, not `arena_status === active`.
  - Stop treating unpromoted groups as active if lifecycle is closed/adopted.
- Modify `packages/web-core/src/features/arena/ui/CreateArenaDialog.tsx`
  - Add mode selection, defaulting to Design Arena.
  - Clarify repository and branch source.
  - Keep branch selectable, not manual-only.
- Modify `packages/web-core/src/features/arena/ui/ArenaView.tsx`
  - Replace diff-grid content with conversation pane layout for Design Arena.
  - Keep Implementation Arena using the existing diff-oriented layout.
- Create `packages/web-core/src/features/arena/ui/ArenaConversationPane.tsx`
  - Self-contained pane that wraps existing `ConversationList` and `SessionChatBoxContainer`.
- Create `packages/web-core/src/features/arena/ui/ArenaPageActions.tsx`
  - Page-level `Ask all`, `Compare responses`, `Synthesize`, and `Start implementation` controls.
- Create `packages/web-core/src/features/arena/ui/ArenaModeBadge.tsx`
  - Small header badge for Design vs Implementation and lifecycle state.
- Modify `packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx`
  - Keep as Implementation Arena column, or rename to `ImplementationArenaWorkspaceColumn.tsx` if it improves readability.
- Modify `packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx`
  - Keep promote/retry actions scoped to Implementation Arena only.
- Modify `packages/web-core/src/features/arena/index.ts`
  - Export new components if needed.

### Validation

- Use GitHub Actions workflow `.github/workflows/test.yml` for full checks.
- Use GitHub Actions workflow `.github/workflows/publish-easy-npx.yml` for npm packaging validation.
- Use Playwright MCP against the installed npm package for runtime validation.
- Do not require local machine verification.

---

## Task 1: Persist Arena v2 Mode and Lifecycle

**Files:**
- Create: `crates/db/migrations/20260506000000_ai_arena_v2_design_mode.sql`
- Modify: `crates/db/src/models/arena_group.rs`
- Modify: `crates/db/src/models/workspace.rs`
- Modify: `crates/server/src/bin/generate_types.rs`

- [ ] **Step 1: Write the failing database/model tests**

Add tests in `crates/db/src/models/arena_group.rs` under `#[cfg(test)]`.

Target behavior:

```rust
#[tokio::test]
async fn active_group_lookup_ignores_closed_design_groups() {
    let pool = setup_arena_group_test_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();

    insert_project_and_issue(&pool, project_id, issue_id).await;

    let group = ArenaGroup::create(
        &pool,
        &CreateArenaGroup {
            issue_id,
            project_id,
            prompt: "Compare two designs".to_string(),
            base_branch: "main".to_string(),
            mode: ArenaMode::Design,
        },
    )
    .await
    .expect("create group");

    ArenaGroup::set_lifecycle_status(
        &pool,
        group.id,
        ArenaLifecycleStatus::Closed,
    )
    .await
    .expect("close group");

    let active = ArenaGroup::find_active_by_issue_id(&pool, issue_id)
        .await
        .expect("active lookup");

    assert!(active.is_none());
}
```

The helper schema only needs the columns referenced by `arena_groups`, `projects`, `local_issues`, and `workspaces`.

- [ ] **Step 2: Run test to verify it fails**

Run in GitHub Actions or a fully prepared dev environment:

```bash
cargo test -p db active_group_lookup_ignores_closed_design_groups
```

Expected: FAIL because `ArenaMode`, `ArenaLifecycleStatus`, and lifecycle lookup do not exist yet.

- [ ] **Step 3: Add migration**

Create `crates/db/migrations/20260506000000_ai_arena_v2_design_mode.sql`:

```sql
PRAGMA foreign_keys = ON;

ALTER TABLE arena_groups ADD COLUMN mode TEXT
    NOT NULL DEFAULT 'implementation'
    CHECK (mode IN ('design','implementation'));

ALTER TABLE arena_groups ADD COLUMN lifecycle_status TEXT
    NOT NULL DEFAULT 'open'
    CHECK (lifecycle_status IN ('open','closed','adopted','implementation_started'));

ALTER TABLE arena_groups ADD COLUMN closed_at TEXT;

ALTER TABLE arena_groups ADD COLUMN implementation_workspace_id BLOB
    REFERENCES workspaces(id) ON DELETE SET NULL;

UPDATE arena_groups
   SET lifecycle_status = CASE
       WHEN promoted_workspace_id IS NULL THEN 'open'
       ELSE 'adopted'
   END,
       implementation_workspace_id = promoted_workspace_id;

CREATE INDEX idx_arena_groups_issue_lifecycle
    ON arena_groups(issue_id, lifecycle_status);

CREATE INDEX idx_arena_groups_mode
    ON arena_groups(mode);

PRAGMA foreign_key_check;
```

- [ ] **Step 4: Add Rust enums and fields**

In `crates/db/src/models/arena_group.rs`, add:

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_mode", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaMode {
    #[default]
    Design,
    Implementation,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_lifecycle_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ArenaLifecycleStatus {
    #[default]
    Open,
    Closed,
    Adopted,
    ImplementationStarted,
}
```

Extend `ArenaGroup`:

```rust
pub struct ArenaGroup {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub mode: ArenaMode,
    pub lifecycle_status: ArenaLifecycleStatus,
    pub promoted_workspace_id: Option<Uuid>,
    pub implementation_workspace_id: Option<Uuid>,
    pub promoted_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

Extend `CreateArenaGroup`:

```rust
pub struct CreateArenaGroup {
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub mode: ArenaMode,
}
```

Update every `SELECT` and `RETURNING` in this file to include:

```sql
mode AS "mode!: ArenaMode",
lifecycle_status AS "lifecycle_status!: ArenaLifecycleStatus",
implementation_workspace_id AS "implementation_workspace_id: Uuid",
closed_at AS "closed_at: DateTime<Utc>"
```

Change `find_active_by_issue_id` to:

```sql
WHERE issue_id = $1
  AND lifecycle_status = 'open'
ORDER BY created_at DESC
LIMIT 1
```

Add helper methods:

```rust
pub async fn set_lifecycle_status(
    pool: &SqlitePool,
    group_id: Uuid,
    status: ArenaLifecycleStatus,
) -> Result<(), ArenaGroupError> {
    let closed_at = if status == ArenaLifecycleStatus::Closed {
        Some(Utc::now())
    } else {
        None
    };

    let result = sqlx::query!(
        r#"UPDATE arena_groups
              SET lifecycle_status = $1,
                  closed_at = COALESCE($2, closed_at),
                  updated_at = datetime('now', 'subsec')
            WHERE id = $3"#,
        status,
        closed_at,
        group_id
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ArenaGroupError::NotFound);
    }

    Ok(())
}

pub async fn set_implementation_workspace(
    pool: &SqlitePool,
    group_id: Uuid,
    workspace_id: Uuid,
) -> Result<(), ArenaGroupError> {
    let result = sqlx::query!(
        r#"UPDATE arena_groups
              SET implementation_workspace_id = $1,
                  lifecycle_status = 'implementation_started',
                  updated_at = datetime('now', 'subsec')
            WHERE id = $2"#,
        workspace_id,
        group_id
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ArenaGroupError::NotFound);
    }

    Ok(())
}
```

- [ ] **Step 5: Add workspace arena-mode helper**

In `crates/db/src/models/workspace.rs`, add:

```rust
pub async fn find_arena_group_for_workspace(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<Option<crate::models::arena_group::ArenaGroup>, sqlx::Error> {
    sqlx::query_as!(
        crate::models::arena_group::ArenaGroup,
        r#"SELECT ag.id AS "id!: Uuid",
                  ag.issue_id AS "issue_id!: Uuid",
                  ag.project_id AS "project_id!: Uuid",
                  ag.prompt,
                  ag.base_branch,
                  ag.mode AS "mode!: crate::models::arena_group::ArenaMode",
                  ag.lifecycle_status AS "lifecycle_status!: crate::models::arena_group::ArenaLifecycleStatus",
                  ag.promoted_workspace_id AS "promoted_workspace_id: Uuid",
                  ag.implementation_workspace_id AS "implementation_workspace_id: Uuid",
                  ag.promoted_at AS "promoted_at: chrono::DateTime<chrono::Utc>",
                  ag.closed_at AS "closed_at: chrono::DateTime<chrono::Utc>",
                  ag.created_at AS "created_at!: chrono::DateTime<chrono::Utc>",
                  ag.updated_at AS "updated_at!: chrono::DateTime<chrono::Utc>"
             FROM workspaces w
             JOIN arena_groups ag ON ag.id = w.arena_group_id
            WHERE w.id = $1"#,
        workspace_id
    )
    .fetch_optional(pool)
    .await
}
```

If the fully-qualified SQLx enum paths are too noisy, import the enum types at the top of the file and use the shorter paths.

- [ ] **Step 6: Export generated types**

In `crates/server/src/bin/generate_types.rs`, include:

```rust
db::models::arena_group::ArenaMode::decl(),
db::models::arena_group::ArenaLifecycleStatus::decl(),
```

- [ ] **Step 7: Run focused checks**

Run:

```bash
cargo test -p db active_group_lookup_ignores_closed_design_groups
pnpm run generate-types
pnpm run prepare-db
```

Expected: test PASS, `shared/types.ts` regenerated, `.sqlx` cache updated.

- [ ] **Step 8: Commit**

```bash
git add crates/db/migrations/20260506000000_ai_arena_v2_design_mode.sql crates/db/src/models/arena_group.rs crates/db/src/models/workspace.rs crates/server/src/bin/generate_types.rs shared/types.ts .sqlx
git commit -m "feat(arena): add v2 mode and lifecycle state"
```

---

## Task 2: Stop Default Commits in Open Design Arena Workspaces

**Files:**
- Modify: `crates/local-deployment/src/container.rs`
- Modify: `crates/server/src/routes/sessions/mod.rs`
- Test: `crates/local-deployment/src/container.rs`

- [ ] **Step 1: Write failing tests for commit policy**

Add tests around the new policy helper. Keep the test focused on decision logic rather than spawning real agents.

Suggested helper to add first in production code after the failing test:

```rust
async fn should_disable_default_commit_for_workspace(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<bool, sqlx::Error>
```

Test shape:

```rust
#[tokio::test]
async fn open_design_arena_workspace_disables_default_commit() {
    let pool = setup_container_policy_pool().await;
    let workspace_id = insert_workspace_in_arena(
        &pool,
        ArenaMode::Design,
        ArenaLifecycleStatus::Open,
    )
    .await;

    let disabled = should_disable_default_commit_for_workspace(&pool, workspace_id)
        .await
        .expect("policy lookup");

    assert!(disabled);
}

#[tokio::test]
async fn implementation_started_workspace_allows_normal_commit_policy() {
    let pool = setup_container_policy_pool().await;
    let workspace_id = insert_workspace_in_arena(
        &pool,
        ArenaMode::Design,
        ArenaLifecycleStatus::ImplementationStarted,
    )
    .await;

    let disabled = should_disable_default_commit_for_workspace(&pool, workspace_id)
        .await
        .expect("policy lookup");

    assert!(!disabled);
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cargo test -p local-deployment open_design_arena_workspace_disables_default_commit
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement policy helper**

In `crates/local-deployment/src/container.rs`, add near the other local helpers:

```rust
async fn should_disable_default_commit_for_workspace(
    pool: &SqlitePool,
    workspace_id: Uuid,
) -> Result<bool, sqlx::Error> {
    use db::models::arena_group::{ArenaLifecycleStatus, ArenaMode};

    let group = db::models::workspace::Workspace::find_arena_group_for_workspace(
        pool,
        workspace_id,
    )
    .await?;

    Ok(matches!(
        group.map(|g| (g.mode, g.lifecycle_status)),
        Some((ArenaMode::Design, ArenaLifecycleStatus::Open))
    ))
}
```

- [ ] **Step 4: Skip automatic commit in `try_commit_changes`**

At the top of `LocalContainerService::try_commit_changes` in `crates/local-deployment/src/container.rs`, after the run reason check:

```rust
if should_disable_default_commit_for_workspace(&self.db.pool, ctx.workspace.id)
    .await
    .map_err(ContainerError::from)?
{
    tracing::info!(
        workspace_id = %ctx.workspace.id,
        "Skipping automatic commit for open Design Arena workspace"
    );
    return Ok(false);
}
```

This directly addresses the current auto-commit path, which calls `try_commit_changes` after successful coding-agent and cleanup-script execution.

- [ ] **Step 5: Disable executor commit reminder in `start_execution_inner`**

In `LocalContainerService::start_execution_inner`, replace:

```rust
let commit_reminder_enabled = config.commit_reminder_enabled;
```

with:

```rust
let design_arena_no_commit =
    should_disable_default_commit_for_workspace(&self.db.pool, workspace.id)
        .await
        .map_err(ContainerError::from)?;
let commit_reminder_enabled =
    config.commit_reminder_enabled && !design_arena_no_commit;
```

Keep the existing `commit_reminder_prompt` resolution unchanged.

- [ ] **Step 6: Guard follow-up prompts inside Design Arena**

In `crates/server/src/routes/sessions/mod.rs`, before building `ExecutorActionType`, wrap `payload.prompt` when the session workspace belongs to an open Design Arena:

```rust
fn design_arena_prompt(prompt: &str) -> String {
    format!(
        "You are in AI Arena Design Mode.\n\
         Focus on design reasoning, tradeoffs, risks, and decision support.\n\
         Do not create commits, push branches, open PRs, or treat code changes as the final output unless the user explicitly asks to start implementation.\n\n\
         User request:\n{}",
        prompt
    )
}
```

Then:

```rust
let mut prompt = payload.prompt;
if is_open_design_arena_workspace(pool, workspace.id).await? {
    prompt = design_arena_prompt(&prompt);
}
```

Put `is_open_design_arena_workspace` in a small shared helper in the same module or reuse the db helper from Task 1.

- [ ] **Step 7: Run focused tests**

```bash
cargo test -p local-deployment open_design_arena_workspace_disables_default_commit implementation_started_workspace_allows_normal_commit_policy
cargo check -p server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/local-deployment/src/container.rs crates/server/src/routes/sessions/mod.rs
git commit -m "fix(arena): disable default commits in design mode"
```

---

## Task 3: Add Design Arena API Semantics

**Files:**
- Modify: `crates/server/src/routes/local_remote.rs`
- Modify: `crates/server/src/bin/generate_types.rs`
- Test: `crates/server/src/routes/local_remote.rs`

- [ ] **Step 1: Write failing route/model tests**

Add tests in `crates/server/src/routes/local_remote.rs` test module for pure helpers first.

Target behavior:

```rust
#[test]
fn design_arena_initial_prompt_contains_no_commit_guard() {
    let prompt = super::build_design_arena_prompt("Compare two UI approaches");

    assert!(prompt.contains("Design Mode"));
    assert!(prompt.contains("Do not create commits"));
    assert!(prompt.contains("Compare two UI approaches"));
}

#[test]
fn implementation_arena_prompt_is_not_wrapped() {
    let prompt = super::build_attempt_prompt(
        ArenaMode::Implementation,
        "Implement the selected design",
    );

    assert_eq!(prompt, "Implement the selected design");
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cargo test -p server design_arena_initial_prompt_contains_no_commit_guard
```

Expected: FAIL because helper functions and mode fields do not exist.

- [ ] **Step 3: Extend request and response types**

In `crates/server/src/routes/local_remote.rs`, update `CreateArenaRequest`:

```rust
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct CreateArenaRequest {
    pub project_id: Uuid,
    pub base_branch: String,
    pub prompt: String,
    #[serde(default)]
    pub mode: ArenaMode,
    pub repos: Vec<WorkspaceRepoInput>,
    pub attempts: Vec<ArenaAttemptInput>,
}
```

Extend `ArenaWorkspaceSummary`:

```rust
#[derive(Debug, Clone, Serialize, TS)]
pub struct ArenaWorkspaceSummary {
    pub workspace_id: Uuid,
    pub session_id: Option<Uuid>,
    pub name: Option<String>,
    pub branch: String,
    pub arena_status: ArenaStatus,
    pub executor: Option<String>,
    pub variant: Option<String>,
    pub latest_execution_status: Option<ExecutionProcessStatus>,
    pub has_uncommitted_changes: Option<bool>,
}
```

`session_id` should be the latest session for the workspace. `latest_execution_status` should come from the latest coding-agent execution process, not from `arena_status`.

- [ ] **Step 4: Add prompt helpers**

In `crates/server/src/routes/local_remote.rs`:

```rust
fn build_design_arena_prompt(prompt: &str) -> String {
    format!(
        "You are in AI Arena Design Mode.\n\
         Your goal is to produce a design direction, reasoning, tradeoffs, risks, and decision support.\n\
         Use free-form prose. Do not force a fixed template.\n\
         You may inspect the repository for context, but do not create commits, push branches, open PRs, or treat code changes as the final output.\n\
         If you change files while exploring, leave them uncommitted unless the user explicitly asks to start implementation.\n\n\
         User request:\n{}",
        prompt
    )
}

fn build_attempt_prompt(mode: ArenaMode, prompt: &str) -> String {
    match mode {
        ArenaMode::Design => build_design_arena_prompt(prompt),
        ArenaMode::Implementation => prompt.to_string(),
    }
}
```

- [ ] **Step 5: Default create flow to Design Arena**

In `create_arena_group`, destructure `mode` from payload, defaulting to `ArenaMode::Design`.

When creating the group:

```rust
let group = ArenaGroup::create(
    pool,
    &CreateArenaGroup {
        issue_id,
        project_id,
        prompt: prompt.clone(),
        base_branch: base_branch.clone(),
        mode,
    },
)
.await?;
```

When spawning attempts:

```rust
let attempt_prompt = build_attempt_prompt(group.mode, &attempt_prompt);
```

- [ ] **Step 6: Replace active conflict semantics**

Keep the existing error string compatible, but make the lookup depend on lifecycle:

```rust
if ArenaGroup::find_active_by_issue_id(pool, issue_id).await?.is_some() {
    return Err(ApiError::BadRequest(format!(
        "issue {issue_id} already has an active arena group; close, adopt, promote, or dissolve it first"
    )));
}
```

- [ ] **Step 7: Add close endpoint**

Add request/response:

```rust
#[derive(Debug, Clone, Serialize, TS)]
pub struct CloseArenaResponse {
    pub group_id: Uuid,
    pub lifecycle_status: ArenaLifecycleStatus,
}
```

Handler:

```rust
async fn close_arena_group(
    State(deployment): State<DeploymentImpl>,
    Path(group_id): Path<Uuid>,
) -> Result<ResponseJson<MutationResponse<CloseArenaResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let group = ArenaGroup::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::from(ArenaGroupError::NotFound))?;

    if group.lifecycle_status != ArenaLifecycleStatus::Open {
        return Ok(ResponseJson(MutationResponse {
            data: CloseArenaResponse {
                group_id,
                lifecycle_status: group.lifecycle_status,
            },
            txid: txid(),
        }));
    }

    ArenaGroup::set_lifecycle_status(
        pool,
        group_id,
        ArenaLifecycleStatus::Closed,
    )
    .await?;

    Ok(ResponseJson(MutationResponse {
        data: CloseArenaResponse {
            group_id,
            lifecycle_status: ArenaLifecycleStatus::Closed,
        },
        txid: txid(),
    }))
}
```

Route:

```rust
.route("/v1/arena/{group_id}/close", post(close_arena_group))
```

This fixes the "opened then closed once, still active" class of bugs without deleting the conversation history.

- [ ] **Step 8: Add start-implementation endpoint**

Add request:

```rust
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct StartArenaImplementationRequest {
    pub workspace_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_up_prompt: Option<String>,
}
```

Handler semantics:

- Verify the workspace belongs to the group.
- Set `implementation_workspace_id`.
- Set lifecycle to `implementation_started`.
- Do not auto-promote or merge.
- If `follow_up_prompt` is present, send it through the existing session follow-up path after lifecycle is changed, so normal implementation commit policy can apply.

Route:

```rust
.route(
    "/v1/arena/{group_id}/start-implementation",
    post(start_arena_implementation),
)
```

- [ ] **Step 9: Add page-level message endpoint**

Add one endpoint instead of several special-case endpoints:

```rust
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ArenaMessageTarget {
    All,
    Workspace { workspace_id: Uuid },
    Challenge {
        responder_workspace_id: Uuid,
        source_workspace_id: Uuid,
    },
    Synthesize,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
pub struct ArenaMessageRequest {
    pub target: ArenaMessageTarget,
    pub prompt: String,
    pub executor_config: ExecutorConfig,
}
```

Behavior:

- `All`: send the prompt to every open attempt session.
- `Workspace`: send to one attempt session.
- `Challenge`: load the latest `CodingAgentTurn.summary` for `source_workspace_id`, then send the prompt plus that summary to `responder_workspace_id`.
- `Synthesize`: create a moderator session attached to the arena group if a suitable storage model exists; if not, return synthesized text as a page-level generated turn in the selected workspace for v2 MVP.

Challenge prompt shape:

```rust
fn build_challenge_prompt(user_prompt: &str, source_label: &str, source_summary: &str) -> String {
    format!(
        "The user wants you to critique or respond to another Arena attempt.\n\
         Other attempt: {source_label}\n\n\
         Other attempt summary:\n{source_summary}\n\n\
         User instruction:\n{user_prompt}"
    )
}
```

- [ ] **Step 10: Run focused checks**

```bash
cargo test -p server design_arena_initial_prompt_contains_no_commit_guard implementation_arena_prompt_is_not_wrapped
pnpm run generate-types
pnpm run prepare-db
```

Expected: PASS and generated type/schema files updated.

- [ ] **Step 11: Commit**

```bash
git add crates/server/src/routes/local_remote.rs crates/server/src/bin/generate_types.rs shared/types.ts .sqlx
git commit -m "feat(arena): add design-mode API semantics"
```

---

## Task 4: Update Frontend Arena API and Hooks

**Files:**
- Modify: `packages/web-core/src/shared/lib/arenaApi.ts`
- Modify: `packages/web-core/src/shared/hooks/useArenaGroup.ts`
- Test: TypeScript compile via `packages/web-core`

- [ ] **Step 1: Write failing type usage**

Update `packages/web-core/src/shared/lib/arenaApi.ts` imports to prefer generated types:

```ts
import type {
  ArenaGroupResponse,
  ArenaMessageRequest,
  CloseArenaResponse,
  CreateArenaRequest,
  PromoteArenaRequest,
  RetryArenaRequest,
  StartArenaImplementationRequest,
} from 'shared/types';
```

This should initially fail until generated types exist.

- [ ] **Step 2: Run type check to verify failure**

```bash
pnpm --filter @vibe/web-core run check
```

Expected: FAIL if Task 3 types have not been generated or if local duplicate types conflict.

- [ ] **Step 3: Replace manual arena type declarations**

Remove the hand-written `ArenaGroup`, `ArenaWorkspaceSummary`, and request/response interfaces in `arenaApi.ts` after generated equivalents are available.

Keep transport functions:

```ts
close: (groupId: string): Promise<CloseArenaResponse> =>
  mutate<CloseArenaResponse>(
    `/arena/${groupId}/close`,
    { method: 'POST' },
    'Failed to close arena group'
  ),

message: (
  groupId: string,
  payload: ArenaMessageRequest
): Promise<ArenaGroupResponse> =>
  mutate<ArenaGroupResponse>(
    `/arena/${groupId}/message`,
    { method: 'POST', body: JSON.stringify(payload) },
    'Failed to send arena message'
  ),

startImplementation: (
  groupId: string,
  payload: StartArenaImplementationRequest
): Promise<ArenaGroupResponse> =>
  mutate<ArenaGroupResponse>(
    `/arena/${groupId}/start-implementation`,
    { method: 'POST', body: JSON.stringify(payload) },
    'Failed to start implementation from arena attempt'
  ),
```

- [ ] **Step 4: Poll by execution status**

In `useArenaGroup.ts`, replace the existing polling condition:

```ts
const stillRunning = data.workspaces.some(
  (ws) => ws.arena_status === 'active'
);
```

with:

```ts
const stillRunning = data.workspaces.some(
  (ws) => ws.latest_execution_status === 'running'
);
```

Use the generated enum/string shape exactly as produced in `shared/types.ts`.

- [ ] **Step 5: Stop active issue query after close/adopt**

In `useActiveArenaForIssue`, treat `null` and non-open lifecycle as stable:

```ts
if (!data || data.lifecycle_status !== 'open') return false;
```

- [ ] **Step 6: Run type check**

```bash
pnpm --filter @vibe/web-core run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web-core/src/shared/lib/arenaApi.ts packages/web-core/src/shared/hooks/useArenaGroup.ts
git commit -m "feat(arena): update frontend api for v2 semantics"
```

---

## Task 5: Build Side-by-Side Design Conversation Panes

**Files:**
- Create: `packages/web-core/src/features/arena/ui/ArenaConversationPane.tsx`
- Create: `packages/web-core/src/features/arena/ui/ArenaModeBadge.tsx`
- Modify: `packages/web-core/src/features/arena/ui/ArenaView.tsx`
- Modify: `packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx`
- Modify: `packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx`

- [ ] **Step 1: Create compile-failing component skeleton**

Create `ArenaConversationPane.tsx` with imports and props first:

```tsx
import { useMemo, useRef, useCallback, useState } from 'react';
import type { ArenaGroupResponse, ArenaWorkspaceSummary } from 'shared/types';
import { ConversationList, type ConversationListHandle } from '@/features/workspace-chat/ui/ConversationListContainer';
import { SessionChatBoxContainer } from '@/features/workspace-chat/ui/SessionChatBoxContainer';
import { EntriesProvider } from '@/features/workspace-chat/model/contexts/EntriesContext';
import { MessageEditProvider } from '@/features/workspace-chat/model/contexts/MessageEditContext';
import { RetryUiProvider } from '@/features/workspace-chat/model/contexts/RetryUiContext';
import { ApprovalFeedbackProvider } from '@/features/workspace-chat/model/contexts/ApprovalFeedbackContext';
import { useWorkspaceRecord } from '@/shared/hooks/useWorkspaceRecord';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { useWorkspaceSessions } from '@/shared/hooks/useWorkspaceSessions';
import { useDiffSummary } from '@/shared/hooks/useDiffSummary';
import { createWorkspaceWithSession } from '@/shared/types/attempt';

interface ArenaConversationPaneProps {
  group: ArenaGroupResponse;
  workspace: ArenaWorkspaceSummary;
  detailHref?: string;
}

export function ArenaConversationPane(_props: ArenaConversationPaneProps) {
  return null;
}
```

- [ ] **Step 2: Run type check to verify skeleton issues**

```bash
pnpm --filter @vibe/web-core run check
```

Expected: FAIL if imports or generated types are not aligned. Fix only import/type names before continuing.

- [ ] **Step 3: Implement isolated pane providers**

Replace `return null` with:

```tsx
export function ArenaConversationPane({
  group,
  workspace,
  detailHref,
}: ArenaConversationPaneProps) {
  const conversationListRef = useRef<ConversationListHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const { data: workspaceRecord, isLoading: workspaceLoading } =
    useWorkspaceRecord(workspace.workspace_id);
  const { repos } = useWorkspaceRepo(workspace.workspace_id);
  const {
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    isLoading: sessionsLoading,
    isNewSessionMode,
    startNewSession,
  } = useWorkspaceSessions(workspace.workspace_id);
  const diffSummary = useDiffSummary(workspace.workspace_id);

  const attempt = useMemo(() => {
    if (!workspaceRecord) return undefined;
    return createWorkspaceWithSession(workspaceRecord, selectedSession);
  }, [workspaceRecord, selectedSession]);

  const handleScrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      conversationListRef.current?.scrollToBottom(behavior);
    },
    []
  );

  const handleScrollToPreviousMessage = useCallback(() => {
    conversationListRef.current?.scrollToPreviousUserMessage();
  }, []);

  const handleScrollToUserMessage = useCallback((patchKey: string) => {
    conversationListRef.current?.scrollToEntryByPatchKey(patchKey);
  }, []);

  const handleGetActiveTurnPatchKey = useCallback(() => {
    return conversationListRef.current?.getVisibleUserMessagePatchKey() ?? null;
  }, []);

  const entriesProviderKey = `${workspace.workspace_id}:${selectedSessionId ?? 'new'}`;

  return (
    <section className="flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden rounded border border-zinc-200 bg-primary dark:border-zinc-800">
      <div className="border-b border-zinc-200 px-base py-half dark:border-zinc-800">
        <div className="flex items-center justify-between gap-half">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {workspace.executor ?? workspace.name ?? 'Agent'}
            </div>
            <div className="truncate text-xs text-low">
              {workspace.variant ?? group.mode}
            </div>
          </div>
          {detailHref ? (
            <a className="text-xs text-link" href={detailHref}>
              Open workspace
            </a>
          ) : null}
        </div>
      </div>

      {workspaceLoading || sessionsLoading || !attempt ? (
        <div className="flex flex-1 items-center justify-center text-sm text-low">
          Loading conversation...
        </div>
      ) : (
        <ApprovalFeedbackProvider>
          <EntriesProvider key={entriesProviderKey}>
            <MessageEditProvider>
              <RetryUiProvider workspaceId={workspace.workspace_id}>
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ConversationList
                      key={entriesProviderKey}
                      ref={conversationListRef}
                      attempt={attempt}
                      repos={repos}
                      onAtBottomChange={setIsAtBottom}
                      sessionScopeId={selectedSessionId}
                    />
                  </div>
                  <div data-chatbox-container="true" className="border-t border-zinc-200 dark:border-zinc-800">
                    <SessionChatBoxContainer
                      mode={
                        isNewSessionMode
                          ? 'new-session'
                          : selectedSession
                            ? 'existing-session'
                            : 'placeholder'
                      }
                      {...(isNewSessionMode
                        ? {
                            workspaceId: workspace.workspace_id,
                            onSelectSession: selectSession,
                          }
                        : selectedSession
                          ? {
                              session: selectedSession,
                              onSelectSession: selectSession,
                              onStartNewSession: startNewSession,
                            }
                          : {})}
                      sessions={sessions}
                      filesChanged={diffSummary.fileCount}
                      linesAdded={diffSummary.added}
                      linesRemoved={diffSummary.deleted}
                      disableViewCode={true}
                      showOpenWorkspaceButton={true}
                      onScrollToPreviousMessage={handleScrollToPreviousMessage}
                      onScrollToBottom={handleScrollToBottom}
                      onScrollToUserMessage={handleScrollToUserMessage}
                      getActiveTurnPatchKey={handleGetActiveTurnPatchKey}
                    />
                  </div>
                </div>
              </RetryUiProvider>
            </MessageEditProvider>
          </EntriesProvider>
        </ApprovalFeedbackProvider>
      )}
    </section>
  );
}
```

If TypeScript rejects the discriminated union spreading into `SessionChatBoxContainer`, split the chat box into a small helper component with explicit branches, matching `WorkspacesMainContainer.tsx`.

- [ ] **Step 4: Add mode badge**

Create `ArenaModeBadge.tsx`:

```tsx
import type { ArenaGroupResponse } from 'shared/types';

export function ArenaModeBadge({ group }: { group: ArenaGroupResponse }) {
  const label = group.mode === 'design' ? 'Design Arena' : 'Implementation Arena';
  return (
    <span className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-low dark:border-zinc-800">
      {label} · {group.lifecycle_status}
    </span>
  );
}
```

- [ ] **Step 5: Split ArenaView by mode**

In `ArenaView.tsx`, keep `ArenaHeader`, but update content:

```tsx
const isDesignArena = data.mode === 'design';

return (
  <div className="flex h-full flex-col">
    <ArenaHeader group={data} onDissolved={handleDissolved} />
    {isDesignArena ? (
      <div className="flex min-h-0 flex-1 gap-base overflow-x-auto p-base">
        {data.workspaces.map((ws) => (
          <ArenaConversationPane
            key={ws.workspace_id}
            group={data}
            workspace={ws}
            detailHref={buildWorkspaceHref?.(ws.workspace_id)}
          />
        ))}
      </div>
    ) : (
      <div className={`grid flex-1 gap-base overflow-auto p-base ${columnsClassName}`}>
        {data.workspaces.map((ws) => (
          <ArenaWorkspaceColumn
            key={ws.workspace_id}
            group={data}
            workspace={ws}
            detailHref={buildWorkspaceHref?.(ws.workspace_id)}
          />
        ))}
      </div>
    )}
  </div>
);
```

- [ ] **Step 6: Hide promote/retry in Design Arena**

In `ArenaActionsBar.tsx`, early return for design mode:

```tsx
if (group.mode === 'design') {
  return null;
}
```

Design actions move to `ArenaPageActions` in Task 6.

- [ ] **Step 7: Run type check**

```bash
pnpm --filter @vibe/web-core run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web-core/src/features/arena/ui/ArenaConversationPane.tsx packages/web-core/src/features/arena/ui/ArenaModeBadge.tsx packages/web-core/src/features/arena/ui/ArenaView.tsx packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx
git commit -m "feat(arena): show design attempts as conversation panes"
```

---

## Task 6: Add Design Arena Page Actions

**Files:**
- Create: `packages/web-core/src/features/arena/ui/ArenaPageActions.tsx`
- Modify: `packages/web-core/src/features/arena/ui/ArenaView.tsx`
- Modify: `packages/web-core/src/shared/lib/arenaApi.ts`
- Modify: `packages/web-core/src/shared/hooks/useArenaActions.ts`

- [ ] **Step 1: Add API action hooks**

In `useArenaActions.ts`, add mutations:

```ts
const close = useMutation({
  mutationFn: () => arenaApi.close(groupId),
  onSuccess: () => {
    invalidateGroup(groupId);
    invalidateIssue(issueId);
  },
});

const message = useMutation({
  mutationFn: (payload: ArenaMessageRequest) =>
    arenaApi.message(groupId, payload),
  onSuccess: (group) => {
    queryClient.setQueryData(arenaQueryKeys.group(group.id), group);
    invalidateGroup(group.id);
  },
});

const startImplementation = useMutation({
  mutationFn: (payload: StartArenaImplementationRequest) =>
    arenaApi.startImplementation(groupId, payload),
  onSuccess: (group) => {
    queryClient.setQueryData(arenaQueryKeys.group(group.id), group);
    invalidateGroup(group.id);
    invalidateIssue(group.issue_id);
  },
});
```

- [ ] **Step 2: Create ArenaPageActions skeleton**

```tsx
import { useState } from 'react';
import { Button } from '@vibe/ui/components/Button';
import { Textarea } from '@vibe/ui/components/Textarea';
import type { ArenaGroupResponse, ArenaWorkspaceSummary } from 'shared/types';
import { useArenaActions } from '@/shared/hooks/useArenaActions';

interface ArenaPageActionsProps {
  group: ArenaGroupResponse;
}

export function ArenaPageActions({ group }: ArenaPageActionsProps) {
  return null;
}
```

- [ ] **Step 3: Implement Ask All**

Add state:

```tsx
const [messageText, setMessageText] = useState('');
const [error, setError] = useState<string | null>(null);
const { message, startImplementation } = useArenaActions(group.id, group.issue_id);
```

Add handler:

```tsx
const handleAskAll = async () => {
  const prompt = messageText.trim();
  if (!prompt) return;
  setError(null);
  try {
    await message.mutateAsync({
      target: { type: 'all' },
      prompt,
      executor_config: {
        executor: group.workspaces[0]?.executor ?? 'codex',
        variant: null,
        model_id: null,
        agent_id: null,
        reasoning_id: null,
        permission_policy: null,
      },
    });
    setMessageText('');
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to ask all');
  }
};
```

If generated `ArenaMessageTarget` shape differs, match the generated ts-rs union exactly.

- [ ] **Step 4: Implement Synthesize**

Add button handler:

```tsx
const handleSynthesize = async () => {
  setError(null);
  try {
    await message.mutateAsync({
      target: { type: 'synthesize' },
      prompt:
        'Synthesize the Arena attempts into a concise decision memo. Preserve disagreement and tradeoffs.',
      executor_config: {
        executor: group.workspaces[0]?.executor ?? 'codex',
        variant: null,
        model_id: null,
        agent_id: null,
        reasoning_id: null,
        permission_policy: null,
      },
    });
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to synthesize');
  }
};
```

- [ ] **Step 5: Implement Start Implementation**

Render one button per attempt:

```tsx
const handleStartImplementation = async (workspace: ArenaWorkspaceSummary) => {
  setError(null);
  try {
    await startImplementation.mutateAsync({
      workspace_id: workspace.workspace_id,
      follow_up_prompt: null,
    });
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : 'Failed to start implementation'
    );
  }
};
```

Button label: `Start implementation`.

- [ ] **Step 6: Wire actions into ArenaView**

In `ArenaView.tsx`, render below header for design mode:

```tsx
{data.mode === 'design' ? <ArenaPageActions group={data} /> : null}
```

Keep the actions as a full-width band, not a nested card.

- [ ] **Step 7: Run type check**

```bash
pnpm --filter @vibe/web-core run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web-core/src/features/arena/ui/ArenaPageActions.tsx packages/web-core/src/features/arena/ui/ArenaView.tsx packages/web-core/src/shared/hooks/useArenaActions.ts packages/web-core/src/shared/lib/arenaApi.ts
git commit -m "feat(arena): add design arena page actions"
```

---

## Task 7: Fix Arena Creation UX

**Files:**
- Modify: `packages/web-core/src/features/arena/ui/CreateArenaDialog.tsx`
- Modify: `packages/web-core/src/pages/kanban/IssueArenaSectionContainer.tsx`

- [ ] **Step 1: Add mode selection UI**

In `CreateArenaDialog.tsx`, add state:

```tsx
const [mode, setMode] = useState<'design' | 'implementation'>('design');
```

Payload:

```tsx
const payload: CreateArenaRequest = {
  project_id: projectId,
  base_branch: baseBranch.trim(),
  prompt: prompt.trim(),
  mode,
  repos: [{ repo_id: repoId, target_branch: baseBranch.trim() }],
  attempts: attempts.map(...),
};
```

- [ ] **Step 2: Replace race wording**

Change title/description:

```tsx
<DialogTitle>
  {mode === 'design'
    ? `Start Design Arena · ${attempts.length} attempts`
    : `Start Implementation Arena · ${attempts.length} attempts`}
</DialogTitle>
<DialogDescription>
  {mode === 'design'
    ? 'Compare multiple agents as design conversations. Workspaces are isolated, but commits are not created by default.'
    : 'Run multiple implementation attempts and compare their code changes.'}
</DialogDescription>
```

- [ ] **Step 3: Make repository source obvious**

Keep the existing select, but add a short source line under it:

```tsx
{selectedRepo ? (
  <p className="truncate text-[11px] text-low" title={selectedRepo.path}>
    Loaded from local repositories · {selectedRepo.path}
  </p>
) : null}
```

- [ ] **Step 4: Keep branch selectable**

Do not replace `BranchSelector` with a text input. Existing `useRepoBranches` plus `BranchSelector` is the right direction. Make sure the selected branch falls back in this order:

1. project repo default target branch
2. repo default target branch
3. current branch from branch API
4. first branch from branch API

- [ ] **Step 5: Fix Cancel and close semantics**

Verify `handleOpenChange(false)` resolves `{ kind: 'canceled' }` and hides the modal without calling create.

In `IssueArenaSectionContainer.tsx`, when an active group is closed, invalidate:

```ts
queryClient.invalidateQueries({
  queryKey: arenaQueryKeys.activeForIssue(issueId),
});
```

- [ ] **Step 6: Run frontend checks**

```bash
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/local-web run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web-core/src/features/arena/ui/CreateArenaDialog.tsx packages/web-core/src/pages/kanban/IssueArenaSectionContainer.tsx
git commit -m "fix(arena): clarify design arena creation flow"
```

---

## Task 8: Preserve Implementation Arena Behavior

**Files:**
- Modify: `packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx`
- Modify: `packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx`
- Modify: `crates/server/src/routes/local_remote.rs`

- [ ] **Step 1: Verify current diff behavior remains accessible**

Search:

```bash
rg -n "ArenaWorkspaceColumn|ArenaActionsBar|promote_arena_workspace|retry_arena_workspace" packages/web-core/src/features/arena crates/server/src/routes/local_remote.rs
```

Expected: Implementation Arena still calls the same promote/retry backend routes.

- [ ] **Step 2: Add mode guards**

Backend promote should reject design groups unless implementation has started:

```rust
if group.mode == ArenaMode::Design
    && group.lifecycle_status != ArenaLifecycleStatus::ImplementationStarted
{
    return Err(ApiError::BadRequest(
        "Design Arena attempts must be started as implementation before promote.".to_string(),
    ));
}
```

Frontend `ArenaActionsBar` already returns null for `group.mode === 'design'` from Task 5.

- [ ] **Step 3: Add backend test**

```rust
#[tokio::test]
async fn promote_rejects_open_design_arena() {
    // Build an open design group with one workspace.
    // Call promote helper or route handler.
    // Assert 400 Bad Request with "started as implementation".
}
```

- [ ] **Step 4: Run backend test**

```bash
cargo test -p server promote_rejects_open_design_arena
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/routes/local_remote.rs packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx
git commit -m "fix(arena): keep promote scoped to implementation mode"
```

---

## Task 9: Remote Validation and npm/Playwright Acceptance

**Files:**
- No production files unless validation exposes bugs.
- Use existing workflows: `.github/workflows/test.yml`, `.github/workflows/publish-easy-npx.yml`

- [ ] **Step 1: Push branch and run GitHub Actions**

```bash
git push origin feat/ai-arena
```

Expected:

- `Test` workflow passes, especially frontend checks, backend schema checks, backend tests.
- If SQLx/types drift exists, run the existing `regen-sqlx-and-types.yml` workflow or commit regenerated files.

- [ ] **Step 2: Publish npm package through workflow**

Use `.github/workflows/publish-easy-npx.yml` with the next version, for example:

```text
version: 0.1.44-easy.3
npm_tag: latest
publish_mode: publish
```

Expected:

- Windows x64 package builds.
- npm publish succeeds.
- `npm view easy-vibe-kanban@0.1.44-easy.3 version` returns `0.1.44-easy.3`.

- [ ] **Step 3: Install package on test machine**

On the test machine:

```bash
npm install -g easy-vibe-kanban@0.1.44-easy.3
easy-vibe-kanban
```

Expected: app starts and prints or opens the local URL.

- [ ] **Step 4: Playwright acceptance test**

Use Playwright MCP against the npm-installed app and test repo:

```text
F:\Mydev2023\devSpace\opensource\arthas_mcp_server
```

Acceptance path:

1. Open app URL.
2. Open or create project for `arthas_mcp_server`.
3. Create a simple issue, for example: "Compare two approaches for adding a small README note. Do not submit code."
4. Start Arena with `Design Arena`.
5. Select two Codex attempts.
6. Confirm repository select shows repo name and path.
7. Confirm branch is selectable from branch picker.
8. Start Arena.
9. Confirm page shows two side-by-side conversation panes.
10. Confirm agent text is visible in the Arena page without entering workspace detail.
11. Confirm no empty `Waiting for first changes...` primary state when no diff exists.
12. Confirm no local commit is created by default.
13. Close the Arena.
14. Start another Design Arena for the same issue.
15. Confirm no "already has an active arena group" error after close.
16. Click `Start implementation` on one attempt.
17. Confirm selected workspace can be opened and normal workspace conversation continues.

- [ ] **Step 5: Capture evidence**

Save:

- GitHub Actions run URLs.
- npm package version.
- Playwright screenshots of side-by-side panes.
- Playwright notes for no default commit and active-group close behavior.

- [ ] **Step 6: Commit validation notes if needed**

If validation exposes product notes, update:

```bash
docs/future/ai-arena/spec-v2.md
docs/future/ai-arena/impl-v2-2026-05.md
```

Commit:

```bash
git add docs/future/ai-arena/spec-v2.md docs/future/ai-arena/impl-v2-2026-05.md
git commit -m "docs(arena): record v2 validation results"
```

---

## Final Verification Checklist

Run via GitHub Actions unless the local environment is known-good:

- [ ] `pnpm run generate-types:check`
- [ ] `pnpm run prepare-db:check`
- [ ] `pnpm --filter @vibe/web-core run check`
- [ ] `pnpm --filter @vibe/local-web run check`
- [ ] `cargo test -p db active_group_lookup_ignores_closed_design_groups`
- [ ] `cargo test -p local-deployment open_design_arena_workspace_disables_default_commit`
- [ ] `cargo test -p server design_arena_initial_prompt_contains_no_commit_guard`
- [ ] `cargo test -p server promote_rejects_open_design_arena`
- [ ] Full `.github/workflows/test.yml` passes.
- [ ] npm package publishes through `.github/workflows/publish-easy-npx.yml`.
- [ ] Playwright acceptance passes against installed npm package.

## Implementation Notes

- Do not manually edit `shared/types.ts`; regenerate through `pnpm run generate-types`.
- Do not manually edit SQLx metadata if `pnpm run prepare-db` can regenerate it.
- Do not reuse singleton workspace diff state inside Design Arena conversation panes.
- Keep each pane's `EntriesProvider`, `MessageEditProvider`, `RetryUiProvider`, and `ApprovalFeedbackProvider` isolated.
- Keep diff as secondary state in Design Arena.
- Preserve existing v1 Implementation Arena behavior behind explicit mode selection.
- Before final completion, run `pnpm run format` or rely on the GitHub workflow equivalent if local formatting is unavailable.
