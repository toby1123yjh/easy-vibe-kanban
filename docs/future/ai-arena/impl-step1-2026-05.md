# AI Arena — Step 1 实施记录

> 日期：2026-05 · 状态：草稿落地完成（待 cargo check 验证）
>
> 配套：[`spec.md`](./spec.md) · [`plan.md`](./plan.md) · [`notes-step0.md`](./notes-step0.md)

---

## 1. 落地清单

### 1.1 SQLx 迁移（既有 commit `249fcff1`）

文件：`crates/db/migrations/20260504000000_add_ai_arena.sql`

- 新表 `arena_groups`（id, issue_id → local_issues, project_id → projects, prompt, base_branch, promoted_workspace_id → workspaces, promoted_at, created_at, updated_at）
- `workspaces` 加列：`arena_group_id`（FK → arena_groups, ON DELETE SET NULL）+ `arena_status`（CHECK 约束 active/promoted/archived，默认 active）
- 索引：`idx_arena_groups_issue_id`、`idx_arena_groups_project_id`、`idx_arena_groups_active_per_issue`（partial index, WHERE promoted IS NULL）、`idx_workspaces_arena_group_id`
- `PRAGMA foreign_keys = ON;` + `PRAGMA foreign_key_check;`

### 1.2 Rust 模型（既有 commit `54a1ad40` 草稿 + 本次补齐）

文件 `crates/db/src/models/arena_group.rs`（新建，~250 行）：

- `ArenaStatus` enum（Type + TS + Serialize + Deserialize，lowercase）
- `ArenaGroup` struct（FromRow + TS）
- `CreateArenaGroup` 请求类型
- `ArenaGroupError`（NotFound / AlreadyPromoted / WorkspaceNotInGroup / ValidationError / Database）
- 方法：`find_by_id` / `find_active_by_issue_id` / `find_all_by_issue_id` / `find_all_by_project_id` / `create` / `set_promoted`（带 `AlreadyPromoted` 守卫）/ `delete`

文件 `crates/db/src/models/workspace.rs`：

- `Workspace` struct 加 2 字段：`arena_group_id: Option<Uuid>` / `arena_status: ArenaStatus`
- 5 处 query 补齐 SELECT 列：`fetch_all` / `find_by_id` / `find_by_rowid` / `find_expired_for_cleanup` / `find_all_with_status` / `find_by_id_with_status`
- `Workspace::create` 的 RETURNING 加新列
- 新增方法：`set_arena_group_id` / `set_arena_status` / `find_by_arena_group_id`
- **本次 fix**：`fetch_all` SELECT 缺 arena 字段，`find_by_id_with_status` 内构造 `Workspace` 缺两字段——已补齐。

文件 `crates/db/src/models/mod.rs`：已注册 `pub mod arena_group;`

### 1.3 后端路由 + handler

文件 `crates/server/src/routes/local_remote.rs`（在 tests 块前追加 ~400 行 + 顶部 import 扩展 + `router()` 内注册路由）：

新增类型（全部 `pub`，已加入 `ts-rs` 导出）：

- `ArenaAttemptInput`：单 attempt 的 `executor_config` + 可选 `name` + 可选 `prompt` 覆盖
- `CreateArenaRequest`：`{project_id, base_branch, prompt, repos, attempts}`
- `ArenaWorkspaceSummary`：`{workspace_id, name, branch, arena_status, executor, variant}`
- `ArenaGroupResponse`：`{...ArenaGroup, workspaces: Vec<ArenaWorkspaceSummary>}`
- `PromoteArenaRequest` / `RetryArenaRequest`
- `DissolveArenaResponse`

新增 handler：

| Method | Path | Handler |
|---|---|---|
| POST | `/v1/issues/{issue_id}/arena` | `create_arena_group`（校验 attempt 数 2–6 + 顺序 spawn N workspace + 写 `local_workspace_links` + 设 `arena_group_id`） |
| GET  | `/v1/issues/{issue_id}/arena/active` | `get_active_arena_for_issue`（最多一个 active group） |
| GET  | `/v1/arena/{group_id}` | `get_arena_group` |
| POST | `/v1/arena/{group_id}/promote` | `promote_arena_workspace`（设 promoted + 兄弟 archived + `set_archived(true)` 触发 1h 加速清理；**绝不调用 container.delete()**，按 spec §5.3 异步清理） |
| POST | `/v1/arena/{group_id}/workspaces/{workspace_id}/retry` | `retry_arena_workspace`（标当前 archived，按当前 workspace 的 repos 镜像 spawn 新 workspace 加入同 group） |
| DELETE | `/v1/arena/{group_id}` | `dissolve_arena_group`（每个 sibling archive，删 arena_group 行） |
| GET  | `/v1/issues/{issue_id}/workspaces` | `list_issue_workspaces`（**顺手修复** notes-step0 §3.5 提到的 dead-code 路径，通过 `local_workspace_links` 反查） |
| GET  | `/v1/fallback/arena_groups` | `fallback_arena_groups`（按 `?project_id=` 过滤；与 `fallback_issues`/`fallback_pull_requests` 同风格） |

辅助函数：

- `insert_workspace_link(pool, workspace_id, project_id, issue_id)`（UPSERT `local_workspace_links`）
- `ensure_issue_in_project(pool, issue_id, project_id)`（FK 完整性预检）
- `workspace_to_summary(ws, executor_config?)`
- `workspaces_for_group(pool, group_id)`
- `spawn_arena_attempt(deployment, group, issue_id, project_id, repos, attempt, idx)`：单次 attempt 创建 + 启动闭环

### 1.4 Electric fallback

