# AI Arena — Step 0 调研笔记

> 状态：完成 · 创建于 2026-05 · 配套：[`spec.md`](./spec.md) / [`plan.md`](./plan.md)
>
> 本文记录对 spec.md 假设的代码侧验证结果，以及发现的几个**必须修正**的点。Step 1 实施前请先阅读本文。

---

## 1. 验证摘要

| Spec 假设 | 验证结果 | 行动 |
|---|---|---|
| `task_attempts → workspaces + sessions` 重构已完成 | ✅ 确认（`20251216142123_refactor_task_attempts_to_workspaces_sessions.sql`） | — |
| 一个 workspace 一个独立 worktree | ✅ 确认 | — |
| 一个 workspace 可以多个 session（每个 session 一个 executor） | ✅ 确认（`session.executor: Optional<String>`） | — |
| Worktree 创建并发安全 | ✅ 已实现 path-level 锁（`WORKTREE_CREATION_LOCKS`） | — |
| 可循环调 `create_and_start_workspace` 实现并行 N 个 attempts | ✅ 确认 | 略 |
| spec.md 中假设 `arena_groups.task_id` 关联 task | ❌ **错误** — 应改为 `issue_id` 关联 `local_issues` | **修 spec** |
| spec.md 中"创建 race 卡片"流程的 prompt 共享语义 | ⚠ Prompt 不存在 workspace 表上，存在每条 `execution_processes.executor_action` JSON 中 | spec 描述需澄清 |
| 复用 `archived` 字段做 promote/archived 区分 | ⚠ 不够 — `archived=true` 已有"用户软删除"语义，arena 用得自加 `arena_status` 列 | 按 spec 加列 |
| Worktree 自动清理 | ✅ `find_expired_for_cleanup` —— `archived=true` 走 1h 加速清理；非 archived 走 72h | promote 后调 `set_archived(true)` 即可触发 |
| 后端按 `task_id` 过滤 workspaces | ⚠ **后端不过滤** — `get_workspaces` 返回全部；前端 `?task_id=` 是空挂的；本地路径靠 `local_workspace_links` 表关联 | **API 层重要修正** |

---

## 2. 必须修正的 spec 点

### 2.1 关联 issue 而非 task（本地路径）

**spec.md §3.2 应改为**：

```sql
CREATE TABLE arena_groups (
    id              BLOB PRIMARY KEY,
    issue_id        BLOB NOT NULL,           -- ← 改：关联 local_issues 而非 tasks
    project_id      BLOB NOT NULL,           -- ← 加：方便按 project 查
    prompt          TEXT NOT NULL,
    base_branch     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    promoted_workspace_id BLOB,
    promoted_at     TEXT,
    FOREIGN KEY (issue_id)              REFERENCES local_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id)            REFERENCES projects(id)     ON DELETE CASCADE,
    FOREIGN KEY (promoted_workspace_id) REFERENCES workspaces(id)   ON DELETE SET NULL
);

CREATE INDEX idx_arena_groups_issue_id   ON arena_groups(issue_id);
CREATE INDEX idx_arena_groups_project_id ON arena_groups(project_id);
```

**理由**：
- 本 fork 的本地 Kanban 卡片实体是 `local_issues`（`20260427000000_local_kanban.sql`）
- 远程 `tasks` 表在本地路径中不再是用户视角的"卡片"
- workspace ↔ kanban 卡片的关联走 `local_workspace_links(workspace_id, project_id, issue_id)`
- 旧的 `workspaces.task_id` 字段在迁移中实际填的是 `issue_id`，是历史遗留命名（line 230-231 of `20260427000000_local_kanban.sql`）

### 2.2 创建 Arena 的接入路径

**spec.md §4.1 中的 `POST /api/local/v1/tasks/{task_id}/arena` 应改为**：

```
POST /api/local/v1/issues/{issue_id}/arena
```

返回时同步写一行 `local_workspace_links(workspace_id, project_id, issue_id)`，让 N 个 workspace 都关联到该 issue —— 复用现有的"通过 issue 列 workspace"逻辑。

### 2.3 `arena_status` 与 `archived` 不冲突，但要小心顺序

`workspaces.archived` 含义已固化：用户主动软删除/归档。`arena_status='archived'` 表示"被同组其他 attempt 取代"。

**Promote 流程的正确顺序**：

```rust
// 1. 标 promoted
workspace::set_arena_status(pool, promoted_id, "promoted").await?;
arena_group::set_promoted(pool, group_id, promoted_id).await?;

// 2. 其他同组 workspace 标 archived（arena_status）
for ws_id in others {
    workspace::set_arena_status(pool, ws_id, "archived").await?;
    // 同时调 set_archived(true) 触发 1h 加速清理
    Workspace::set_archived(pool, ws_id, true).await?;
}
```

不要直接调 `container.delete(workspace)`：那是同步删 worktree，建议交给 cleanup 后台任务。

---

## 3. 关键代码路径速查

### 3.1 创建 + 启动 workspace 的入口

