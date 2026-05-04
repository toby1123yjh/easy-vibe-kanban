# AI Arena — 实施计划（Plan）

> 状态：Draft · 创建于 2026-05 · 配套 spec：[`spec.md`](./spec.md)
>
> 本计划遵循"零决策可执行"原则：每个 Step 给出明确的输入、产出、关键文件、验收命令。即使别人接手，也能按 Step 顺序往下做。

---

## 总览

| Step | 主题 | 工时估算 | 独立可交付 |
|---|---|---|---|
| **0** | 代码调研与契约确认 | 0.5 天 ✅ 已完成 | [`notes-step0.md`](./notes-step0.md) |
| **1** | 数据模型迁移 + 后端 API | 2.5 天 | 能 curl 起 N 个 workspace 并查询 group |
| **2** | 基础多栏 Diff 视图（read-only） | 2 天 | 在 UI 看到三栏 diff |
| **3** | Promote / Archive / Retry 行为 | 2 天 | 完成评审闭环 |
| **4** | 创建卡片的 Race Mode UI + 资源上限 | 2.5 天 | 全功能可用 |

合计 ≈ **9 工作日**，每 Step 都能独立 commit + tag 发版。

> Step 0 调研后调整：Step 1 +0.5 天（修复"按 issue 列 workspace"路由 + Electric local fallback shape），Step 4 +0.5 天（嵌入 `features/create-mode/` store 模式）。详见 [notes-step0.md §7](./notes-step0.md)。

---

## Step 1 启动前 Checklist

进入 Step 1 之前必须完成以下确认（避免 Step 1 中途返工）：

- [x] Step 0 调研产出 `notes-step0.md`
- [x] spec.md 已根据 notes-step0.md §6 修订清单回写（关联键 `task_id` → `issue_id`、新增 `project_id`、`arena_status` Rust enum、Promote 异步清理、AC-5 cascade 链路）
- [x] **Electric local fallback 注入点已确认**：`crates/server/src/routes/local_remote.rs::router()` 第 101–187 行。所有 fallback shape 形如 `.route("/v1/fallback/<resource>", get(fallback_<resource>))`。该 router 在 `routes/mod.rs::router()` 第 58 行通过 `.nest("/local", local_remote::router(&deployment))` 挂载，最终对外路径是 `/api/local/v1/...`。
  - **Step 1 落地**：在该 router fn 末尾加一行 `.route("/v1/fallback/arena_groups", get(fallback_arena_groups))`，参照 `fallback_issues` / `fallback_user_workspaces` 写法实现 handler。
- [x] **Arena routes 注册位置已确认**：两种方案：
  - **方案 A（推荐）**：直接在 `crates/server/src/routes/local_remote.rs::router()` 内继续追加 routes（与 local kanban issues/tags 保持同一模块），路径 `/v1/issues/{issue_id}/arena`、`/v1/arena/{group_id}/...`。优点：路径前缀自动归到 `/api/local/v1/...`，无需改 `routes/mod.rs`。
  - **方案 B**：新建 `crates/server/src/routes/arena/mod.rs`，在 `routes/mod.rs::router()` 通过 `.nest("/local/v1", arena::router(&deployment))` 挂载。优点：模块边界清晰；缺点：跟 `local_remote.rs` 已有的 `/v1/issues/{issue_id}` 路由在挂载点上交叉，需要小心 axum 路由优先级。
  - **采用方案 A**，等 Step 1 跑通后若 `local_remote.rs` 文件超过 1500 行再单独抽出 `arena.rs`（与 `local_remote.rs` 同级，仍由 `routes/mod.rs` 挂载到 `/local`）。
- [ ] 准备好 SQLite Browser（或 sqlx-cli）用于 Step 1 验收的 DB 检查

> **关键启示**：本仓库**没有** `crates/server/src/routes/local/` 目录；本地化路由全部集中在 `local_remote.rs`（约 800+ 行）。Step 1 初版直接扩展该文件，等到 Step 4 再视体量决定是否拆分。

---

## Step 0 — 代码调研与契约确认（0.5 天）

### 目的

避免 Step 1 写迁移时才发现某个字段名 / 表结构与假设不符。把 spec.md §3 中所有"假设来自 migration"的部分重新当面确认一次。

### 待办

- [ ] 读 `crates/db/src/models/` 下与 `workspaces`、`sessions`、`tasks` 相关的所有 model 文件，逐字段比对 spec
- [ ] 读 `crates/server/src/routes/workspaces/create.rs` 完整文件，记录 workspace 创建时的：
  - 必填参数（base_branch / repo_id / executor / prompt 等）
  - 启动 session 的时机（同步 / 后台 task）
  - 错误回滚边界（worktree 创建失败时怎么处理）