`fallback_arena_groups` 已注册到 `router()` 第 132 行附近，按 `ProjectQuery` 过滤；前端 Electric client 通过 `/api/local/v1/fallback/arena_groups?project_id=...` 同步 arena groups 与现有 issues/tags 同样的 reactive shape。

### 1.5 ts-rs 类型 + 错误转换

`crates/server/src/bin/generate_types.rs`：在 `Workspace::decl()` 之后追加：

```rust
db::models::arena_group::ArenaGroup::decl(),
db::models::arena_group::ArenaStatus::decl(),
db::models::arena_group::CreateArenaGroup::decl(),
server::routes::local_remote::ArenaAttemptInput::decl(),
server::routes::local_remote::CreateArenaRequest::decl(),
server::routes::local_remote::ArenaWorkspaceSummary::decl(),
server::routes::local_remote::ArenaGroupResponse::decl(),
server::routes::local_remote::PromoteArenaRequest::decl(),
server::routes::local_remote::RetryArenaRequest::decl(),
server::routes::local_remote::DissolveArenaResponse::decl(),
```

`crates/server/src/error.rs`：

- import 加 `ArenaGroupError`
- 新增 `impl From<ArenaGroupError> for ApiError`：
  - `NotFound` → `BadRequest("Arena group not found")`
  - `AlreadyPromoted{group_id}` → `Conflict(...)`
  - `WorkspaceNotInGroup{...}` → `BadRequest(...)`
  - `ValidationError(msg)` → `BadRequest(msg)`
  - `Database(e)` → `Database(e)`

### 1.6 待验收

- [ ] `cargo check --workspace`（本机缺 MSVC `link.exe`，留到 CI / WSL2 / VS Build Tools）
- [ ] `pnpm run prepare-db`（重生 SQLx offline metadata）
- [ ] `pnpm run generate-types`（重生 `shared/types.ts`）
- [ ] `cargo test --workspace`
- [ ] curl smoke：
  - `POST /api/local/v1/issues/<id>/arena` 返回 200 + N workspace_id
  - `GET /api/local/v1/issues/<id>/arena/active` 返回单个 group
  - `POST /api/local/v1/arena/<gid>/promote {workspace_id}` 设 promoted + 兄弟 archived
- [ ] DB 检查：N 行 workspaces 都有 arena_group_id 一致，`local_workspace_links` 同步插入
- [ ] 删 `local_issues` 行 → cascade 清掉 arena_groups + workspaces

---

## 2. 与 spec / plan 的偏差说明

| 项 | spec/plan 描述 | 实际实施 | 原因 |
|---|---|---|---|
| `create_arena_group` 请求字段 | spec §4.2 用 `{base_branch, prompt, executors:[{executor_type, model}]}` | 实现采用 `{project_id, base_branch, prompt, repos:[{repo_id, target_branch}], attempts:[{executor_config, name?, prompt?}]}` | `ExecutorConfig` 已是统一模型（含 model/variant/agent_id/reasoning/permission）；`repos` 必须显式传以匹配 `create_and_start_workspace` 的契约；`project_id` 显式传以做 FK 完整性预检 |
| Promote 时的清理 | spec §5.3：异步清理；不直接 `container.delete` | 完全按 spec：仅 `set_arena_status(Archived)` + `set_archived(true)`，依赖现有 `find_expired_for_cleanup` 的 1h 加速路径 | — |
| Retry 时的 repos | plan 未明确 | 自动从被 retry 的 workspace 镜像 `workspace_repos` 行 | 用户视角下 retry 应保持 repo 集合不变，避免再传一次 |
| 单 attempt 上限 | spec §6.1：默认 3，可调到 6 | 当前硬编码 `ARENA_MIN_ATTEMPTS=2 / ARENA_MAX_ATTEMPTS=6`；项目级配置 `arena_max_workspaces` 留到 Step 4 | 与 plan §4.2 一致 |
| Fallback shape | plan Step 1.4：与 issues / workspaces 一致的本地 shape | `fallback_arena_groups` 直接返回 `Vec<ArenaGroup>` JSON；前端在 Step 2 接 react-db 时再决定是否包到 IndexedDB collection | OK |
| `ApiError::NotFound` | spec / plan 隐含使用 | 实际不存在 — 改用 `ArenaGroupError::NotFound` 走错误转换为 `BadRequest("Arena group not found")` | 兼容现有错误体系；将来如需要 404 语义可在 `ApiError` 加 `NotFound(String)` 变体 |

---

## 3. 编译/类型修复链

本次实施过程中识别并修复的「Step 0 之后才暴露的」问题：

1. **`workspace.rs::fetch_all`** 的 SELECT 列表缺 arena 字段 → 补齐
2. **`workspace.rs::find_by_id_with_status`** 内构造 `Workspace` 字面量缺两字段 → 补齐
3. **`ApiError` 没有 `NotFound` 变体** → 通过 `ArenaGroupError::NotFound` 错误转换走 `BadRequest`
4. **没有 `From<ArenaGroupError> for ApiError`** → 在 `error.rs` 新增 impl
5. **元组 `query_as::<_, (Uuid, String)>`** 在 SQLite 上通过宏 `query_as!` 更稳 → 改写

---

## 4. 下一步（Step 2 准备）

- 前端在 `packages/web-core/src/features/` 下新建 `arena/` 模块
- API 客户端 `packages/web-core/src/shared/lib/api.ts` 加 arena 端点
- N 栏 diff 视图复用 `pages/workspaces/ChangesPanelContainer.tsx`
- `local-web` 路由加 `/projects/$projectId/issues/$issueId/arena/$groupId`