```
crates/server/src/routes/workspaces/create.rs::create_and_start_workspace
  └─ create_workspace_record(deployment, name)            -- 写 workspaces 行
  └─ workspace_manager.load_managed_workspace(ws)         -- 取 ManagedWorkspace
  └─ managed_workspace.add_repository(repo, git)          -- 触发 worktree 实际创建
  └─ managed_workspace.associate_attachments(ids)         -- 关联附件
  └─ deployment.container().start_workspace(ws, cfg, prompt)  -- 启 session + execution_process
```

**Arena 调用方法**：N 次循环调上述函数，每次传不同 `executor_config`。建议用 `tokio::join_all!` 并行 spawn 但**必须串行 await `create_workspace_record`**（DB insert 可并发但 worktree 资源争抢风险大；以及 `git_branch_from_workspace` 已经按 workspace_id 隔离 branch 名）。

### 3.2 ContainerService 关键 API

`crates/services/src/services/container.rs`：

- `start_workspace(&workspace, executor_config, prompt) -> Result<ExecutionProcess>` —— 启 setup + coding agent
- `start_execution(&workspace, &session, &executor_action, &run_reason) -> Result<ExecutionProcess>` —— 通用启动
- `stop_execution(&execution_process, status)` —— 停某个 process
- `try_stop(&workspace, force)` —— 停 workspace 内全部 process
- `archive_workspace(workspace_id)` —— 归档 workspace（含触发 worktree 清理路径）
- `delete(&workspace)` —— 立即同步删 worktree + DB 记录

### 3.3 Worktree 锁机制（Arena 安全保证）

`crates/worktree-manager/src/worktree_manager.rs::WORKTREE_CREATION_LOCKS`：

- 按 worktree path string 哈希加 tokio mutex
- N 个 arena workspace 各自有独立 path（路径里含 workspace_id），**不会互相阻塞**
- 多个 process 试图建/删同一 path 时排队，安全

### 3.4 前端关键文件

`packages/web-core/src/`：

- `shared/hooks/useTaskWorkspaces.ts` —— 列 workspaces by task；arena 可基于此扩展 `useArenaGroupWorkspaces`
- `shared/hooks/useWorkspace.ts` —— 单 workspace 详情
- `shared/hooks/useWorkspaceExecution.ts` —— 启动/停止
- `shared/lib/api.ts::workspacesApi` —— REST 客户端
- `pages/workspaces/ChangesPanelContainer.tsx` —— diff 视图，**Arena N 栏复用此组件**
- `pages/workspaces/WorkspacesLayout.tsx` —— 整体布局
- `features/kanban/` —— 看板看法
- `features/workspace/` —— workspace 详情整体
- `features/create-mode/` —— 卡片/工作区创建表单（Race Mode toggle 加这里）

### 3.5 后端 list workspaces 的真相

`crates/server/src/routes/workspaces/core.rs::get_workspaces`：

```rust
pub async fn get_workspaces(...) -> ... {
    let workspaces = Workspace::fetch_all(pool).await?;  // 拉全部，不过滤
    Ok(...)
}
```

**前端 `?task_id=` 是 dead code**。如果想做"按 issue 列 workspace"过滤，需要：

- 加路由 `GET /api/local/v1/issues/{issue_id}/workspaces`，按 `local_workspace_links` 反查 workspaces
- 或在 `get_workspaces` 里加 `?issue_id=` 处理

Arena 视图实际上需要**按 `arena_group_id` 列 workspace**，不依赖前面这条路径，但实施时建议顺手把"按 issue 列 workspace"也补上（很多其他场景受益）。

---

## 4. 数据模型当前态（精确）

### 4.1 Workspace 表（实际字段）

```rust
pub struct Workspace {
    pub id: Uuid,
    pub task_id: Option<Uuid>,         // ← 历史字段，本地路径下实际存的是 issue_id
    pub container_ref: Option<String>, // ← worktree 绝对路径
    pub branch: String,                // ← git 分支名
    pub setup_completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived: bool,                // ← 用户主动归档
    pub pinned: bool,
    pub name: Option<String>,
    pub worktree_deleted: bool,        // ← worktree 已被磁盘清理
}
```

**Arena 加列后**：

```rust
pub arena_group_id: Option<Uuid>,
pub arena_status: ArenaStatus,  // enum: Active / Promoted / Archived
```

### 4.2 Session 表（实际字段）

```rust
pub struct Session {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: Option<String>,
    pub executor: Option<String>,        // ← coding agent name
    pub agent_working_dir: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

### 4.3 关联拓扑

```
local_issues (本地 Kanban 卡)
   │  ON DELETE CASCADE
   ▼
local_workspace_links (workspace_id, project_id, issue_id)
   │  ON DELETE CASCADE
   ▼
workspaces (= 一次 attempt，独立 worktree)
   ├─→ workspace_repos (多仓关联)
   ├─→ sessions (执行上下文)
   │      └─→ execution_processes (setup/codingagent/devserver/cleanup)
   │             └─→ coding_agent_turns (单轮对话)
   └─→ merges (PR / merge 状态)
