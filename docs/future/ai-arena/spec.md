# AI Arena — 功能规格（Spec）

> 状态：Draft · 创建于 2026-05 · 上层路线图见 [`docs/future/future_task.md`](../future_task.md) §T0-1

---

## 1. 一句话目标

> 让一张 task 卡片可以**同时**派给 N 个不同的 coding agent（如 Claude Code / Codex / Gemini CLI），每个 agent 在独立 worktree 里独立完成，N 个结果以**并列 diff 视图**呈现给用户评审，用户一键 promote 一个胜出方案合并到目标分支，其余方案自动归档。

**为什么命名"Arena"**：参考 `johannesjo/parallel-code` 528⭐ 的 "AI Arena" 用语，社区已熟悉。

---

## 2. 用户故事

### 主路径

```
作为 易混淆任务的工程师
我想 把同一个任务派给 Claude / Codex / Gemini 三个 agent 同时跑
为了 直接对比三方代码质量，挑最好的合并，省下手工开三个 worktree 的时间
```

### 支线场景

| ID | 场景 |
|---|---|
| US-1 | 创建卡片时，勾选 "Race Mode" → 选 N 个 executor → 一键启动 |
| US-2 | 在卡片详情页看 N 栏并列 diff，每栏顶部显示 executor 名称 + 状态 + 用时 |
| US-3 | 在某栏底部点 "Promote" → 该 attempt 走标准 merge / PR 流，其余 attempt 标记为 archived |
| US-4 | 中途某个 agent 卡死或失败 → 不影响其他 agent；用户可单独 retry 某栏 |
| US-5 | 评审时仍能 inline comment 给某个 agent；用户给某栏 reject → 该栏单独再起一次新 attempt（不影响其他栏） |
| US-6 | 卡片归档 / 删除时，所有关联 worktree 一起清理 |

### 非目标（Out of Scope）

- ❌ 跨 task 的 arena（多任务比较）
- ❌ "agent vs agent" 的自动评分 / 投票
- ❌ 让 agent 互相看对方代码后修订（会 leak prompt 互相污染）
- ❌ 远程 / Docker runtime 下的 arena（先做本地 worktree 就够）

---

## 3. 数据模型变更

### 3.1 现状速查（来自 `20251216142123_refactor_task_attempts_to_workspaces_sessions.sql`）

```
tasks ─┬─ workspaces (= 一次 attempt，独立 worktree)
       │      ├─ workspace_repos (多仓关联)
       │      ├─ sessions (一个 workspace 可以有多个 session，每个绑一个 executor)
       │      │     └─ execution_processes (setup/codingagent/devserver/cleanup)
       │      │           └─ coding_agent_turns
       │      └─ merges (PR / merge 状态)
       └─ parent_workspace_id (sub-task)
```

**关键观察**：
- "一次 attempt" 已经是 workspace 概念，已经独立 worktree
- 现有 UI 是「串行 attempt」：reject 一个 → 再开一个新 workspace
- AI Arena 本质：**让一个 issue（本地 Kanban 卡片）在同一时间持有 N 个 active workspaces**，并把它们标记为同一组
- 本 fork 的本地 Kanban 卡片实体是 `local_issues`（`20260427000000_local_kanban.sql`）；`workspaces.task_id` 字段在本地路径中实际存的是 `issue_id`（命名遗留），workspace ↔ kanban 卡片的关联走 `local_workspace_links(workspace_id, project_id, issue_id)`

### 3.2 新增：`arena_groups` 表

```sql
CREATE TABLE arena_groups (
    id              BLOB PRIMARY KEY,
    issue_id        BLOB NOT NULL,           -- 关联本地 Kanban 卡片（local_issues），不是 tasks
    project_id      BLOB NOT NULL,           -- 冗余但便于按 project 列 / 安全约束
    prompt          TEXT NOT NULL,           -- 共享 prompt（创建时 snapshot，避免后续修改污染）
    base_branch     TEXT NOT NULL,           -- 共享 base 分支
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    promoted_workspace_id BLOB,              -- 用户 promote 后填入；null = 仍在评审
    promoted_at     TEXT,
    FOREIGN KEY (issue_id)              REFERENCES local_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id)            REFERENCES projects(id)     ON DELETE CASCADE,
    FOREIGN KEY (promoted_workspace_id) REFERENCES workspaces(id)   ON DELETE SET NULL
);

CREATE INDEX idx_arena_groups_issue_id   ON arena_groups(issue_id);
CREATE INDEX idx_arena_groups_project_id ON arena_groups(project_id);
```