- [ ] 读 `crates/server/src/routes/workspaces/execution.rs`，确认重启 / retry 现有逻辑
- [ ] 读 `crates/worktree-manager/src/worktree_manager.rs`，确认并发创建 worktree 是否安全（锁 / 路径冲突）
- [ ] 读 `crates/services/src/services/container.rs` 看 session 调度是否已经支持并行
- [ ] 看 `packages/local-web/src/` 下 task 详情页与 attempt 切换的现有组件 —— 找到将要叠加 "Arena tab" 的位置

### 产出

`docs/future/ai-arena/notes-step0.md`，至少包含：

- 实际字段表（覆盖 spec.md §3 的假设）
- workspace 创建路径（函数调用链 3–5 层）
- 已识别的踩坑点（例如 "worktree 创建必须串行" / "Electric fallback 需要手动写一份本地 shape"）

---

## Step 1 — 数据模型 + 后端 API（2.5 天）

### 1.1 SQLx 迁移

新增文件：`crates/db/migrations/<YYYYMMDDHHMMSS>_add_ai_arena.sql`

内容按 spec.md §3.2 §3.3：

```sql
CREATE TABLE arena_groups (
    id              BLOB PRIMARY KEY,
    issue_id        BLOB NOT NULL,
    project_id      BLOB NOT NULL,
    prompt          TEXT NOT NULL,
    base_branch     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    promoted_workspace_id BLOB,
    promoted_at     TEXT,
    FOREIGN KEY (issue_id)              REFERENCES local_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id)            REFERENCES projects(id)     ON DELETE CASCADE,
    FOREIGN KEY (promoted_workspace_id) REFERENCES workspaces(id)   ON DELETE SET NULL
);

ALTER TABLE workspaces ADD COLUMN arena_group_id BLOB;
ALTER TABLE workspaces ADD COLUMN arena_status TEXT
    NOT NULL DEFAULT 'active'
    CHECK (arena_status IN ('active','promoted','archived'));

CREATE INDEX idx_arena_groups_issue_id   ON arena_groups(issue_id);
CREATE INDEX idx_arena_groups_project_id ON arena_groups(project_id);
CREATE INDEX idx_workspaces_arena_group_id ON workspaces(arena_group_id);
```

执行 `pnpm run prepare-db` 重新生成 SQLx offline 元数据。

### 1.2 Rust 模型

新增 `crates/db/src/models/arena_group.rs`：

```rust
#[derive(Debug, Serialize, Deserialize, FromRow, TS)]
pub struct ArenaGroup {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub created_at: DateTime<Utc>,
    pub promoted_workspace_id: Option<Uuid>,
    pub promoted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, sqlx::Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaStatus { Active, Promoted, Archived }
```

修改 `crates/db/src/models/workspace.rs`：增加 `arena_group_id: Option<Uuid>` / `arena_status: ArenaStatus` 字段（同步更新 `Workspace::create` / `find_by_id` / `find_all_with_status` 等所有 sqlx::query_as! 宏）。

### 1.3 路由

按 Checklist 采用 **方案 A**：直接扩展 `crates/server/src/routes/local_remote.rs::router()`（line 101–187），在该 fn 末尾追加 routes：

- `POST   /v1/issues/{issue_id}/arena` — 创建 group + 循环调用现有 workspace create + 同步写入 N 行 `local_workspace_links`
- `GET    /v1/issues/{issue_id}/arena/active` — 返回该 issue 当前未 promote 的 active group（最多一个）
- `GET    /v1/arena/{group_id}` — 返回 group + workspace 状态聚合
- `POST   /v1/arena/{group_id}/promote` — 标 promoted_workspace_id；其余 workspace 同时设 `arena_status='archived'` + `archived=true`（触发 1h 后台清理）
- `POST   /v1/arena/{group_id}/workspaces/{workspace_id}/retry` — 标当前 archived + 新建 workspace 加入 group
- `DELETE /v1/arena/{group_id}` — 解散 group

> 路径自动获得 `/api/local` 前缀（来自 `routes/mod.rs::router()` line 58 的 `.nest("/local", local_remote::router(&deployment))`），最终对外是 `/api/local/v1/issues/{issue_id}/arena` 等。

handler 函数名建议 `create_arena_group` / `get_active_arena_for_issue` / `get_arena_group` / `promote_arena_workspace` / `retry_arena_workspace` / `dissolve_arena_group`，按 `local_remote.rs` 现有命名风格。

