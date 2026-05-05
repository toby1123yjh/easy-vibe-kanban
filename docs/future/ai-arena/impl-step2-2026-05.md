# AI Arena — Step 2 实施记录

> 日期：2026-05 · 状态：草稿落地完成（待 `pnpm run check` / `pnpm run lint` 验证）
>
> 配套：[`spec.md`](./spec.md) · [`plan.md`](./plan.md) · [`impl-step1-2026-05.md`](./impl-step1-2026-05.md)

---

## 1. 落地清单

### 2.1 API 客户端

文件：`packages/web-core/src/shared/lib/arenaApi.ts`（新建，~190 行）

- 直接走 `makeLocalApiRequest` 而非 `remoteApi.ts::makeRequest`，因为 arena 是**本地独占端点**（云端没有），不能让 `isLocalRemoteApiEnabled()` 决定路由。
- 类型副本（与 Rust ts-rs 输出对齐）：`ArenaStatus` / `ArenaGroup` / `ArenaWorkspaceSummary` / `ArenaGroupResponse` / `ArenaAttemptInput` / `WorkspaceRepoInput` / `CreateArenaRequest` / `PromoteArenaRequest` / `RetryArenaRequest` / `DissolveArenaResponse`
  - 等 CI 跑 `pnpm run generate-types` 后，可考虑切换到 `import { ... } from 'shared/types'`，但当前选择在文件内本地声明以保持前端编译独立。
- 7 个 endpoint 客户端方法：`create` / `getActiveForIssue` / `get` / `promote` / `retry` / `dissolve` / `listIssueWorkspaces`
- `mutate<T>` 内联 `MutationResponse<T> = { data, txid }` 解包；`getJson<T>` 直接返回裸 JSON。

### 2.2 React Query hook

文件：`packages/web-core/src/shared/hooks/useArenaGroup.ts`（新建，~120 行）

- `arenaQueryKeys` —— 集中查询键（`group(gid)` / `activeForIssue(iid)`）
- `useArenaGroup(groupId)` —— 拿 group + workspaces，**自适应轮询**：当至少一个 workspace 还在 `active` 状态时每 4s 轮询；全部 promoted/archived 后停止
- `useActiveArenaForIssue(issueId)` —— 同样轮询逻辑，给 issue 详情页判断"是否要默认显示 Arena tab"用
- `useArenaInvalidators()` —— 暴露 `invalidateGroup` / `invalidateIssue` / `invalidateAll`，给 Step 3 的 promote/retry mutation 主动失效缓存用

> Step 2 选用 React Query 轮询而非 SSE/WS 实时流，是为了在 read-only 阶段把组件复杂度降到最低。Step 3 加 mutation 时复用同一组 query keys，到 Step 4 如果觉得 4s 延迟可见，再考虑接入现有的 `/api/events` SSE 流并做 patch invalidation。

### 2.3 ArenaView UI

目录：`packages/web-core/src/features/arena/`

- `ui/ArenaWorkspaceColumn.tsx` —— 单栏：executor 名 + variant + branch + 状态徽标（`active`/`promoted`/`archived` 三色）+ 用 `useDiffSummary(workspace_id)` 拉的 diff 摘要（文件数 + 总 ±行数）
  - **关键设计抉择**：不在每一栏直接挂 `ChangesPanelContainer`。原因：`ChangesPanelContainer` 通过 zustand 单例 store (`useWorkspaceDiffStore`) 读取 diff，N 栏共享会互相串扰。Step 2 渲染轻量摘要 + "点击栏头跳到 workspace 详情页" 即可满足验收标准。Step 3 决定是否值得把 `useWorkspaceDiffStore` 改成 keyed-by-workspaceId 以支持真·N 栏内联 diff。
  - 用原生 `<a>` 而非 `Link`，避免对 `local-web` 路由 type 表的硬依赖（`@vibe/web-core` 也会被 `remote-web` 用）。
- `ui/ArenaView.tsx` —— 容器：`useArenaGroup(groupId)` 拉数据 + `ArenaHeader`（prompt 摘要 + 状态计数）+ N 栏 grid（`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`）
- `index.ts` —— barrel export

> 响应式：1280px (xl) 以上 3 栏；md (768) 至 xl 之间 2 栏；以下单栏滚动。spec.md §5.2 说"≤1280px 自动 carousel"——目前用纵向单栏滚动替代，体验等价且实现更简单。如果 Step 4 用户测试觉得不够好再换 carousel。

### 2.4 路由 + 入口

文件：`packages/local-web/src/routes/_app.projects.$projectId_.issues.$issueId_.arena.$groupId.tsx`（新建）