> **Step 0 调研笔记**：旧版本 spec 用 `task_id` 关联 `tasks` 表，那是远程路径的语义。本 fork 的 Kanban 卡是 `local_issues`，因此关联键改为 `issue_id`，`project_id` 冗余写入便于 list/RBAC（见 [notes-step0.md §2.1](./notes-step0.md)）。

### 3.3 新增列：`workspaces.arena_group_id`

```sql
ALTER TABLE workspaces ADD COLUMN arena_group_id BLOB;
ALTER TABLE workspaces ADD COLUMN arena_status TEXT
    NOT NULL DEFAULT 'active'
    CHECK (arena_status IN ('active','promoted','archived'));

CREATE INDEX idx_workspaces_arena_group_id ON workspaces(arena_group_id);
```

**字段含义**：
- `arena_group_id` 为 NULL 表示该 workspace 不是 arena 模式（保留向后兼容）
- `arena_status` 仅在 `arena_group_id IS NOT NULL` 时有意义：
  - `active`：评审中
  - `promoted`：被用户挑中合并（每组仅一个）
  - `archived`：被弃用 / 同组中其他被 promote
- `arena_status` 与现有的 `workspaces.archived`（用户主动软删除/归档）**互不替代**：
  - `arena_status='archived'` 表示 "在 arena 中败北"
  - `archived=true` 表示 "用户主动归档"
  - Promote 流程：先把胜出 workspace 的 `arena_status` 设为 `promoted`，对其他同组 workspace 同时设 `arena_status='archived'` **和** `archived=true`，后者会触发 `find_expired_for_cleanup` 的 1 小时加速清理路径

**Rust 侧 enum 定义（在 `crates/db/src/models/workspace.rs`）**：

```rust
#[derive(Debug, Clone, Copy, sqlx::Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaStatus {
    Active,
    Promoted,
    Archived,
}

impl Default for ArenaStatus {
    fn default() -> Self { ArenaStatus::Active }
}
```

### 3.4 迁移脚本路径

`crates/db/migrations/<YYYYMMDDHHMMSS>_add_ai_arena.sql`

### 3.5 ts-rs 类型同步

修改 `crates/server/src/bin/generate_types.rs` 加入新模型（`shared/types.ts` 通过 `pnpm run generate-types` 重新生成，**禁止手改**）。

---

## 4. 后端 API