**顺手修复**：当前 `GET /api/workspaces?task_id=` 是 dead code（后端 `get_workspaces` 不过滤），新增 `GET /v1/issues/{issue_id}/workspaces`，按 `local_workspace_links` 反查 → 同样在 `local_remote.rs` 加。

### 1.4 Electric fallback shape

在 `local_remote.rs::router()` line 101–129 现有 fallback 区段内追加：

```rust
.route("/v1/fallback/arena_groups", get(fallback_arena_groups))
```

handler 实现参照 line 110 `fallback_projects` 或 line 112 `fallback_issues` 的写法：返回 `Vec<ArenaGroup>` 的 JSON。前端 Electric client 通过这条 fallback 同步 arena_groups 到 IndexedDB（如果有的话），保持与现有 local_issues / workspaces 一致的 reactive 体验。

### 1.5 ts-rs 类型

修改 `crates/server/src/bin/generate_types.rs`，把 `ArenaGroup` / `ArenaStatus` 加入导出列表。
执行 `pnpm run generate-types` 让 `shared/types.ts` 同步。

### 1.6 验收

- [ ] `cargo test --workspace` 通过
- [ ] `pnpm run check` 通过
- [ ] `pnpm run generate-types:check` 通过（确保未漏生成）
- [ ] 手工 curl：
  ```bash
  curl -X POST http://localhost:$BACKEND_PORT/api/local/v1/issues/<issue_id>/arena \
       -H 'Content-Type: application/json' \
       -d '{"base_branch":"main","prompt":"...","executors":[...]}'
  ```
  返回 200 + N 个 workspace_id；磁盘上确实出现 N 个 worktree
- [ ] SQLite Browser 中确认 N 行 workspaces 都关联到同一 `arena_group_id`，且 `local_workspace_links` 也有 N 行
- [ ] 删 issue 后 `arena_groups` / `workspaces` / `local_workspace_links` 全部 cascade 删除（worktree 由后台清理异步处理）

---

## Step 2 — 基础多栏 Diff 视图（read-only，2 天）

### 2.1 前端数据层

新增 `packages/local-web/src/api/arena.ts`：

```ts
export async function getArenaGroup(groupId: string): Promise<ArenaGroupDetail>;
export function useArenaGroupStream(groupId: string): ArenaGroupLive;
```

WebSocket 复用现有 workspace stream，前端聚合。

### 2.2 路由 + 组件

- 新增页面 `/issues/:issueId/arena/:groupId`（或 issue 详情页内 Tab）
- 新增组件 `ArenaView` 在 `packages/local-web/src/components/arena/ArenaView.tsx`
- 内部三栏布局：每栏复用现有 `ChangesPanelContainer`
- 顶部状态条：executor logo / 模型 / 状态 / 用时 / token

### 2.3 响应式

- 1280px 以上：横排 N 栏
- 1280px 以下：carousel + 缩略图

### 2.4 验收

- [ ] 起 Step 1 创建出来的 arena_group → 在 UI 看到三栏 diff 流式更新
- [ ] 三栏可独立滚动
- [ ] 某栏失败 → 该栏出错误徽标，其他栏正常
- [ ] `pnpm run check` + `pnpm run lint` 通过

---

## Step 3 — Promote / Archive / Retry 行为（2 天）

### 3.1 Promote

- 每栏底部 `[Promote]` 按钮
- 点击 → 弹 `<ConfirmDialog>` 解释会归档其他 attempts 并清 worktree
- 确认 → 调 `/promote` API
- 后端：标 `promoted_workspace_id`，其他 workspaces 标 `archived` 并触发 `worktree_manager.cleanup(workspace_id)`
- 进入现有 merge / PR 流（不改任何现有逻辑，只是从 promoted workspace 触发）

### 3.2 Retry

- 每栏底部 `[Retry]` 按钮
- 点击 → 标当前 archived → 创建新 workspace 加入同 group
- 前端 stream 自动接到新 workspace

### 3.3 Reject + Comment

- 复用现有 inline comments
- 现有 reject 流：reject 后开新 attempt
- arena 模式下：该 attempt 单独走 reject → retry 流，不影响其他栏

### 3.4 删除卡片

- 删卡片时 cascade 删 arena_group → cascade 删 workspaces → 触发 worktree 清理
- 现有 ON DELETE CASCADE 已经处理大部分；要新加的是 worktree 清理钩子（可能已有，Step 0 调研确认）

### 3.5 验收

- [ ] AC-2 / AC-3 / AC-4 / AC-5 / AC-6（spec.md §7）全部通过
- [ ] 重启 vibe-kanban 后 active arena 状态正确恢复（包括 streaming 重连）

---

## Step 4 — 创建卡片 Race Mode UI + 资源上限（2.5 天）

