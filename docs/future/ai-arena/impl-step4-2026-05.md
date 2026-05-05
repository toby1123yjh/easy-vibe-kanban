# AI Arena — Step 4 实施记录

> 日期：2026-05 · 状态：草稿落地完成（待 `pnpm run check` / `pnpm run lint` / `cargo check` 验证）
>
> 配套：[`spec.md`](./spec.md) · [`plan.md`](./plan.md) · [`impl-step1-2026-05.md`](./impl-step1-2026-05.md) · [`impl-step2-2026-05.md`](./impl-step2-2026-05.md) · [`impl-step3-2026-05.md`](./impl-step3-2026-05.md)

---

## 1. 落地清单

### 4.1 CreateArenaDialog

文件：`packages/web-core/src/features/arena/ui/CreateArenaDialog.tsx`（新建，~270 行）

- NiceModal-based dialog，`defineModal` 暴露 `CreateArenaDialog.show({ projectId, issueId, initialPrompt?, maxAttempts? })`
- 字段：
  - `prompt`（textarea，3 行）
  - `repo` select（来自 `repoApi.list()` query）
  - `base_branch` input（默认从所选 repo 的 `default_target_branch` 自动填充）
  - **N 行 attempts**：每行 `executor` (BaseCodingAgent enum) + `variant` (string)
  - 减/加 attempt 按钮（按 `[ARENA_MIN_ATTEMPTS, maxAttempts]` 区间约束）
- 提交 → `arenaApi.create(issueId, payload)` → modal.resolve `{ kind: 'created', groupId }`
- 取消 → modal.resolve `{ kind: 'canceled' }`
- 错误显示在 inline `<p role="alert">`

### 4.2 Issue 详情页入口

文件：`packages/web-core/src/pages/kanban/IssueArenaSectionContainer.tsx`（新建，~95 行）

- 通过 `useActiveArenaForIssue(issueId)` 拉当前 issue 的 active group
- 三种渲染状态：
  1. **Loading**：null（避免闪烁）
  2. **已有 active group**：`[Arena · N attempts (M running)] [Open →]` 链 chip（emerald 样式标识 race 进行中）
  3. **无 active group**：`[Race mode] [Start race →]` 普通按钮 → 调 `CreateArenaDialog.show()` → 创建成功后跳到 `/projects/.../arena/:groupId`

修改：`packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx`

- `renderWorkspacesSection` render-prop 包成 fragment，先渲染 `<IssueArenaSectionContainer>`，再渲染原 `<IssueWorkspacesSectionContainer>`
- 不改 KanbanIssuePanel UI 库类型签名，零侵入

### 4.3 项目级资源上限

新文件：`crates/db/migrations/20260505000000_add_arena_max_workspaces.sql`

```sql
ALTER TABLE local_project_metadata
    ADD COLUMN arena_max_workspaces INTEGER NOT NULL DEFAULT 3
    CHECK (arena_max_workspaces BETWEEN 2 AND 6);
```

修改：`crates/server/src/routes/local_remote.rs`

- 新增 `arena_max_for_project(pool, project_id)` —— 从 `local_project_metadata.arena_max_workspaces` 读取，未迁移行 fallback 到 `ARENA_MAX_ATTEMPTS=6`，最终 clamp 到 `[2, 6]`
- `create_arena_group` 把校验拆为两步：
  - "至少 2 attempts" 走全局常量
  - "至多 N attempts"（N = project-specific cap）走新 helper
- 错误信息中暴露具体上限（`Project allows at most 3 arena attempts`）方便前端展示

> **未做的 Project Settings UI**：spec.md §6.1 提到 "可在 Project Settings 调到 6"。本 Step 4 落到 schema + 后端校验为止；前端 Project Settings 页对 `arena_max_workspaces` 的编辑控件作为后续工作（与 T0-2 MCP 面板等共享 Project Settings 改造）。当前 dialog `maxAttempts` prop 仍接受默认 6，后端会把超出项目实际上限的请求挡掉并返回友好错误。

---

## 2. 验收对应

| spec.md AC | Step 4 验收覆盖度 | 备注 |
|---|---|---|
| AC-1 创建 race mode 卡片选 N executor → 三栏出现 | ✅ CreateArenaDialog 完整闭环 → ArenaView | — |
| AC-7 关掉 race mode 创建普通卡片，行为完全一致 | ✅ Race mode 是独立 entry，没改 IssueWorkspacesSectionContainer | "关掉" 等价于"不点 Start race"按钮 |

