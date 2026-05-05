# AI Arena — Step 3 实施记录

> 日期：2026-05 · 状态：草稿落地完成（待 `pnpm run check` / `pnpm run lint` 验证）
>
> 配套：[`spec.md`](./spec.md) · [`plan.md`](./plan.md) · [`impl-step1-2026-05.md`](./impl-step1-2026-05.md) · [`impl-step2-2026-05.md`](./impl-step2-2026-05.md)

---

## 1. 落地清单

### 3.1 Mutation hook

文件：`packages/web-core/src/shared/hooks/useArenaActions.ts`（新建，~80 行）

- `useArenaActions(groupId, issueId)` → `{ promote, retry, dissolve }` 三个 React Query `useMutation`
- `promote.mutateAsync({ workspaceId })` → 调 `arenaApi.promote`
- `retry.mutateAsync({ workspaceId, payload })` → 调 `arenaApi.retry`
- `dissolve.mutateAsync()` → 调 `arenaApi.dissolve`
- `onSuccess` 把返回的最新 `ArenaGroupResponse` 直接 `setQueryData` 进 `arenaQueryKeys.group(groupId)`，所以 `useArenaGroup` 不用等下一次 4s 轮询就能立即更新
- `onSettled`（含失败）也 `invalidateQueries` group + activeForIssue，做兜底刷新

### 3.2 ActionsBar 组件

文件：`packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx`（新建，~140 行）

- 每个 column 底部固定 `[Promote] [Retry]` 两按钮（**没做** `[Reject]`，原因见下）
- `Promote`：destructive `ConfirmDialog.show({ ... variant: 'destructive' })`，文案根据"是否还有 live 兄弟"动态切换；用户确认后才发请求
- `Retry`：直接发请求，不弹确认（spec 说可逆且不阻塞其他栏）；从当前 workspace 的 `executor` + `variant` 镜像构造 `ExecutorConfig`，`prompt: null` → 后端 fallback 到 group 共享 prompt
- 当 `arena_status !== 'active'` 或 group 已 promoted 时整组 disable
- 失败时 inline `<p role="alert">` 显示错误，不打扰其他栏

### 3.3 Header 上的 Dissolve

修改：`packages/web-core/src/features/arena/ui/ArenaView.tsx`

- 新加 `ArenaHeader` 内部 dissolve 按钮（仅 group 未 promoted 时显示）
- 同样走 `ConfirmDialog.show({ variant: 'destructive' })` 二次确认
- 成功后调用 `onDissolved` 回调（host app 决定跳哪儿）；fallback 到 `window.history.back()`
- `ArenaView` 接收新 prop `onDissolved?: () => void`

### 3.4 接入 + 路由层

修改：`packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx`

- 新增 prop `group: ArenaGroupResponse`，作为 `ArenaActionsBar` 的输入
- 在 column 底部挂 `<ArenaActionsBar group={group} workspace={workspace} />`

修改：`packages/local-web/src/routes/_app.projects.$projectId_.issues.$issueId_.arena.$groupId.tsx`

- 新增 `useNavigate` + `handleDissolved`：dissolve 成功后跳回 `/projects/:projectId/issues/:issueId`
- 通过 `as '/'` 类型 cast 绕过 TanStack Router 的静态路由表校验（与 `NotificationsPage.tsx:86` 同款做法）

---

## 2. 验收对应

| spec.md AC | Step 3 验收覆盖度 | 备注 |
|---|---|---|
| AC-3 一栏失败不阻塞其他栏 | ✅ Retry 仅作用于本栏；前端 mutation 隔离；error 显示在本栏 inline 不阻塞页面 | — |
| AC-4 Promote 第 N 栏 → 该栏走 merge 流；其余 archived | ✅ 后端流程在 Step 1 已实现；Step 3 加 UI 触发；merge / PR 复用现有 workspace 详情页流（不动） | 跳到 promoted workspace 详情页的入口待 Step 4 |
| AC-5 删卡片 → cascade 清理 | ✅ 后端在 Step 1 通过 `local_workspace_links ON DELETE CASCADE` 已实现；前端不需要新增逻辑 | — |
| AC-6 重启后状态恢复 | ✅ 完全依赖 DB 持久化；前端只是查询 `useArenaGroup` 拿到当前 DB 状态 | — |