### 4.1 创建表单

- 卡片创建页底部加 `<Toggle>` "Race mode (try multiple agents)"
- 打开后：原本"executor 单选"换成"executor 列表"，每行可独立选 executor + model + template
- 默认 2 行，可加到 max（项目 setting 决定，默认 3）
- 至少 2 行，否则不让提交

### 4.2 资源上限

- `crates/db/migrations/<...>_add_arena_max_workspaces.sql`：
  ```sql
  ALTER TABLE projects ADD COLUMN arena_max_workspaces INTEGER NOT NULL DEFAULT 3;
  ```
- Project Settings 页加配置项

### 4.3 端口分配

- 修改 worktree 创建逻辑：dev server 端口用 `hash_port(workspace_id)` 派生
- 默认只为 promoted workspace 起 dev server（用户可在 arena view 单独点 "start dev server" 启某栏）

### 4.4 验收

- [ ] AC-1（spec.md §7）：创建 race mode 卡片，磁盘上 3 个 worktree，UI 三栏显示
- [ ] AC-7：关掉 race mode 创建，行为与改造前完全一致
- [ ] 试图创建 4 个 attempt（超过 max=3）→ 前端禁用"加一行"按钮 + 后端校验返回 400

---

## 跨 Step 验收

实施完所有 Step 后，跑完整验收清单：

- [ ] spec.md §7 全部 AC 通过
- [ ] `cargo test --workspace`
- [ ] `pnpm run check && pnpm run lint`
- [ ] `pnpm run format`（提交前必须）
- [ ] 在 Windows 本机 npx 重新打包：`pnpm run build:npx && pnpm pack`
- [ ] 用打包后的 `.tgz` 跑一次 spec.md §7 全部 AC（验证不只是 dev mode 能跑）

---

## Rollback 策略

每个 Step 的 commit 都独立可回滚：

- Step 1 rollback：删 migration + 删 `arena_group.rs` 模型 + 删 `local_remote.rs` 中 arena 相关 routes + handler
- Step 2 rollback：保留后端，删前端 `ArenaView`，task 详情页隐藏 Arena tab
- Step 3 rollback：保留只读 view，禁用 Promote / Retry 按钮
- Step 4 rollback：保留功能，但 Race Mode toggle 在创建页隐藏

如果 Step N 上线后发现严重问题，可以倒序回滚到 Step N-1，仍然是个完整的可用版本。

---

## 后续（Out of this plan）

完成本计划后，可考虑下一阶段（写到独立的 `docs/future/ai-arena/v2.md`）：

1. **同 executor 多 prompt** —— Claude × 3 用不同 prompt 跑同题
2. **Arena 战绩面板** —— 长期统计哪个 agent 在哪类 task 上表现更好（需要 Token Dashboard T1-4 先做）
3. **Auto-judge** —— 用一个独立 reviewer agent（Gemini / Codex）自动给 N 栏打分作为 promote 建议（不替代用户决策）
4. **Arena Templates** —— 把"Claude opus + Codex + Gemini"组合存模板，下次一键复用

---

## 关键文件清单（实施时打开顺序）

| 阶段 | 文件 |
|---|---|
| Step 0 ✅ | `crates/db/src/models/{workspace,session,task}.rs`、`crates/server/src/routes/workspaces/{create,execution,core,links}.rs`、`crates/worktree-manager/src/worktree_manager.rs`、`crates/services/src/services/container.rs`、`crates/db/migrations/20260427000000_local_kanban.sql` |
| Step 1 | `crates/db/migrations/<new>.sql`、`crates/db/src/models/arena_group.rs`（新）、`crates/db/src/models/workspace.rs`（加 arena_group_id / arena_status 字段）、`crates/server/src/routes/local_remote.rs`（扩展 router fn line 101+ 加 arena routes + fallback）、`crates/server/src/bin/generate_types.rs` |
| Step 2 | `packages/web-core/src/shared/lib/api.ts`、`packages/web-core/src/features/workspace/`、`packages/web-core/src/pages/workspaces/ChangesPanelContainer.tsx`（复用）、新增 `packages/web-core/src/features/arena/` 目录 |
| Step 3 | `packages/web-core/src/features/arena/ActionsBar.tsx`（新）、`crates/server/src/routes/local_remote.rs`（追加 promote / retry / dissolve handler）、复用现有 `find_expired_for_cleanup` 后台清理路径 |
| Step 4 | `packages/web-core/src/features/create-mode/`（学习 store 模式后嵌入 Race Mode toggle）、`crates/db/migrations/<new>_arena_max.sql`、Project Settings 页 |