---

## 3. 偏差与延后

| 项 | spec/plan 描述 | 实际实施 | 原因 |
|---|---|---|---|
| Race Mode 集成在 create-mode 表单 | plan.md §4.1: "嵌入 `features/create-mode/` store 模式" | 改用独立 NiceModal `CreateArenaDialog` | create-mode store 状态层很复杂（dialog 跨 step / scratch 持久化），把 arena 嵌进去会显著放大 Step 4 工时；spec.md §5.1 的 toggle 用户体验也被独立 dialog 自然替代 |
| Project Settings 调 max | plan.md §4.2 | schema + 后端校验 ✅；前端编辑 UI ❌ | 前端 Project Settings 改造工作量大，与 Arena 主线偏离；预留 hook 给后续工作 |
| dev server `hash_port(workspace_id)` | plan.md §4.3 | ❌ 未做 | 需要改 worktree-manager 的端口分配；该改动会影响所有非 arena workspace；spec §6.1 说"默认只为 promoted workspace 起 dev server" → 在 N 个 attempt 同时跑时，dev server 通常不会被 N 个一起拉起；推迟到下次 Project Settings 改造 |
| Slash Command 注入到 prompt | T1-2 路线 | 未做 | T1 工作，与 T0-1 Arena 解耦 |

---

## 4. 文件清单

```
new file:   crates/db/migrations/20260505000000_add_arena_max_workspaces.sql
modified:   crates/server/src/routes/local_remote.rs                              +30 LOC (arena_max_for_project + 校验改造)

new file:   packages/web-core/src/features/arena/ui/CreateArenaDialog.tsx        ~270 LOC
new file:   packages/web-core/src/pages/kanban/IssueArenaSectionContainer.tsx     ~95 LOC
modified:   packages/web-core/src/features/arena/index.ts                          +5 LOC (export Dialog)
modified:   packages/web-core/src/pages/kanban/KanbanIssuePanelContainer.tsx       +6 LOC (mount Arena section)

modified:   docs/future/ai-arena/plan.md                                           进度更新
new file:   docs/future/ai-arena/impl-step4-2026-05.md                             本文件
```

---

## 5. 全 Step 完成度

| Step | 状态 |
|---|---|
| 0 — 调研 | ✅ |
| 1 — 数据模型 + API（草稿） | ✅ |
| 2 — 多栏 Diff 视图（草稿） | ✅ |
| 3 — Promote / Retry / Dissolve（草稿） | ✅ |
| 4 — Create UI + 资源上限（草稿） | ✅ |

**Arena MVP 草稿全部落地**。所有改动等待 cargo check / pnpm check 通过即可进 PR。

---

## 6. 跨 Step 验收（plan.md "跨 Step 验收" 章节）

```bash
# 后端
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm run prepare-db        # 重生 .sqlx/*.json
pnpm run generate-types    # 重生 shared/types.ts（含 ArenaGroup / ArenaStatus 等）

# 前端
pnpm run web-core:check
pnpm run local-web:check
pnpm run local-web:lint

# 端到端
pnpm run dev
# 1. Kanban → 选一个 issue 卡片 → 详情 panel 看到 [Race mode] [Start race]
# 2. 点 → CreateArenaDialog 出现 → 选 repo + 输入 prompt + 加 3 个不同 executor
# 3. 提交 → 跳到 /projects/:pid/issues/:iid/arena/:gid
# 4. 三栏并排 → 状态徽标实时更新 → 每栏显示 diff 摘要
# 5. 点 [Promote] 第二栏 → 二次确认 → 该栏 promoted、其他两栏 archived
# 6. 浏览器回到 issue → 看到 [Arena · 3 attempts] chip 但已 promoted ⇒ chip 消失（active hook 返回 null）
```

---

## 7. 后续路线（T0-1 之外）

完成 Arena 核心后，differential 价值最高的下一步是：

- **T0-2 MCP 服务器统一面板**（项目级共享配置，含 Project Settings UI）— 顺势带上 `arena_max_workspaces` 的编辑控件
- **T0-4 附件本地化**（git-build.md 点名待办）
- **T0-3 Windows 原生集成**（任务栏 / Toast / WSL2 桥）

（详见 [`future_task.md` §4](../future_task.md)）