```

**Arena 视图**：

```
local_issues
   ├─→ arena_groups (1 issue 可有 0..N groups)
   │      └─→ workspaces (1 group 有 N workspaces，标 active/promoted/archived)
   └─→ local_workspace_links (反向索引保留)
```

---

## 5. 风险/踩坑点（落地时注意）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | Promote 后立刻同步删其他 worktree 会阻塞响应 | 调 `set_archived(true)` 触发 1h 后台清理；前端立即更新 UI 状态即可 |
| 2 | N 个 dev server 并发启会撞端口 | 默认只为 promoted workspace 启 dev server；arena 期间需要预览的话用户手动启某栏 |
| 3 | Electric 同步把 arena_groups 漂到远端 | 本 fork 已 fallback 本地，但要确认 `crates/server/src/routes/local/` 下有 `arena_groups` 的 fallback shape；如果没有，要新加 |
| 4 | `workspaces.task_id` 字段名与本地 issue_id 含义不一致 | 长期建议：再做一次 migration 重命名；短期先在 arena_groups 里用 `issue_id` 命名清晰 |
| 5 | 前端 `useTaskWorkspaces` 在 race 模式下会列出全部 N 个 workspace —— 要避免在普通"attempts list"里也露出 race 内部 attempts | UI 在 issue 详情页加判断：若该 issue 关联到一个 active arena_group，则首屏显示 ArenaView 而非 attempts list |
| 6 | `qa-mode` 特性下 executor 是 mock | Step 1 测试时记得用 `pnpm run dev` 而非 `dev:qa` |
| 7 | Branch 名生成规则在 `container.git_branch_from_workspace(&workspace_id, label)` —— Arena 用相同 issue 但不同 workspace_id 已能避免冲突 | 无需额外处理 |

---

## 6. 给 spec.md 的修订清单

进 Step 1 前，把下面修改写回 spec.md：

- [ ] §3.2 表名字段：`task_id` → `issue_id`，新增 `project_id`
- [ ] §4.1 路由：`/tasks/{task_id}/arena` → `/issues/{issue_id}/arena`
- [ ] §3.3 加 `arena_status` 的 Rust 枚举定义而不是裸字符串
- [ ] §6.5 写明 Electric local fallback 的 arena_groups shape 处理（具体路径需 Step 1 时确认 `crates/server/src/routes/local/`）
- [ ] §AC-5 补充：删卡片时通过 `local_workspace_links` 的 ON DELETE CASCADE 自动清掉所有 workspaces，再走 worktree 后台清理

---

## 7. 实际工时调整建议

原 plan.md 估算 8.5 工作日，调研后发现：

- **Step 1（数据模型 + API）原 2 天 → 建议 2.5 天**：多了一个修复"按 issue 列 workspace"的小路由 + Electric local fallback shape 添加
- **Step 2（多栏 Diff）原 2 天 → 维持 2 天**：复用 `ChangesPanelContainer` 风险低
- **Step 3（Promote / Archive / Retry）原 2 天 → 维持 2 天**：cleanup 走 archive 路径，无需特别处理
- **Step 4（Race Mode UI + 资源上限）原 2 天 → 建议 2.5 天**：表单嵌套到 `features/create-mode/` 体系下，需要额外学习其 store 模式

总计调整为 **9 工作日**。

---

## 8. 下一步

Step 1 启动前必须完成：

1. 把本文 §6 修订清单回写到 spec.md
2. 在 `crates/server/src/routes/local/` 下确认是否已有 Electric local fallback 注入点（用 grep `fallback`）
3. 确认 `crates/server/src/routes/workspaces/mod.rs` 的路由注册位置 → arena routes 应注册在新建的 `crates/server/src/routes/arena/mod.rs`

---

## 9. 补充更新（2026-05 二轮调研）

§8 三项已全部确认完成，结论：

1. ✅ spec.md 已根据 §6 全部修订（见 spec.md 末尾「修订历史」）
2. ✅ **本仓库没有 `routes/local/` 目录** —— 本地化路由全部集中在单文件 `crates/server/src/routes/local_remote.rs`（约 800+ 行）。Electric fallback 注入点在该文件 `router()` fn 第 101–129 行；现有 fallback 形如 `.route("/v1/fallback/issues", get(fallback_issues))`。`/api/local/v1/...` 路径来自 `routes/mod.rs::router()` 第 58 行的 `.nest("/local", local_remote::router(&deployment))`。
3. ✅ **Arena routes 不新建独立模块** —— 决定继续扩展 `local_remote.rs`，让 arena 与 local kanban issues/tags 同模块（采用 plan.md Checklist 方案 A）。新建 `routes/arena/mod.rs` 的方案被弃用，因为它会跟 `local_remote.rs` 已有的 `/v1/issues/{issue_id}` 路由前缀交叉，需要小心 axum 路由优先级。

**Step 1 启动前剩余的唯一未打钩项**：准备 SQLite Browser / sqlx-cli 用于验收（属于本机环境准备，不是代码侧依赖）。

可以正式开 Step 1。

完成上述确认后，Step 1 可立即开工。