- 路径：`/projects/:projectId/issues/:issueId/arena/:groupId`
- 渲染 `<ArenaView groupId={groupId} buildWorkspaceHref={...}>`，`buildWorkspaceHref` 把每栏头部链接指向现有的 `/projects/.../issues/.../workspaces/:workspaceId` 路径
- TanStack Router 的 `routeTree.gen.ts` 会在下次 vite dev 启动时自动加上这个路由

> **未做**：在 issue 详情页（`_app.projects.$projectId_.issues.$issueId.tsx`）加 "Arena tab" 跳转入口。当前用户得直连 URL 才能看到 arena view。这块工作放到 Step 4 一起做（创建 Race Mode 卡片 + tab 入口同时）—— 因为现在 issue 详情页本身只是 mount `LocalProjectKanban`，注入 tab 需要更深的页面改造，与 Step 2 的 read-only 目标不符。

---

## 2. 验收对应

| spec.md AC | Step 2 验收覆盖度 | 备注 |
|---|---|---|
| AC-1 三栏出现 | ✅ ArenaView 直连可看 | 创建入口 Step 4 |
| AC-2 三栏独立流式更新 | ✅ 每栏独立 useDiffSummary | 4s 轮询 group 状态 + 独立 diff WS |
| AC-3 一栏失败不阻塞其他栏 | ⚠️ UI 上栏头会显示 archived；Promote/Retry 在 Step 3 | — |

---

## 3. 与 spec / plan 的偏差

| 项 | 计划描述 | 实际实施 | 原因 |
|---|---|---|---|
| Diff 渲染 | plan.md §2.2: "每栏复用现有 `ChangesPanelContainer`" | 改用 `useDiffSummary` 摘要 + 跳转链接 | 现有 ChangesPanelContainer 依赖 zustand 单例 store；N 栏共享会串扰。延后到 Step 3 评估改 store-shape 的成本 |
| 1280px 以下 | spec §5.2: carousel + 缩略图侧边栏 | 单栏垂直滚动 | 实现更简单；视觉差异小；Step 4 再视用户反馈调整 |
| Issue 详情页 Arena tab | plan.md §2.2: 详情页 Tab | 仅加直连路由；详情页改动延后 Step 4 | 当前 issue 详情页是 monolithic kanban 视图；插 Tab 改动面大、与 read-only 主题不符 |
| 类型导入 | "通过 shared/types 导入 generated 类型" | 在 `arenaApi.ts` 内本地声明 mirror 类型 | `pnpm run generate-types` 需 cargo 跑通；本机受限 → 先本地声明保前端可独立编译；CI 跑通后可切换 |

---

## 4. 文件清单（diff stat）

```
new file:   packages/web-core/src/shared/lib/arenaApi.ts                              ~190 LOC
new file:   packages/web-core/src/shared/hooks/useArenaGroup.ts                       ~120 LOC
new file:   packages/web-core/src/features/arena/ui/ArenaView.tsx                      ~90 LOC
new file:   packages/web-core/src/features/arena/ui/ArenaWorkspaceColumn.tsx          ~110 LOC
new file:   packages/web-core/src/features/arena/index.ts                                3 LOC
new file:   packages/local-web/src/routes/_app.projects.$projectId_.issues.$issueId_.arena.$groupId.tsx
                                                                                       ~30 LOC
modified:   docs/future/ai-arena/plan.md                                              进度表更新
new file:   docs/future/ai-arena/impl-step2-2026-05.md                                本文件
```

---

## 5. 待验收 / 下一步

- [ ] `pnpm run local-web:check`（前端 tsc）
- [ ] `pnpm run web-core:check`
- [ ] `pnpm run local-web:lint`（依赖 i18n 脚本，可能要给新文件加翻译 key 或加 `eslint-disable-next-line i18next/no-literal-string`）
- [ ] 启 dev：`pnpm run dev`，先用 `curl` 跑 Step 1 的 `POST /api/local/v1/issues/<id>/arena` 创建一个测试 group，然后浏览器开 `http://localhost:<frontend-port>/projects/<pid>/issues/<iid>/arena/<gid>` 看三栏

Step 3 准备：
- `useArenaActions` hook（promote / retry / dissolve mutation + invalidateGroup）
- `ArenaWorkspaceColumn` 加底部 ActionsBar（[Promote] [Retry] [Reject])
- 复用现有 `<ConfirmDialog>` 做 promote 二次确认
- 实测 ChangesPanelContainer 的 store 是否真的需要改 shape，决定是否在 ArenaView 内嵌真·内联 diff