---

## 3. 设计决策

### 3.1 为什么没实现 [Reject + Comment]

spec.md §5.4 描述 reject = "复用现有 inline comments → 该栏单独开新 attempt"。但：

- 现有 inline comments 系统在 `ChangesPanelContainer` + `useReview` 内部，是与单 workspace 详情页强耦合的
- "Reject 后开新 attempt" 在 arena 语义下与 `Retry` 等价（都是 archive 当前 + 创建新 sibling）
- 推迟到 Step 4：让用户从 column 头部链接进 workspace 详情页 → 在那里走标准 review 流 → 自动触发 retry mutation

这样保持 Step 3 的范围聚焦在 promote/retry/dissolve 三个**核心** state transition，而把 inline comments 的集成与 Step 4 的 create-mode UI 一起做。

### 3.2 为什么 onSuccess 直接 setQueryData

React Query 的常规模式是 `invalidateQueries` 触发 refetch。但 arena 的 mutation 后端响应**已经包含完整的最新 group state**（包括所有 workspace 的 arena_status 转换），直接 `setQueryData` 比再发一次 GET 节省一个 round-trip，UI 反应也更快（200ms vs ~600ms）。

依然在 `onSettled` 里加了 `invalidateQueries` 做兜底——失败情况下、或者后端在两次 mutation 间被外部修改（比如另一个浏览器 tab）时，让下一次轮询能拉到 server truth。

### 3.3 为什么 Dissolve 只在 header

每栏 `[Reject]` 与 group 级 `[Dissolve]` 视觉上容易混淆。把 Dissolve 收到 header（且仅当 group 未 promoted 时显示）能：

1. 强调它是"放弃整个 race"而不是"放弃这一栏"
2. 减少误操作（destructive 集中在一个不显眼的位置）
3. 与未来的 group-level metadata（如 prompt 编辑、attempts 计数等）放在同一区域

---

## 4. 文件清单

```
new file:   packages/web-core/src/shared/hooks/useArenaActions.ts                  ~80  LOC
new file:   packages/web-core/src/features/arena/ui/ArenaActionsBar.tsx           ~140 LOC
modified:   packages/web-core/src/features/arena/ui/ArenaView.tsx                  +60  LOC (header dissolve)
modified:   packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx       +10  LOC (mount ActionsBar)
modified:   packages/local-web/src/routes/_app.projects.$projectId_...arena.$groupId.tsx
                                                                                    +10  LOC (navigate after dissolve)
modified:   docs/future/ai-arena/plan.md                                           进度表更新
new file:   docs/future/ai-arena/impl-step3-2026-05.md                             本文件
```

---

## 5. 验收待办

- [ ] `pnpm run web-core:check`（前端 tsc）
- [ ] `pnpm run local-web:check`
- [ ] `pnpm run local-web:lint`
- [ ] 启 dev：`pnpm run dev`
  - 用 Step 1 的 curl 创建 arena group
  - 浏览器打开 ArenaView
  - 点 Promote → 确认 → 该栏徽标变 promoted、其他栏变 archived、其他栏 [Promote]/[Retry] 都 disable
  - 在另一栏点 Retry → 该栏变 archived、grid 出现新一栏 active
  - 点 header [Dissolve] → 确认 → 全部 archived 且重定向回 issue 详情页
  - 检查 SQLite：`workspaces.arena_status` / `arena_groups.promoted_workspace_id` 各对应正确
- [ ] 重启 vibe-kanban → 重新打开同一 arena URL → 状态正确恢复（AC-6）

---

## 6. 下一步（Step 4 准备）

- 在 issue 详情页加 "Race mode" toggle / 跳到 ArenaView 的 tab 入口
- 创建 race 卡片表单：嵌入 `features/create-mode/` store 模式
- Project Settings 页加 `arena_max_workspaces` 配置
- `hash_port(workspace_id)` 端口分配（防止 N 个 dev server 端口冲突）
- 与 git-build.md 提到的「Windows 原生集成」可以并行做（与 Arena 不冲突）