### 4.1 新增端点

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/local/v1/issues/{issue_id}/arena` | 创建 arena_group + 并行 spawn N 个 workspace；同时为每个 workspace 写一行 `local_workspace_links` |
| GET  | `/api/local/v1/issues/{issue_id}/arena/active` | 取得该 issue 当前未 promote 的 active group（最多一个） |
| GET  | `/api/local/v1/arena/{group_id}` | 取得 group 详情（含所有 workspaces 的实时状态） |
| POST | `/api/local/v1/arena/{group_id}/promote` | 选择某个 workspace 为胜出方案，其余标 archived |
| POST | `/api/local/v1/arena/{group_id}/workspaces/{workspace_id}/retry` | 单栏 retry（标当前为 archived，开新 workspace 加入同组） |
| DELETE | `/api/local/v1/arena/{group_id}` | 解散 group（保留 workspaces，但取消 arena 关联 + 清掉 worktree） |

> **顺手补一个**：`GET /api/local/v1/issues/{issue_id}/workspaces` —— 当前后端 `get_workspaces` 不支持按 issue 过滤（前端 `?task_id=` 是 dead code，见 [notes-step0.md §3.5](./notes-step0.md)），实施 Step 1 时一并补上。

### 4.2 创建请求示例

```json
POST /api/local/v1/issues/abc123/arena
{
  "base_branch": "main",
  "prompt": "Add CSV export endpoint",
  "executors": [
    { "executor_type": "claude-code", "model": "claude-opus-4.6" },
    { "executor_type": "codex",       "model": "gpt-5-codex" },
    { "executor_type": "gemini-cli",  "model": "gemini-2.5-pro" }
  ]
}
```

返回：

```json
{
  "group_id": "...",
  "workspaces": [
    { "id": "ws-1", "executor": "claude-code", "branch": "vk/abc123-arena-1", "status": "starting" },
    { "id": "ws-2", "executor": "codex",       "branch": "vk/abc123-arena-2", "status": "starting" },
    { "id": "ws-3", "executor": "gemini-cli",  "branch": "vk/abc123-arena-3", "status": "starting" }
  ]
}
```

### 4.3 与现有 routes 的关系

- 复用 `crates/server/src/routes/workspaces/create.rs` 的 workspace 创建逻辑（在循环里 spawn N 个 + 写入 `arena_group_id`）
- 复用 `execution.rs` 的 session / process 启动逻辑（每个 workspace 独立按现有流程）
- WebSocket 推送（`streams.rs`）按 workspace 推，前端聚合到 group 视图

---

## 5. 前端 UI

### 5.1 创建卡片：Race Mode 切换

- 卡片创建表单底部新增 toggle "Race mode (try multiple agents)"
- 打开后，原本"选一个 executor"的下拉变成"加一行 / 删一行"的 executor 列表，最少 2 行最多 6 行（避免 worktree 爆炸）
- 每行可独立配置 model、temperature、template

### 5.2 卡片详情：N 栏并列视图

- 当卡片关联到 `arena_group_id`，详情页头部出现 "Arena · 3 attempts" tab
- 切到 Arena tab 后，区域 split 成 N 栏（横向滚动 / 1280px 以下自动收成 carousel）
- 每栏顶部：executor logo + 模型名 + 状态徽标（running/completed/failed）+ 用时 + token 估算
- 每栏中部：现有的 diff viewer（复用 `ChangesPanelContainer`）
- 每栏底部：`[Promote]` `[Retry]` `[Reject + Comment]` 三按钮

### 5.3 Promote 行为

- 点 Promote → 弹确认（"This will merge ws-X and archive the others. Worktrees of archived attempts will be cleaned up automatically.")
- 确认 → 调 `/promote` API → 该 workspace 走标准 merge / PR 流；其余 workspaces 同时标 `arena_status='archived'` 与 `archived=true`，触发 `find_expired_for_cleanup` 的 1 小时加速清理
- 卡片自动从 "Review" 列移到 "Done" 列
- **不**直接调 `container.delete(workspace)` 同步删 worktree —— 那会阻塞响应；交给后台清理（见 [notes-step0.md §2.3 / §5.1](./notes-step0.md)）

### 5.4 Reject 行为（复用现有 inline comments）

- 现有的"reject + new attempt"流保持不变，但范围只在该栏：reject 后该栏单独开新 workspace 替代当前栏，其他栏不动

### 5.5 i18n / 文案

- 所有新文案放到 `packages/local-web/src/i18n/`，遵循现有 key 风格

---

## 6. 工程约束

### 6.1 资源上限

- 默认单 task arena 最多 **3 个 workspace**，可在 Project Settings 调到 6
- 防止用户一次开 10 个 worktree 把磁盘搞爆

### 6.2 端口分配（dev server 隔离）

- 现有的 `parallel_setup_script_to_projects` 已经支持并行 setup
- arena 模式下，每个 workspace 的 dev server 用 `hash_port(workspace_id)` 算端口避免冲突（参考 worktrunk 的做法）

### 6.3 分支命名

- `vk/<task_short_id>-arena-<index>`（index = 1..N，按创建顺序）
- 与现有 `vk/<id>-...` 风格一致

### 6.4 与 Electric 同步

- 本仓库已把 Electric 改为本地 fallback；arena_groups 也走 `/api/local/v1/fallback/...` 路径
- **实施落地**（已确认）：本仓库**没有** `crates/server/src/routes/local/` 目录；fallback 注入点在 `crates/server/src/routes/local_remote.rs::router()` 第 101–129 行（参考 `fallback_issues` / `fallback_user_workspaces` 写法）。Step 1 在该 fn 内追加 `.route("/v1/fallback/arena_groups", get(fallback_arena_groups))` 即可。详见 [`plan.md` Step 1 启动前 Checklist](./plan.md)。
- ts-rs 生成的类型放到 `shared/types.ts`（不要手改），在前端通过相同的 React Query / Electric hook 模式订阅

### 6.5 与 PR 集成

- arena 模式只允许**胜出 workspace** 创建 PR
- archived workspace 不允许 push 远端

---

## 7. 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| AC-1 | 创建 race mode 卡片选 3 executor | 看板出现 1 张卡，详情页 Arena tab 显示 3 栏，3 个 worktree 实际创建 |
| AC-2 | 3 个 agent 同时跑 | 三栏日志独立流式更新，互不阻塞 |
| AC-3 | 中间一个 agent 失败 | 该栏标 failed，其他 2 个继续；该栏可单独 retry |
| AC-4 | Promote 第 2 栏 | 第 2 栏走 merge 流；第 1、3 栏标 archived 且 worktree 被清；卡片移到 Done |
| AC-5 | 删除卡片 | 通过 `local_workspace_links` 上的 `ON DELETE CASCADE` → 关联的 N 个 workspaces 被删 → `arena_group` 通过自身的 `ON DELETE CASCADE`（issue_id FK）被删；worktree 由后台清理任务异步处理（不阻塞响应） |
| AC-6 | 关闭并重启 vibe-kanban | 评审中的 arena 状态正确恢复 |
| AC-7 | 关掉 race mode 创建普通卡片 | 与原行为完全一致（无 regression） |

---

## 8. 风险与未决问题

### 8.1 已知风险

| 风险 | 缓解 |
|---|---|
| N 个 worktree 同时 npm install 把本机 IO 打爆 | 默认共享 `node_modules`（symlink），与现有 worktree 创建逻辑一致 |
| Diff 多栏 UI 在 1280px 以下变挤 | 自动降级为 carousel + 缩略图侧边栏 |
| Token 成本翻 N 倍 | UI 显示预估 token 总和；Project Settings 加月度阈值告警 |
| 三个 agent 都失败 | 卡片不自动转 Done；保留所有日志；用户手动决定 retry 或放弃 |

### 8.2 未决问题（实施前需要确认）

1. **是否允许同 executor 多实例**（例如 Claude opus × 3 不同 prompt）？建议 V1 不允许，V2 再开。
2. **Arena 模式下 dev server 是否每栏都起**？建议默认只起选中栏的 dev server，避免端口爆炸。
3. **失败重试是否扣预估配额**？跟 Token Dashboard（T1-4）的工作合并讨论。

---

## 9. 不影响范围（Backward Compatibility）

- `arena_group_id` 列允许 NULL，老 workspace 全部为 NULL
- API 端点全部新增，不修改现有 `/api/local/v1/workspaces/*` 行为
- 前端按 `arena_group_id` 是否存在切换显示，老卡片完全不变

---

## 10. 关联文档

- 调研笔记（spec 与代码侧的实际验证、修订理由）：[`notes-step0.md`](./notes-step0.md)
- 实施计划：[`plan.md`](./plan.md)
- 上层路线图：[`../future_task.md`](../future_task.md)
- 竞品参考：`johannesjo/parallel-code`（Electron + SolidJS）的 AI Arena 截图与文案

---

## 修订历史

| 日期 | 修订点 | 来源 |
|---|---|---|
| 2026-05 初稿 | 创建本规格 | T0-1 路线图 |
| 2026-05 修订 | 关联键 `task_id` → `issue_id`（§3.1/§3.2/§4.1）；新增 `project_id` 列；`arena_status` 增加 Rust enum 定义（§3.3）；Promote 改异步清理（§5.3）；Electric fallback 强调实施前必查（§6.4）；AC-5 细化为 cascade + 后台清理（§7） | [notes-step0.md §6](./notes-step0.md) |
