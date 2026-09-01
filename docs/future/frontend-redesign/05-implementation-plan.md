---
title: '前端全量重构实施计划'
description: '说明 Vibe Kanban 如何在保持运行时契约稳定的前提下完成所有页面、组件和主题的重构。'
---

## 实施目标

在 `refactor/frontend-redesign` 分支内完成所有产品页面的统一重构，保留 `Vibe Kanban` 名称并以“多智能体开发控制台”组织产品能力，最终一次性提供完整的新前端。开发过程可以按阶段提交和验证，但不长期发布新旧页面混合的产品。

## 总体策略

```mermaid
flowchart LR
    A[冻结页面与数据契约] --> B[建立 canonical Task 数据底座]
    B --> C[建立 Token 与基础组件]
    C --> D[替换 App Shell]
    D --> E[迁移核心业务页面]
    E --> F[迁移工作流、Arena 和设置]
    F --> G[覆盖状态、移动端和无障碍]
    G --> H[删除旧实现]
    H --> I[全量验证与发布]
```

原则：

- 先建立共享骨架，再迁移页面。
- 先让 Task、Workflow revision 和 Arena candidate 成为可信数据契约，再让新页面消费；不让前端承担三套执行实体的归一化。
- 先分离 View 与业务容器，再改视觉，避免把业务逻辑复制进新组件。
- 不为新 UI 创建第二套 Agent 生命周期或数据状态。
- 项目尚未发布，不保留旧 Task/Workspace/Workflow/Arena 双读双写；当前测试库通过一次性 migration 升级，迁移后删除兼容路径。
- 同一个阶段内同时维护 Local 与 Remote 入口。
- 每个阶段完成后保持分支可启动、可测试、可继续开发。

## 目标代码结构

```text
packages/ui/src/
├─ tokens/                 # primitive、semantic、component token
├─ primitives/             # Button、Input、Dialog、Tabs 等
├─ components/             # DataGrid、Inspector、Status、SplitPane
├─ patterns/               # Dashboard、Collection、Detail、Workbench、Canvas
└─ styles/                 # 主题入口、reset、syntax/diff 集成

packages/web-core/src/
├─ app/
│  ├─ shell/               # AppShell、ProductSidebar、PageCanvas
│  │  ├─ primary-nav/      # 产品路由、active 状态、聚合徽标
│  │  └─ system-zone/      # HostHealth、Settings、User、Version
│  ├─ navigation/          # PageTabs、Breadcrumb 与对象路由模型
│  └─ providers/           # 共享 provider 组合
├─ features/               # AttentionQueue、ActiveRuns、GlobalSearch 与现有业务 feature
├─ pages/                  # 页面容器，只组合 feature 和 pattern
├─ shared/
│  ├─ hooks/               # 共享业务 hook
│  ├─ lib/                 # 投影和纯函数
│  └─ navigation/          # Local/Remote 共用导航模型
└─ i18n/

packages/local-web/src/
└─ routes/                 # 路由绑定、Tauri 和本机能力

packages/remote-web/src/
└─ routes/                 # 路由绑定、认证和远程能力
```

不要求为了目录整洁一次性移动所有文件。只有在组件被实际迁移时才移动，并同步更新引用和测试。

## 状态管理边界

| 状态类型     | Owner                           | 示例                                            |
| ------------ | ------------------------------- | ----------------------------------------------- |
| URL 状态     | TanStack Router                 | 当前项目、工作区、Tab、筛选、选中节点           |
| 服务端状态   | canonical DB / 查询缓存 / Shape | Task、Issue、Session、AgentRun、Workflow、Arena |
| 运行流状态   | canonical projection            | RunState、审批、输入、时间线                    |
| 全局 UI 偏好 | Zustand                         | 侧栏、Inspector、主题、密度                     |
| 页面临时状态 | React local state               | 未提交表单、临时 hover、局部 Dialog             |
| 草稿状态     | 专用 draft store                | 创建工作区、未保存 Workflow graph               |

禁止将服务端实体复制进新的全局 Store 并长期双向同步。

Workflow Draft 中的 `TaskSpec` 属于草稿状态；数据库 `Task` 属于服务端执行身份。取消 Draft 或配置流程不得创建 Task，开始执行后也不得把 runtime status 复制回 Task 表。

## 阶段 0：设计确认与基线

### 产出

- 评审 [信息架构](./01-information-architecture.md)。
- 评审 [示例布局](./02-layout-wireframes.md)。
- 冻结 [页面矩阵](./04-page-matrix.md) 第一版。
- 保存当前关键页面的桌面和移动截图作为 before 基线。
- 冻结“保留 Vibe Kanban 名称、定位为多智能体开发控制台”的产品身份契约，并统一核心模块与对象文案。
- 明确 Dark-first 视觉基线、`System / Light / Dark` 三种 ThemeMode、首次启动默认 System、Compact 和响应式目标。

### 验收

- 每个现有路由和重要 Dialog 都能映射到目标页面或组件。
- 产品对象名称统一，不出现 Session、Run、Process、Workspace 混用。
- Dashboard、项目、Agent、Workflow、Arena 和工具管理都按核心能力呈现；工作页面不重复营销口号，也不把非看板能力降级为看板附属入口。
- 设计不违反现有 Agent Runtime、Workflow、Workspace header 合同。

## 阶段 1：canonical Task 与数据底座

### 产出

- 重建现有旧 Issue 语义的 `tasks` 为 canonical Task：稳定 ID、Project/Issue、可选父 Task、唯一标题、不可变 `agent | workflow | arena` 执行方式、创建/更新时间；Task 不保存 runtime status。
- 建立单 Agent Task → Session、Workflow Task → WorkflowAttempt、Arena Task → ArenaGroup、Workflow child Task → NodeExecution 的一对一 binding。Session 再指向 Workspace，不在 Task 上重复 Workspace identity。
- Workflow Draft 继续只保存 TaskSpec。运行时只将承载 Task 的 Agent/Arena Node 实例化为父 Workflow Task 的子 Task；Start、End、Condition、Human Gate、Transform 不创建 Task。Issue 投影只返回没有父 Task 的顶层 Task。
- 建立显式 `arena_candidates`：稳定 candidate ID、ArenaGroup、Workspace、`attempt | synthesis` purpose 和顺序；winner 引用 candidate identity，彻底移除根据 Workspace 名称推断 synthesis。
- 为 `workflows` 增加数据库 revision。更新 API 接收 `expected_revision` 并条件递增；冲突返回当前 revision，不能静默最后写覆盖。
- 建立唯一 `TaskSummary` 投影，从 execution kind 对应的唯一 binding 派生 canonical status 与 open target；Kanban、Issue、Dashboard、搜索和路由复用，不 UNION 三套旧对象、不双写状态。
- 单 Agent、Workflow、Arena 和 Workflow Node 执行创建使用事务原子创建 Task 与 binding；取消配置和失败回滚不留下空 Task、孤立 Session/Workspace 或半创建 candidate。
- 增加 Project、Session、顶层 Task 的 `(updated_at DESC, id)` 游标查询与复合索引，明确只有真实编辑/运行活动可以更新 owning entity；点击、current、selected 和浏览不写时间。
- 编写一次性顺序 migration：确定性回填当前测试库中可识别的单 Agent、Workflow、Node execution、Arena 与 candidate，校验外键/唯一性后重建表并删除旧 `tasks` 字段与模型、`workspaces.task_id`、名称推断和执行路径中的 `local_workspace_links`。
- Local SQLite 继续是执行 Task/runtime 的唯一写入 owner。Local/Remote 共享 TaskSummary；Remote 通过绑定 Host 的 canonical API 读写，Host 离线时显示不可用，不在 Remote PostgreSQL 新增第二 runtime writer。

### 验收

- 全新数据库从零执行全部 migrations 与当前测试 schema 顺序升级得到相同最终 schema；外键、唯一 binding、孤立记录和重复 Task 检查全部通过。
- 每个 Task ID 都能确定性得到唯一标题、执行方式、canonical 状态与打开目标；Issue/Project 查询不再拼接 Workspace、WorkflowAttempt、ArenaGroup。
- 三种顶层创建和 Workflow child 创建的成功、失败、取消、事务回滚测试覆盖完整；Arena candidate 数变化不改变 Issue Task 数。
- 两个客户端同时以 revision N 保存同一 Workflow 时，只有一个成功到 N+1，另一个收到明确冲突且本地 Draft 不丢失；单页面 N/N+1 异步保存仍不被旧响应覆盖。
- Workspace 或 candidate 改名不影响 attempt/synthesis purpose、winner 校验和 Workflow 继续执行。
- Fresh/upgrade migration、DB model、API、generated types、SQLx offline metadata、Local/Remote capability 和分页边界测试通过后，才能开始迁移消费 Task 的 UI。
- 最终运行时代码中不存在旧 Task 双读/双写、旧 schema 版本判断或 Remote 第二写入源。

## 阶段 2：Design Token 和基础组件

### 产出

- 将主题变量收敛为 Primitive、Semantic 和 Component 三层。
- 建立品牌橙、`text-on-brand` 与运行状态的独立 Semantic Token；品牌 Token 只进入产品身份、唯一主操作和 selected/focus，状态组件禁止回退到品牌色。
- 在首屏绘制前解析已保存 ThemeMode；没有偏好时使用 System，仅在 System 模式监听操作系统主题变化，避免主题闪烁且不影响路由或草稿状态。
- 重做按钮、输入、菜单、Dialog、Tabs、Badge、Status、Tooltip、Skeleton。
- 新增 SplitPane、Inspector、PrimaryNavItem、PageHeader、PageContext 和 EmptyState。
- 建立组件展示页或测试 Harness，覆盖 System 解析到 Dark/Light、显式 Dark/Light、状态、复杂内容和尺寸。

### 验收

- `packages/ui` 不导入 `web-core`。
- 所有组件具备 hover、focus、active、disabled、loading。
- 色彩对比度、键盘和减少动画通过人工与自动检查。
- Light 与 Dark 分别覆盖表面、边框、交互状态、Markdown、代码块、Diff、终端和状态色；System 不维护第三套 Token。
- 在两种主题中测量品牌表面与 `text-on-brand` 的对比度，并覆盖 selected + Running/Waiting/Error 等组合；品牌橙不能成为任何运行状态的 fallback。
- 自动化验证首次无偏好使用 System、系统主题变化只影响 System、显式 Light/Dark 不被系统变化覆盖，并检查首屏无错误主题闪烁。
- 新页面不再硬编码颜色、字号和间距。

## 阶段 3：统一 App Shell

### 产出

- 建立约 256px 的分区式 `ProductSidebar`：紧凑的 Vibe Kanban 身份与环境、Dashboard/搜索/项目/工作流/智能体、完整项目列表、完整会话列表以及底部系统区；不在常驻侧栏堆叠完整定位口号。
- 建立项目与会话轻量列表投影，服务端按真实 `(updated_at DESC, id)` 排序并支持稳定游标分页；前端连续滚动、按需加载和虚拟化，覆盖加载/空/错误状态。
- 建立独立 `PageCanvas`，支持最大 `1120px` 且水平居中的 Contained 模式、使用全部可用空间的 Full-bleed 模式，以及横向 Page Tabs 和可选 Inspector；Contained 页面的标题、工具栏和主体使用同一个顶部对齐容器。
- 建立对象与页面路由模型，统一 Product Sidebar current 状态、Page Tabs、Breadcrumb 和 URL 恢复。
- 建立 Dashboard 页面投影：`DashboardScopeStats`、`AttentionQueue`、`ActiveRuns` 和 `AgentConfigSummary` 分区独立加载；侧栏列表使用独立轻量查询。
- 将侧栏搜索与 `Ctrl/Cmd + K` 合并为唯一 `GlobalSearchPalette`：覆盖层保留背景页面，并以 Backdrop Blur 和 Scrim 模糊、压暗完整 App Shell，展示弱化分组结果，支持完整键盘操作和焦点恢复。
- 建立统一搜索投影，覆盖功能、配置、四个智能体、MCP、Skills、Commands、原生配置和业务对象；统一对象类型、匹配、高亮、权限过滤与 canonical 路由，首版只负责打开和跳转。
- 用户菜单、更新状态和移动底栏。
- Local / Remote 共用外壳 ViewModel。

### 迁移重点

- 拆解当前 `SharedAppLayout` 中导航、组织、项目排序、主机和 Hover Preview 的混合职责：产品路由与完整项目/会话轻量列表进入 `ProductSidebar`，筛选、管理操作和对象内部功能进入 `PageCanvas` 与页面容器。
- 主机健康、用户和版本进入侧栏底部系统区；更完整的主机管理进入设置。
- 页面标题、对象上下文和页面级操作由页面自己的 Header 渲染，不创建横跨所有页面的顶部产品栏。
- 将当前 Command Bar 的入口与侧栏搜索收敛到同一个 Global Search Palette；移除页面式搜索方案，不保留第二套搜索索引、结果模型或跳转逻辑。
- 移除依赖 hover 自动打开的工作区侧栏预览。

### 验收

- 所有路由都运行在同一个 Shell 中。
- 总览、项目目录、智能体中心和设置在 Product Sidebar 右侧使用最大 `1120px` 的水平居中 Contained 画幅；标题、工具栏和主体左右边界一致、从页面顶部开始，且不默认增加包住全页的大卡片。看板、Agent 工作台、Workflow 和 Arena 使用 Full-bleed；Global Search Palette 属于 App Shell Overlay，不占用页面模板。
- Product Sidebar 在任意深层页面中都保持相同分区和顺序，只允许 active/current、聚合徽标和列表内容变化。
- Product Sidebar 可连续访问当前环境中的全部项目与会话，但每行只查询 ID、名称、`updated_at`、路由和必要状态；不得加载项目树、完整会话历史、Workflow Run 详情或消息内容。
- 项目和会话严格按真实 `updated_at DESC` 排序；点击、浏览、聚焦和 current 高亮不能写入更新时间或触发置顶。
- 项目/会话列表共用中间滚动区，身份、产品入口和底部系统区保持可见。
- 对象、Page Tab、筛选和页面上下文可通过 URL、深链接与浏览器历史恢复。
- 深链接、浏览器返回、刷新和上次位置恢复正确。
- App Shell 支持跳到主内容；路由切换、浏览器返回和关闭覆盖层后的焦点位置可预测。
- 桌面和移动端不存在两套独立导航数据源。
- Dashboard 不提供“新建工作区”或其他创建按钮；顶部按项目、Issue、智能体运行展示紧凑统计，口径与 canonical 状态及当前环境时区一致。
- Dashboard 关注队列默认最多 6 条、活跃运行默认最多 5 条，各分区不提供“查看全部”，并支持分区级 Loading、Empty、Error 和 Offline。
- 智能体摘要展示连接状态、默认模型、API 地址和运行数量；整行进入详情页，配置缺省值与自定义地址标记正确，秘密字段不进入投影或 DOM。
- 侧栏搜索与 `Ctrl/Cmd + K` 打开同一个 Global Search Palette；打开后完整 App Shell 背景应用 `8px` Backdrop Blur 和 40–60% Scrim，路由、背景 active/current 状态和滚动位置不变，关闭后焦点返回触发入口。
- Global Search Palette 不持久化查询到 URL；方向键、Enter 和 Escape 行为可预测，无结果与部分数据源失败时都有恢复入口，首版不存在直接删除、停止运行或编辑配置的结果动作。

## 阶段 4：项目、看板、Issue 浮动框和执行入口

### 产出

- 建立简洁项目目录：居中标题、项目搜索、新建项目按钮和响应式封面卡片网格。
- 左侧项目列表直达具体项目看板；项目设置、编辑和归档等低频动作进入项目项上下文菜单。
- 建立单行 `ProjectKanbanToolbar`：左侧显示不可点击的项目身份，右侧只保留当前项目 Issue 搜索、canonical Issue 数量和唯一主操作“新建 Issue”；不实现项目级 Page Tabs、列表、筛选或显示按钮。
- 建立状态配置驱动的 `KanbanColumn` 和 `KanbanColumnHeader`：只投影可见状态并遵循 `sort_order`，列宽约 `300px`；列头只显示状态色标、名称、可信数量和弱化的列内新增入口。
- 建立精简 `KanbanIssueCard`：基础内容只投影 ID、最多两行 Issue 标题、优先级和最多两个标签；存在 canonical 顶层 Task 时显示总数、最多两个单行任务标题和 `+N 个任务`，不在组件或 API 重新拼接执行 subtype。
- 统一项目看板工具栏、任务卡和批量操作。
- 将 `/projects/$projectId/issues/$issueId` 实现为看板上的单一 `IssueFloatingPanel`：桌面端右侧留白浮动、不参与看板布局、无 Scrim/Blur，移动端全屏；移除“完整详情 + 快速 Inspector”双实现。
- 浮动框固定按标题、完整 Task 列表、常驻 `IssueExecutionActions`、`IssueInformationSection` 排列；三个按钮直接并列展示单 Agent、Workflow 和 Arena。最后的 Issue 信息实现为默认收起的单一折叠区，展开后在同一区域直接编辑描述、状态、标签、关系和评论，不使用 Tabs，并支持键盘与 `aria-expanded`。
- Issue Task 列表每行只投影标题、执行方式、canonical 状态和打开箭头，按固定执行方式直接链接到 Agent 工作台、Workflow 运行页或 Arena 对比页；不展示 Agent、模型、耗时、工作区或 PR，也不实现独立 Task 详情中转页。

### 验收

- 项目目录最大宽度为 `1120px`，宽屏保持居中留白；标题、搜索操作行和卡片网格共用同一条内容轴，桌面三列、中等宽度两列、移动端单列。
- 项目卡片只显示封面或视觉标识、名称、更新时间和更多菜单，不加载 Issue、工作区或 AgentRun 统计，不提供目录级筛选器和视图切换。
- 项目看板保留完整 Product Sidebar 并使用 Full-bleed Page Canvas；顶部只有一行 `ProjectKanbanToolbar`，左侧为项目图标与名称，右侧为搜索、canonical Issue 数量和唯一主操作“新建 Issue”。
- 看板是唯一视图，不渲染项目级 Page Tabs、列表、筛选、显示或工具栏更多菜单；项目切换和低频项目操作分别由左侧项目列表及其上下文菜单负责，Agent 操作和工作流启动不得进入工具栏。
- 当前项目和搜索词在适用时由 canonical URL 恢复；右侧 Issue 数量来自可信查询投影并随搜索结果更新，不由当前已渲染卡片数量推断。
- 看板列与项目状态配置一致：默认显示 Todo、In Progress、In Review 和 Done，默认隐藏的 Cancelled 不生成列；自定义可见状态按 `sort_order` 更新列与列头，不需要修改前端枚举。
- 各列使用约 `300px` 的统一宽度、稳定间距和低对比度表面；列头只包含色标、名称、当前查询下的可信数量和列内新增，不出现更多菜单。
- 将 `KanbanBoardContainer` 实现为唯一二维滚动容器：整组列横向滚动、所有列共享纵向滚动位置、列头吸顶；删除或禁止单列独立 `overflow-y` 与滚动同步逻辑，长短列差异以自然留白表达。
- 列内新增自动带入当前状态，视觉层级低于顶部主操作；图标按钮具有可访问名称、可见焦点和稳定点击区域，状态不能只通过色标区分。
- Issue 卡片默认只显示弱化 ID、最多两行 Issue 标题、一个优先级和最多两个标签；更多标签不显示。描述、负责人、Agent、运行时长、PR、关系和工作区数量只进入详情或 Inspector。
- 没有 Task 时不显示任务区；存在 Task 时显示任务总数、最多两个单行标题和 `+N 个任务`，并按待输入/待审批/失败、运行中、未开始、已完成排序。每行表示从 Issue 发起的顶层 Task，不将 AgentRun、RunAttempt 或 Workflow/Arena 内部 Agent 展开为 Task。
- 任务状态图标具有不同形状和可访问名称；点击任务行按固定执行方式直接打开 Agent 工作台、Workflow 运行页或 Arena 对比页，点击 `+N 个任务` 打开 Issue 内的完整 Task 列表，两者都不误触发 Issue 打开。
- 重构 `KanbanIssueCard` 的拖拽绑定：桌面只让卡片非交互区域参与 drag initiation，并通过统一 movement threshold 与轻点打开区分；触屏把 drag handle props 限定到常驻 `KanbanCardDragHandle`，保证至少 `44 × 44px` 命中区。Task 行、`+N`、标签、菜单及其他按钮/链接从 drag handle 中排除，拖拽结束或取消后不能补发点击。
- 保留并验证 canonical 键盘拖拽：可见焦点、lift/move/drop/cancel、合法目标反馈与可访问播报完整；拖动预览、占位和自动滚动不改变列宽、卡片静态高度或共享滚动模型。
- 卡片更多按钮在桌面 hover 或键盘 focus 时出现，在触屏设备始终可见；点击更多按钮不打开卡片，任务状态刷新和交互状态不改变卡片外部尺寸。
- 项目级查询避免每张卡片独立请求 Workflow 数据。
- Issue 浮动框使用唯一业务投影；三类执行页面各自读取所需任务与执行投影，不增加独立 Issue 页面、并行 Inspector、通用任务详情投影或页面。
- 桌面打开 Issue 时看板尺寸、列位置和滚动上下文不变，浮动框与 Page Canvas 三侧留白并使用完整圆角和阴影；背景不模糊、不压暗且未遮挡卡片仍可点击。切换 Issue 时复用外框并更新 selected 状态，关闭后焦点返回当前卡片；移动端全屏且可以明确返回看板。
- 用户打开浮动框后先看到标题与完整 Task 列表，再看到三个新执行入口；无需先滚过 Issue 记录字段。描述、状态、标签、关系与评论仍可查看和编辑，但位于执行入口之后且不抢占首要层级。
- 浮动框 Task 行只有标题、执行方式、canonical 状态与统一箭头，整行可点击且有可见键盘焦点；Agent、模型、耗时、工作区、PR 和运行统计只在打开后的执行页面出现。
- Issue 与 Task 是一对多关系。单 Agent、Workflow 和 Arena 三个执行按钮在已有 Task 运行时仍可使用，每次确认只原子创建一条带标题、不可变执行方式和唯一 binding 的新 Task，不覆盖已有 Task，也不产生“未选择执行方式”的空 Task；状态从 binding runtime 派生而不是写入 Task。
- 桌面端三个按钮横向并列，移动端纵向堆叠，任何尺寸都不折叠进下拉菜单；按钮具有完整文字标签、可见焦点、至少 `8px` 间距和不低于 `44px` 的点击区域。
- 同一 Issue 的多条 Task 可以并行运行；最终确认请求 pending 时仅当前流程的提交按钮 disabled 并显示 loading。若用户需要另一种执行方式，通过对应按钮创建新 Task，而不是修改已有 Task 的执行类型。
- 工作流 backing workspace 不重复显示为单 Agent attempt。

## 阶段 5：工作区、会话和 Agent 工作台

### 产出

- 工作区总览、搜索、分组、固定和归档。
- Product Sidebar 会话列表直接切换工作区与会话，工作区管理操作进入右侧页面。
- Full-bleed Agent 工作台：Product Sidebar 完整对象列表 + 固定对话主区 + 可折叠、可调宽 Inspector；侧栏会话和 Issue 单 Agent Task 进入同一页面。
- 精简工作台标题区：第一行任务名称，第二行可选 Issue、工作空间路径和分支；Agent、模型、状态、持续时间和停止操作移动到输入区附近的运行上下文。
- Canonical 会话时间线、运行状态栏和关注 Banner。
- 对话时间线三层基础表达：主内容始终展开、执行过程默认摘要、待处理事项就地操作；具体事件组件允许后续迭代。
- 首版用户消息靠右使用淡色容器，Agent 回复靠左使用文档式 Markdown；普通阅读列约 `760px`，消息操作和流式输出遵循可访问与稳定布局要求。
- 紧凑工具调用行及相邻工具分组：组级收起、组内单条展开、原始输入输出查看和长日志按需加载。
- `AgentInteractionEvent` 只渲染 Agent Runtime/Adapter 提供的 canonical 内容、控件、状态和动作；前端不新增审批、提问、风险判断或恢复协议。
- 固定 `SessionComposer` 使用与阅读列对齐的单层轻圆角矩形外框，内部划分偶现 `ComposerAccessoryArea`、自动增高主输入区和永久 `ComposerToolbar`；外部增加由分类菜单与结果面板组成的 `ComposerResourcePicker`；Agent、模型、推理、权限、Commands、Skills、运行反馈、发送与停止位于底部工具区并严格读取底层能力。
- Diff、文件、Git、终端、预览和日志统一进入右侧 Inspector，主区不再复制同名 Page Tabs。
- Provider 历史会话发现和接管流程。

### 关键契约

- 会话创建后不允许更换 Agent。
- Agent 操作只通过 `agent_run_id` 调用 canonical API。
- 状态投影不可用时 fail closed，不退回旧 process 状态。
- 外部会话接管只拥有接管点后的增量。
- Direct Folder、非 Git 和 Worktree 使用同一个工作台。

### 验收

- 历史加载、实时流、刷新、重连和分页后时间线一致。
- cancel、input、approval、retry、resume 的可用性与后端能力一致。
- 中间主区始终保持 canonical 对话时间线和固定输入框；切换变更、文件、Git、终端或预览时只更新右侧 Inspector，不替换主区。
- 用户消息和 Agent 正文保持清晰但克制的区别；工具过程默认提供可理解摘要并可展开原始内容，审批、输入请求和失败操作与对应事件相邻。
- 流式输出不引发布局跳动；用户阅读历史时不被强制滚回底部。不同 Provider 的关键原生事件和内容不会因统一视觉而丢失。
- 两个及以上真实相邻的工具调用形成可折叠组，任意非工具事件都会截断分组；组内事件顺序、原始输入输出和审计标识完整保留，单条工具不产生冗余分组。
- 活跃工具组追加事件时不覆盖用户的展开状态；收起摘要持续显示数量、聚合状态和当前运行项或失败原因，完整长输出只在用户展开后按需加载。
- 审批、输入请求、失败恢复和冲突只在底层提供对应 canonical 事件时渲染；按钮与控件严格匹配底层能力，提交后以真实返回状态为准，已处理事件保留为可追溯的紧凑记录。
- 顶部关注 Banner 与时间线交互组件共享同一个 canonical 事件，Banner 只负责提示和定位；新事件不强制滚动或抢走用户焦点。
- 输入区不嵌套第二层卡片，focus 不改变尺寸，自动增高达到上限后内部滚动；Commands、Skills、模型、推理、运行中发送和停止严格匹配当前 Agent Adapter/canonical 能力。
- `ComposerAccessoryArea` 只在存在会话产物、待提交上下文、权限配置、Command/Skill 参数、Agent UI 或排队内容时出现；空状态不占高度，临时内容有退出路径且不会无限挤压对话区。
- `ComposerToolbar` 保持单行左右分组：左侧为添加、只读 Agent 和底层支持的输入配置，右侧为运行反馈、停止和固定最右的发送；能力不存在时不造控件，暂不可用时显示禁用原因。
- 窄宽度下先折叠低频 Agent 配置，再缩短 Commands/Skills；工具栏不换行、不横向滚动，添加、主要运行操作和发送始终可用且可见。
- 中央输入使用原生多行文本能力，默认约 3–4 行，Composer 约 `140–170px`；达到 `min(320px, 35vh)` 后内部滚动但不限制、截断或改写输入内容。
- `ComposerResourcePicker` 在桌面端以底边对齐的分类菜单与结果面板浮在 Composer 外部，移动端切换为带返回动作的单面板；`＋` 打开完整分类，`@`、`/`、`$` 与工具栏入口正确预选分类，MCP 不进入逐条消息分类。
- 资源选择器支持点击和完整键盘路径，不依赖 hover；切换分类保持尺寸稳定，结果独立滚动，边界空间不足时正确翻转或降高；选择只准备内容而不立即执行，`Escape` 关闭后正文保持不变。
- 普通文本和代码粘贴保持原文，图片或文件进入偶现附件区，任何自动转附件都需要用户主动确认。
- 草稿按 canonical 会话隔离，切换页面或异常刷新后恢复；canonical API 确认接收后才清空，失败保留且重连不会重复发送已确认消息。
- 发送按钮只表达底层当前提供的发送、追加或 canonical 入队语义；不接受消息时禁用并保留草稿，底层没有队列能力时前端不建立发送队列。
- 提交快照与用户后续草稿相互隔离，canonical 回执幂等处理；成功只移除对应快照，失败恢复完整内容并提供就近重试。
- 发送固定最右、停止位于其左且互不替代；停止直接调用 canonical cancel，仅 canonical `cancelled` 视为成功，失败可重试且不清空草稿、附件、会话或自行处理队列。
- Agent 运行、发送与停止均无前端假超时，等待期间持续展示 canonical 状态，不能由 UI 猜测结果。
- `Enter`、`Shift + Enter` 和输入法组合行为正确；固定输入区不遮挡最后一条消息，移动端虚拟键盘打开后仍可输入并使用主要操作。
- 工作台标题不出现 Agent、模型、状态、持续时间、停止或更多操作；无 Issue 时不保留空位，长路径可查看完整值并复制。
- Inspector 支持调宽并恢复上次标签与宽度；收起时向右侧完全退出、内容宽度归零且对话区使用释放空间，页面边缘保留不占布局宽度的可访问打开把手。
- Inspector 的展开与收起正确转移键盘焦点并尊重减少动态效果设置；隐藏面板不取消 Agent、终端、预览服务或清空面板状态。在窄屏和移动端有可发现的替代入口，能力不可用时显示原因而不是静默隐藏。
- 切换会话时，Product Sidebar 结构和 `updated_at DESC` 排序不变，当前会话只更新 current 高亮；主区和 Inspector 按 canonical 路由状态恢复。
- 长时间运行的 Agent 不受前端 timeout 或持续时长限制。

## 阶段 6：Workflow 和 Arena

### 产出

- Workflow 模板列表、编辑器和运行页。
- Workflow 模块使用 Page Tabs 和页内控件覆盖模板、运行记录与定时任务。
- 统一 Node、Node Type、Task、Agent 和 Edge 业务语言；Node Type 只作为 Node 属性，Issue 发起的顶层 Task 与 Agent/Arena Node 运行时 materialize 的子 Task 复用同一种 canonical Task 模型，编辑期只维护 TaskSpec。
- 保留 `Start`、`End`、`Agent`、`Condition`、`Human Gate`、`Transform` 和 `Arena` 七种 Node Type；产品文案不将任一 Type 与 Node 组合成新对象名称。
- `Arena` 类型严格使用 `1 Node → 1 Task → N Agent candidates`；候选执行、会话和结果保留在该 Task 内部，不进入 Issue 或 Workflow 的同级 Task 列表。
- 实现最多三层的 `WorkflowNodeCard`：Meta row 以小号淡色显示 Type 和可选“待配置”，Title row 只显示 canonical title，Executor row 仅对承载 Task 的 Node 显示单 Agent 名称或 Arena 候选数量。不得重复 Task summary，也不展示模型、Skills、耗时、工作区路径或 Session。
- 普通 Node 卡片使用约 `220–240px` 固定桌面宽度和内容自适应高度，不实现 resize 或尺寸持久化；标题最多两行，hover 与 keyboard focus 共享完整标题提示。Start / End 使用紧凑系统变体，不保留普通卡片空行。
- Node Type 共用 neutral surface；Type 仅由 Meta row 的弱化文字或小图标区分。实现 hover border、selected brand ring + 轻阴影和 pending warning-subtle border + 文字；pending 与 selected 可组合，状态不能互相覆盖或只靠颜色表达。
- 运行视图在 Node Meta row 右侧投影 canonical status icon/dot + text；仅 Running 小状态点使用低幅度 pulse，其他状态静止。Status border 保持低强度、surface 保持 neutral、selection ring 独立；编辑视图只显示 pending，减少动态效果模式禁用 pulse。
- 从“添加 Node”打开 Node Type 选择入口，点击已有可配置 Node 或 Edge 打开同一个靠右浮动的 Workflow Canvas 配置 Dialog；不设置常驻节点库或右侧 Node Inspector。
- Node Type Picker 支持页面“添加 Node”和 connection-drop 两种上下文并共用 catalog；选择前取消不创建 Node。Standalone 选定 Type 后创建 Node，connection-drop 则在一个 command 中原子创建 Node 与来源 Edge；两者都插入画布、自动选中并打开配置 Dialog。
- Picker 使用同一个 anchored popover，纵向渲染 Agent、Condition、Human Gate、Transform、Arena 五项，每项为小图标、名称和单行说明；不实现搜索、分类、Tabs、大 Modal 或 Start / End 选项。方向键、Enter、Escape 与关闭焦点返回在两种锚定上下文中保持一致。
- 以直接连线作为主建图交互：Node hover / selected / keyboard focus 显示扩大命中但不改变布局的 handle；拖到合法 Node 创建 Edge，拖到空白锚定 Picker 并保持临时线，非法目标显示原因并回弹且不修改 Draft。提供键盘等价连接路径。
- 建立由 Node Type capability 与 authoring data 派生的 semantic handles：Start、Agent、Transform 为 Default，Arena 为 Winner，Human Gate 按 `required_action` 显示 Approve / Reject，Condition 每条 branch 对齐一个命名 handle 并提供弱化“新增分支”，End 无输出。创建或重连 command 从来源 handle 原子写入 Edge semantic 与 branch identity；取消“新增分支”连接不留下空 branch。
- 允许一个 semantic handle 连接多个不同目标，并在该语义激活时并行调度全部目标；不增加 Fork Node Type。从已有 handle 开始拖动始终创建独立 Edge，从既有 Edge endpoint 拖动才重连该 Edge。每条 Edge 使用稳定 ID 和独立 selection / delete / history patch，操作单条 Edge 不影响同 handle 其他连接。
- 实现自动平滑曲线 Edge 与 target 端小箭头，不将直角折线作为默认路径。同一 handle 的多条 Edge 自然 fan-out，但分别保留完整 hit area、focus、hover、selection 与 reconnect endpoints；idle 使用低强调 token，hover / selected 只突出当前 Edge并轻微弱化其他路径，不建立公共交互主干。Node layer 始终高于 Edge layer；首版不做或持久化手动路径，也不提供路径重置命令。
- 实现渐进式 Edge semantic label：Default 不渲染常驻文字；Approve、Reject、Winner 和 Condition branch 在 source handle 附近显示紧凑淡色标签。Hover / focus / selected 时增强当前标签并提供完整可访问文本，不在线条中段放置大块标签。
- 建立 `idle | active | traversed | not-taken` Edge 运行投影：编辑态始终静止，active 仅使用低幅度定向 stroke，traversed 保留低强调高亮，Condition 未命中路径进一步弱化。Failed、Waiting、Completed 继续由 Node 投影；Edge 不重复状态 Badge，减少动态效果模式使用等价静态 active token。
- 拖动 Edge source / target 端点直接重连；拖普通 Node 到高亮 Edge 插入命中区时原子拆边，第一段继承原路由、source handle、route 与 Condition branch，第二段 Default 并继承 target handle。移除“插入 Agent Step / 插入 Node”右键命令。
- 新增和编辑复用同一 Dialog，Type 永久只读，不实现跨 Type 的隐式配置或 Edge 迁移；字段变化立即写入内存中的 Workflow Draft，选择其他 Node 直接切换配置。
- 配置不完整的新 Node 显示“待配置”；关闭配置框保留 Node 和修改，只有显式删除才移除。页面顶部“保存 Workflow”统一校验并持久化完整 Workflow 和 Edge，存在待配置或无效 Node 时阻止保存并定位错误。
- Workflow Canvas 配置 Dialog 桌面端宽约 `400–480px`，距 Page Canvas 顶部、右侧和底部 `16–24px`，使用四边完整圆角和浮层阴影；它覆盖画布但不参与页面布局，不能压缩、平移或缩放画布，也不能实现成贴边 Drawer。
- 共享 Dialog 使用非模态交互，不渲染 Scrim、Backdrop Blur 或全屏 Pointer Overlay，不使用 `aria-modal` 或 Focus Trap；未被配置框遮挡的画布继续支持平移、缩放、拖动和选择 Node / Edge。
- Node 与 Edge 复用稳定的 `WorkflowCanvasConfigDialog` 外框，分别由独立 Node Form 与 Edge Form 提供业务内容；切换 selection 时不关闭或重开外框，也不叠加 Edge Modal。
- Node / Edge 或两个对象之间使用可中断的 `120–160ms` Header / Body Crossfade；外框 width、height、top 和 right 不参与动画，快速连续选择只渲染最后对象，减少动态效果模式直接替换。
- 在本次编辑会话中按 Node / Edge ID 保存 Body 滚动位置，新对象从顶部开始；画布选择不抢焦点，超过 `300ms` 的异步内容仅在对应分区显示 Skeleton。
- 复用画布已有的 canonical drag threshold 区分空白单击与空白平移：空白单击清除 selection 并关闭配置框，空白平移保留 selection 和配置框；不能在 `pointerdown` 提前清除，也不能由 Dialog 另设阈值。
- 共享 Dialog 使用固定 Header 和可滚动的单列 Body，不设置内部 Tabs 或“取消 / 应用”操作 Footer；Node Form 的 Node、Task、Agent 和 Type 专属分区按适用性渲染，Edge Form 独立维护自身内容。
- Edge Form Header 显示“来源 Node → 目标 Node”；Body 只保留路由语义、只读连接摘要和底部危险区，不渲染来源/目标下拉框、Edge ID、handles 或路径数据。重连通过画布端点完成，曲线路径根据 Node 位置自动派生，不提供手动调整。
- Edge 路由类型只读投影来源 semantic handle：普通来源为 Default，Condition 为对应 Condition Branch，Arena 为 Winner，Human Gate 为实际连接的 Approve 或 Reject。Edge Form 不显示路由选择控件；改变语义需要在画布从正确来源 handle 重连。
- Condition 表达式继续存储并编辑在来源 Condition Node 的 branches 中；Edge Form 只读投影摘要并提供“打开来源 Node”，点击后在同一共享外框内切换为 Node Form，不能复制条件状态。
- Edge Form 删除按钮与画布 Delete 键复用同一 Draft command：执行前捕获完整 Edge 快照，随后立即移除 Edge、清除 selection、关闭配置框并将焦点留在画布，不弹确认 Dialog。
- 删除后显示不抢焦点的短时 Toast，使用来源 → 目标摘要并提供撤销；撤销以原 ID、handles、路由类型和 route 数据恢复同一 Edge，路径根据当前 Node 位置重新派生。删除和撤销都只改变 Workflow Draft，仍由页面级保存统一持久化。
- 普通 Node 删除按钮、画布 Delete 键和上下文菜单复用同一 Draft command，不弹确认 Dialog；命令捕获 scoped inverse patch 后，原子移除 Node、完整 Task 配置、位置、全部关联 Edge 和同步变化的 Condition branches，并清除 selection、关闭配置框、保留画布焦点。
- Node 删除 Toast 显示 canonical 标题和关联 Edge 数量；撤销恢复相同 Node / Edge ID 及受影响图片段，但不能通过恢复整份旧 Graph 覆盖删除后产生的无关 Draft 编辑。Start / End 在所有删除路径中保持不可删除。
- 为 Dirty Workflow Draft 增加编辑器路由 blocker：编辑器内部 selection、配置框和画布操作不提示；离开编辑器、切换 Workflow 或进入非编辑页面时暂存原目标并显示独立模态确认 Dialog。
- 离开确认提供“继续编辑 / 不保存 / 保存并离开”。继续编辑取消导航；不保存恢复最后持久化 Graph 后继续；保存并离开复用 canonical save command，校验或请求失败时留在原页、保持 Dirty 并定位错误。刷新和关闭标签页只使用 Dirty `beforeunload` 原生提示，不在 unload 中依赖异步保存。
- 页面顶部保存捕获不可变 Graph snapshot、单调递增 Draft revision 与数据库 `expected_revision`；请求期间只禁用重复保存提交，画布、selection 与配置表单继续可编辑并产生更高 Draft revision。
- 保存协调器分别维护 current Draft revision、persisted baseline 和 server revision。成功只确认请求对应 Draft revision并更新 server revision：current 未变化时转为 Clean，已有更新时仍为 Dirty；数据库冲突进入 Conflict 并保留本地 Draft，由用户显式重新加载/协调，失败保持 Draft 并显示就地重试。响应不能用旧 Graph 覆盖当前 Draft，也不能重置 viewport、selection、配置框、焦点或 Body 滚动位置。
- 建立唯一的会话级 `WorkflowCommandHistory`，覆盖 Node / Edge 创建、删除、移动、连接、重连、路由和配置修改；删除 Toast、顶部按钮和键盘共享同一 undo / redo，不维护平行逆操作。
- 以用户意图合并 history transaction：一次 pointer drag 或 reconnect 只入栈一次，文本字段从聚焦初值到离开终值合并为一个配置 command；文本聚焦期间使用原生 undo，非文本上下文才路由 Workflow 快捷键。Undo 后新 command 清空 Redo，提交新 command 时关闭旧删除 Toast。
- 顶部只增加低强调 Undo / Redo 图标、Tooltip 和真实 disabled 状态，不实现历史面板。History 不持久化，保存只更新 baseline 不清空历史；Undo / Redo 重新计算 Dirty 并产生新 revision。
- 扩展 selection controller 为互斥的单 Node、单 Edge 和普通 Node 多选状态。`Shift + click` 切换成员，`Shift + blank drag` marquee 只收集普通 Node；普通空白拖动仍平移，Start / End 与 Edge 不加入多选。
- 多选时关闭共享配置框并在画布顶部显示只含可信数量和删除的 `WorkflowMultiSelectionBar`；无修饰键点击 Node 或点击 Edge 收敛为单选，普通空白单击与 Escape 清除多选。第一版不实现批量配置、对齐或平均分布。
- 整组移动保持相对位置并在 drag end 形成一个 history command；批量删除以一个 scoped command 移除选中 Node、关联 Edge 和 Condition branches，只显示一条汇总 Toast，并能一次完整撤销。
- 实现单 Node `DuplicateNodeCommand`：复制 Type、Task、Agent 与 authoring config，清除 Session、run / execution identity、结果和 Condition branches，不复制入边或出边；Skills 不属于 Node authoring data。使用固定新 ID、右下偏移和 overlap avoidance，提交后单选副本并打开 Node Form。
- 上下文菜单和画布作用域 `Ctrl/Cmd + D` 共用 duplicate command；Start / End、Edge、多选和文本 / 表单焦点不触发。Undo 移除副本，Redo 以同一 ID、位置和数据恢复；新 Node validation 从复制结果重新计算。
- Start 和 End 由 Workflow 自动创建且各自唯一，不进入 Node Type Picker，不允许新增、删除、复制、改名或打开配置 Dialog；Start 禁止入边，End 禁止出边。
- 承载 Task 的 Node 只编辑和投影 `Task.title`，不保存独立 Node 名称；不承载 Task 的 Node 才使用自身名称。
- `Type: Agent` 要求一个有效 Agent；模型、推理、权限和原生参数默认继承智能体中心配置，只持久化显式 Node override，并支持清除 override。
- Agent Node Form 只提供 Task 标题、Agent、继承配置摘要与可选 Node override；不渲染 Skills 列表、数量、开关或选择器，也不管理 MCP / Commands。Skills 由智能体中心与具体会话的 canonical 能力提供，会话中的使用或变化不写回 Workflow Draft。
- Condition Node Form 只实现 Node 名称、`single | multi` 路由控件和自然语言 branch 列表；目标摘要从 canonical Edge 只读派生，不实现目标下拉框、表达式语言或 `Else`。表单新增 branch 可暂时待连接并派生 semantic handle，页面保存校验空条件与无目标；画布“新增分支”入口继续以一个 command 原子创建 branch + Edge，取消不产生空 branch。
- Human Gate Node Form 只实现 Node 名称、`prompt_to_human` 和 `approve | approve_or_reject`；Action 变化派生 Approve/Reject semantic handles，目标只通过画布连线或重连。首版不实现自由文本回答 UI，避免产生无法进入 canonical runtime output 的前端状态。实现可撤销的 `ChangeHumanGateActionCommand`：降级为 `approve` 时原子移除全部 Reject Edge，以一条汇总 Toast 提供撤销。
- Transform Node Form 实现 Node 名称、`template | regex_extract | truncate` mode control 和仅当前 mode 对应的 template / regex / max_chars 字段；增加默认折叠的 `TransformTestArea`，复用 runtime 转换语义显示临时输出或就地错误，测试状态不得写入 Draft、history 或运行快照。
- Arena Node Form 复用 `Task.title` 并实现至少两个 `ArenaCandidateRow`；收起态只显示 Agent identity 与继承配置摘要，展开态显示 Agent override 和可选候选 prompt override。Skills、MCP、Commands、winner 与当前固定 promote/apply 策略不渲染；少于两个候选保留 pending Draft 并阻止页面级保存。
- Edge 操作和承载 Task 的 Node 的 canonical Session / AgentRun 入口。
- Workflow 运行页改为唯一 `WorkflowRunCanvas`，删除并列 Canvas/Dashboard Tabs；Header 只显示名称、canonical 状态、完成进度和 capability-driven cancel。
- 实现只在 waiting input、waiting approval 或 failure 时出现的右侧 `WorkflowRunAttentionCard`，覆盖但不压缩画布；点击 Node 打开同位置的非模态 `WorkflowRunNodeDetailsDialog`，两者互斥。详情按 Type/状态展示 canonical 输出、等待与错误，技术事件折叠；Human Gate waiting state 原位提交 capability-driven Approve/Reject 并处理 pending、防重复与就地失败重试，Agent waiting input/approval 只深链完整会话，Arena 深链候选结果。
- Arena 创建与并行候选沿用 canonical runtime；对比页实现 2–3 个 `ArenaCandidateResultColumn`，只投影 Agent、状态、结果摘要、Diff、测试、完整会话入口和获胜选择，不并排渲染对话 timeline。超过三项或列宽不足时使用可键盘切换的 `ArenaCandidateSelector` 与固定摘要，不实现无限横向滚动。
- `SynthesizeArenaDialog` 调用 canonical synthesize runtime 创建显式 `purpose: synthesis` candidate 与工作区，立即加入同一候选 projection，并复用状态、错误、重试、摘要、Diff、测试和会话入口。扩展 Workflow winner view/API 校验与应用路径，使成功的 `attempt | synthesis` 都可被选择和应用；名称不参与 purpose 推断，综合结果不自动 promoted、不覆盖原候选，winner mutation 期间阻止并发重复提交。
- 增加共享 `ArenaWinnerConfirmDialog`，统一现有 `WorkflowArenaWinnerPanel` 的单击直接 mutation 与普通 Arena promote 的确认流程。点击 winner control 只建立确认快照，投影候选 identity、changed-file/line summary、将归档的 sibling 数量和当前 route capability 对应的后续影响；Workflow 场景确认后才应用 Diff、标记 winner 并继续运行。取消不提交且焦点返回触发按钮，确认期间锁定全部 winner 入口，失败保留 Dialog 和重试，成功等待 canonical projection 后关闭。
- 用 `ArenaStopAllControl`、`ArenaLifecycleMenu` 替换现有 Header 中含糊的 close/dissolve 按钮。Stop All 从候选 projection 读取可取消 AgentRun，至少一项可取消时才显示，并通过 agent-run canonical cancel 逐项取消、汇总 pending/失败和重试结果；不能复用只修改 lifecycle 的 `close_arena_group`。更多菜单只放“关闭本轮”和“解散并归档”：前者沿用 close 并保留工作区与结果，后者沿用 dissolve、二次确认归档与删除影响。路由卸载不发送任何 stop/close/dissolve mutation。

### 验收

- Node hover / selected / focus 时连接点清晰可发现且命中区域足够；拖到现有 Node 立即创建 Edge，拖到空白只打开临时 Picker，选择后原子创建 Node + Edge，取消不产生 Node、Edge 或 history command。
- Start / Agent / Transform、Human Gate、Condition、Arena 和 End 分别投影正确的 Default、Approve/Reject、branch、新增分支、Winner 或无输出状态；从特定 handle 连接后 Edge semantic 无需二次选择，标签与命中区支持鼠标、触摸和键盘且不只靠颜色表达。
- 同一 semantic handle 可以连续连接多个不同目标；运行时按同一语义并行触发全部目标。从 handle 新增 Edge 与从 endpoint 重连 Edge 的手势不会混淆，单条 Edge 的删除和 Undo 不改变同 handle 的其他连接。
- Edge 以自动平滑独立曲线和 target 箭头正确表达方向；同源多线不会退化为生硬直角线或共享不可单选主干。Node 始终覆盖在线条上方，画布不出现控制点或路径编辑命令；hover、focus、selected 能稳定定位单条 Edge，并在复杂图中降低其他连线干扰。
- Default Edge 在 idle 状态没有重复标签，特殊语义在来源侧可辨认；Approve/Reject/Winner/Condition branch 的 hover、focus、selected 状态能显示完整文本且不会遮挡线条中段或相邻 Node。
- 编辑器不会播放闲置 Edge 动效；运行页只在 active Edge 上显示轻微方向流动，traversed 与 not-taken 层级正确。Failed/Waiting 等信息不在线上重复，`prefers-reduced-motion` 下当前路径仍能通过静态非运动反馈辨认。
- 非法连接、重连或拆边显示具体原因并回弹，Draft 不出现瞬时脏数据；键盘用户能完成等价连接。画布不存在“插入 Agent Step / 插入 Node”右键入口。
- 普通 Node drop 到高亮 Edge 后形成两段连接，原语义与 Condition branch 保存在第一段、第二段为 Default；Undo 恢复原 Edge ID、handles、route、branch target 与 Node 位置，Redo 使用稳定新 IDs。
- 画布中不存在 Agent Step、执行块或步骤等 Node 同义对象；Agent 只作为 Task 执行者出现。
- Node 卡片信息不超过 Type/待配置、唯一标题和可选执行者三层；承载 Task 时标题只来自 `Task.title`，Arena 不展开候选列表，不适用类型不保留空第三行，配置和运行细节不会泄漏进卡片。
- 普通 Node 宽度稳定在 `220–240px` 且不可手动拉伸，两层/三层高度自然变化；长标题最多两行并能通过 hover/focus 获取全文，Start / End 紧凑且不产生无意义空白。
- 不同 Node Type 不出现七种整卡底色；hover、selected、pending 的层级清晰且不改变卡片尺寸，pending + selected 同时可辨认，键盘 focus 与选中状态均具有可见反馈。
- 运行页 Node 状态来自 canonical projection，并以图标/状态点和文字共同表达；Running 之外没有持续动画，整卡不闪动，selected 与状态边框均可辨认。编辑页不混入旧运行状态，减少动态效果下 Running 仍静态可读。
- Node Type Picker 在选择 Type 前取消不会改变 Workflow Draft；选定任一非系统 Type 后，具有稳定默认值的新 Node 立即出现在画布、自动选中并打开配置 Dialog。
- 从“添加 Node”按钮和 connection-drop 落点打开的 Picker 使用同一五项纵向列表；没有搜索/分类/Tabs/Start/End，图标、名称、说明与 active option 可读，方向键/Enter/Escape 和焦点返回正确。
- 未完成必要配置的新 Node 同时在画布和 Dialog 中显示“待配置”；关闭 Dialog 或选择其他 Node 后仍保留，只有显式删除才移除，页面级保存会被其阻止并定位到对应 Node。
- Node Form 根据 Node Type 展示内容；共享 Dialog 打开和关闭都不改变画布尺寸与位置，也不能把焦点强制拉回已经不再选中的最初触发 Node。
- Workflow Canvas 配置 Dialog 在桌面端保持 `400–480px` 宽和 `16–24px` 上/右/下间距，四边圆角完整可见，视觉和动效都不能退化为贴边 Drawer。
- Workflow Canvas 配置 Dialog 打开期间，画布没有遮罩或模糊；用户可以用鼠标和键盘在配置框与未遮挡画布之间移动焦点并操作画布，配置框表面的点击不能穿透到底层 Node。
- 从 Node A 切换到 Node B、从 Node 切换到 Edge 或反向切换时，共享外框的位置、宽高、圆角和阴影不变；只替换独立表单内容，不能出现两个配置浮层或整框反复滑入。
- Edge Form 的 Header 和连接摘要显示同一来源 → 目标关系；常规表单不存在来源/目标下拉框、Edge ID、handles 或路径数据，用户可以在画布通过端点完成重连，但不能手动编辑自动曲线路径。
- Edge Form 对所有来源都只读展示由 semantic handle 确定的路由类型，不提供五种全量选择或 Human Gate 二次选择；从画布改用另一来源 handle 重连后，摘要随 canonical Edge 数据更新。
- Condition Edge 的条件摘要与来源 Condition Node branch 始终来自同一数据；点击“打开来源 Node”切换到 Node Form，Edge Form 不能产生第二份可编辑条件。
- 点击 Edge Form 删除或在画布按 Delete 都会立即从 Workflow Draft 移除 Edge、关闭配置框并清除 selection，不出现确认层；Toast 不抢焦点且能用完整快照撤销，恢复后页面 Dirty 状态正确更新。
- 从 Node Form、画布键盘或上下文菜单删除普通 Node 的结果一致：立即移除 Node 和关联图数据、关闭配置框并显示包含 Edge 数量的可撤销 Toast；撤销恢复相同 ID、Task 配置、位置、Edge 和 Condition branches，且不会回滚其后的无关编辑。
- Start / End 的按钮、键盘和上下文菜单删除路径全部不可用，不能通过绕过 Node Form 破坏系统 Node 约束。
- Clean Draft 离开不提示；Dirty Draft 切换 Node / Edge、关闭配置框或操作画布也不提示，只有越过编辑器路由边界时才出现一次离开确认且保留原目标。
- “继续编辑”和 Escape 都取消导航并恢复可预测焦点；“不保存”从最后持久化 Graph 离开；“保存并离开”只有在页面级校验和请求成功后导航，失败时定位错误且不会丢失 Draft。
- Dirty 状态正确控制原生 `beforeunload` 的注册与移除；浏览器关闭路径不使用自定义 Dialog、不依赖异步保存，也不会在 Clean 时误报。
- 保存 revision N 期间仍可把 Draft 编辑到 N+1；N 成功后 persisted baseline 正确推进到 N，当前 Draft 仍为 Dirty，且旧响应不会覆盖 N+1 或误显示 Clean。没有后续编辑时成功才显示已保存。
- 保存进行中只阻止重复请求，画布和配置表单保持交互；成功与失败均不改变 viewport、selection、Dialog 可见性、字段焦点和对象滚动位置，失败状态就地提供重试并通过 polite live region 宣告。
- Node drag、Edge reconnect 和一次字段聚焦编辑分别只产生一个 history command；画布或非文本控件使用平台 Undo / Redo 快捷键，文本输入保留原生文字撤销，顶部按钮与快捷键结果一致。
- 删除 Toast 的撤销与 history stack top 相同；Toast 后提交新 command 会关闭旧 Toast。Undo 后编辑会清除 Redo；保存后历史仍可撤销，并根据与 persisted baseline 的关系正确切换 Dirty / Clean。
- 重新进入 Workflow 编辑器时不恢复上次内存 history；revision-aware 保存响应不会清空当前 history 或覆盖 Undo / Redo 后生成的更高 revision。
- 普通空白 drag 继续平移，Shift + blank drag 才框选，二者使用同一 canonical threshold；Shift 点击可增减普通 Node，Edge、Start 和 End 不会误入多选。
- Node 多选会关闭单对象配置框并显示轻量 toolbar；组移动只生成一个 command，批量删除只生成一个 command 和一条 Toast，Undo 一次恢复全部关联图数据。
- 点击单个 Node / Edge、普通空白单击和 Escape 都按定义收敛或清除 selection；多选期间不存在隐藏的批量配置表单或未确认的对齐/分布操作。
- 复制普通 Node 后只选中新副本并打开其 Node Form；副本标题正确追加本地化后缀、不会覆盖来源位置，运行身份和 Edge 均未复制，Condition branches 清空且 pending / validation 正确派生。
- Agent Node Form 中不存在 Skills 区域或 Tool Manager 入口；大量 Skills 不会撑长 Dialog，会话内 Skill 变化不改变 Node 数据、Dirty revision 或后续无关 Workflow 编辑。
- Condition Node Form 的 single/multi、自然语言条件和连接摘要始终投影同一 Graph 数据；表单不能改目标，重连后摘要自动更新。待连接 branch 会阻止页面保存，从画布取消新增连接不会残留 branch 或 history command。
- Human Gate Node Form 只能选择仅批准或批准/拒绝，画布 handles 与当前选择同步；不存在目标下拉框或无法持久化的自由文本回答控件。已有 Reject Edge 时降级为“仅批准”会立即移除全部 Reject Edge，只产生一个 history command 和一条带数量的 Toast；一次撤销恢复原 Action、handle 与全部原 ID Edge。
- Transform Node Form 始终只显示当前 mode 所需字段；Template、Regex Extract 和 Truncate 的测试输出与 runtime 规则一致，无效正则、无匹配和无效 max_chars 就地可见。测试输入、结果与展开状态不会改变 Dirty revision，切换 Node 后也不会覆盖其他 Node 的临时测试状态。
- Arena Node Form 的卡片与 Header 只读取同一个 Task.title；两个以上候选可添加、删除和独立展开，自定义配置与候选指令只影响对应 candidate。少于两个候选阻止保存，候选展开状态不产生 Dirty，编辑器不出现 Skills 或获胜者选择器。
- Workflow 运行路由首次进入即显示完整画布，没有总览/画布/节点会话/事件 Tabs 或 Dashboard 切换；Header 的状态、进度和取消能力均来自 canonical run projection。
- 没有关注事项时画布使用全部空间；出现 waiting/approval/failure 时右侧关注卡不改变 viewport，点击事项定位对应 Node。状态解除后卡片消失且不留下侧栏；技术事件只从二级运行详情访问。
- 点击任一运行 Node 不立即跳页，而是在右侧留白位置打开无 Tabs 的详情 Dialog；画布仍可操作且 viewport 不变。关注卡到详情只发生一次互斥内容替换，关闭详情保留 selection；Human Gate 可直接按 canonical Action 批准或拒绝，提交时不能重复触发且失败可原位恢复，Agent/Arena 的二级动作进入正确 canonical 页面。
- Start / End、Edge、多选和文本输入上下文不能触发 duplicate；上下文菜单与快捷键产生相同 command，Undo / Redo 始终操作同一副本 ID 且页面 Dirty 状态正确。
- 快速连续选择时过期 Crossfade 被中断且最终内容始终对应最后 selected 对象；切回对象恢复其本次编辑会话滚动位置，首次选中从顶部开始。
- 画布选择不会自动把焦点移进表单；局部分区加载不导致 Header、外框或已就绪内容闪烁，动效遵守 `prefers-reduced-motion`。
- 未超过 canonical drag threshold 的空白单击会清除 selection 并关闭配置框；超过阈值的空白拖动只平移画布，当前 Node / Edge selection 和配置框保持不变，轻微手抖不会触发两套冲突判定。
- 点击 Start 或 End 只更新选中和定位状态，并关闭此前打开的配置框；键盘删除、复制和上下文菜单不能绕过系统 Node 约束。删除当前 Node / Edge 后配置框关闭，且不自动选择相邻对象。
- 编辑已有 Node 时 Type 字段只读；字段变化立即更新 Workflow Draft，选择其他 Node 或关闭 Dialog 都不丢失修改，顶部 Dirty 状态同步可见。
- 不适用的 Dialog 分区不占位；字段 blur 后错误就地显示但不阻止切换 Node，页面级保存必须阻止无效 Workflow 持久化并定位第一个无效 Node 和字段。
- 键盘用户可以在固定 Header、滚动 Body 和画布之间顺序移动，不依赖已经移除的 Footer 操作完成编辑。
- 画布、Dialog Header、运行记录和会话对承载 Task 的 Node 使用同一 canonical `Task.title`；测试禁止两个标题发生漂移。
- 运行中 Agent 配置只读，修改只进入下一次运行；历史 Task、Session 和 AgentRun 继续使用各自配置快照。
- 模板编辑与运行观察共享视觉语言，但运行态才使用持续动效。
- Workflow/Arena 内嵌会话继续使用 canonical AgentRun UI。
- Arena 在可用宽度内稳定显示两个或三个结果列；超过三个候选或不足以保持两个可读列时自动切换为候选选择区与固定摘要，当前候选和 winner state 不丢失。页面无无限横向滚动，方向键、可见焦点和屏幕阅读器名称可访问；完整对话只从会话入口进入 canonical AgentRun UI。
- 启动综合后，新 synthesis 候选以自己的 canonical running/failed/completed 状态加入现有集合，原始候选保持不变；成功的综合结果与成功的原始结果均可成为唯一 winner。Workflow 选择 synthesis 后能应用其 Diff 并继续下游 Node，不出现 UI 可选但服务端拒绝，或 UI 可查看却无法采用的状态。
- 原始或综合候选的“选择为获胜方案”都先打开同一个紧凑确认 Dialog；未确认时无 mutation。Dialog 准确显示候选、变更文件数、其他候选归档数量和实际后续影响，不复制完整 Diff；Workflow CTA 为“应用并继续”。取消/Escape 的焦点返回、提交期间全局防重复、失败原位重试和 canonical 成功关闭均可测试，普通 Arena 与 Workflow 入口不存在确认行为漂移。
- 仅有可取消 AgentRun 时 Header 显示“停止全部”；触发后每个可取消运行都收到 canonical cancel，UI 能区分全部成功和部分失败并允许重试，Arena lifecycle 不被伪装成停止状态。完成后按钮随 projection 消失，不保留空位。
- 更多菜单只包含“关闭本轮”和“解散并归档”。关闭本轮保留全部结果和工作区且不会取消运行；解散并归档必须二次确认并准确报告归档/删除结果。直接离开 Arena 页面不会停止候选、关闭本轮或删除 Arena。

## 阶段 7：智能体中心与设置

### 产出

- Provider 清单、健康状态、版本和能力矩阵。
- 智能体中心与设置各自使用横向 Page Tabs 和页内分组，Product Sidebar 的分区与完整对象列表保持不变。
- MCP、Skills、Commands 的发现、增删改、启停和作用范围。
- 原生配置字段安全视图、typed Diff/Apply 和配置档案；不提供整文件原文编辑。
- 跨 Provider 复制工具和配置的预览流程。
- 通用设置：外观、仓库、主机、Relay、组织、远程项目和数据。

### 验收

- Codex、Claude Code、Gemini 和 Oh My Pi 各自使用 adapter 描述能力。
- UI 不伪装不支持的 Provider 功能。
- 工具开关明确本机 Provider、项目和会话作用范围。
- 跨 Provider 复制先显示可复制、不支持和转换后的目标 Diff。
- 原生文件以安全元信息和 Adapter 管理字段呈现，修改统一进入 typed Settings Diff/Apply；绝对路径、原文和未知值不进入浏览器，修改前后审计语义不丢失。

## 阶段 8：辅助页面、状态与响应式

### 产出

- Onboarding、登录、Export、VS Code、Crash、404 和 Sunset 页面。
- 所有 Dialog、Sheet、Popover、Toast 和系统提示。
- 全页面 Loading、Empty、Error、Offline、Permission、Degraded 状态。
- 375、768、1024 和 1440 宽度验证。
- 中文、英文和现有 locale 的布局验证。

### 验收

- 移动端虚拟键盘不遮挡 Agent 输入和审批操作。
- 没有只依赖 hover 的关键操作。
- 移动端底部导航与桌面产品入口使用同一份路由清单；项目/会话 Drawer 或全屏选择页复用桌面列表的数据源、排序和 current 状态。
- 200% 缩放仍可以完成主要任务。
- 长中文、英文、路径、分支名和 Provider 错误不会破坏布局。

## 阶段 9：删除旧实现

### 删除目标

- 旧 AppBar / Navbar 组合和 hover sidebar preview。
- 已经替代的旧页面组件、样式和 Tailwind token。
- `.new-design` 与其他历史主题作用域；最终只保留一个设计系统入口。
- 无调用的旧 Dialog、重复组件和过渡 adapter。
- 新页面中为旧 UI 保留的临时兼容分支。
- 旧 Issue-shaped Task model、`workspaces.task_id`、通过 Workspace/Workflow/Arena UNION 伪造 Task 的查询、名称推断 Arena purpose、重复 Task status 和任何 Local/Remote 双写 Task runtime。

### 验收

- 通过 `rg` 确认没有页面继续引用旧 Token 和废弃组件。
- Bundle 不同时打包完整的新旧页面体系。
- Local 和 Remote 不存在视觉结构分叉。
- 删除前后核心流程测试结果一致。

## 测试策略

### 单元与组件测试

- Fresh 与 upgrade migration 最终 schema 等价、Task binding cardinality、事务回滚、孤立/重复检测、Arena candidate purpose/winner 约束和 Workflow expected-revision 冲突。
- TaskSummary 的 execution-kind 状态/open-target 派生、顶层/子 Task 过滤、稳定游标分页和 Local/Remote Host capability。
- Token 与组件状态组合。
- 页面 ViewModel、Dashboard 三维统计与分区投影、智能体安全配置摘要和 action policy。
- Global Search Palette 的对象规范化、权限过滤、匹配、高亮、临时状态、焦点恢复和过期请求取消。
- 产品路由映射、侧栏 current 状态、Page Tabs、深链接与返回状态恢复。
- AgentRun 时间线、关注状态和控制入口。
- Workflow 节点、边、运行投影。
- 响应式和 capability gating 的纯函数。

### Playwright 核心链路

1. 首次启动并进入本地目录。
2. 在 Dashboard、项目、工作流和智能体之间切换，验证 Product Sidebar 分区稳定且 active 状态唯一；点击搜索时背景 active/current 状态保持不变。
3. 在 Dashboard 核对项目/Issue/智能体运行统计，处理审批、输入和失败项，检查智能体连接状态、默认模型、API 地址与运行数量，并验证无创建按钮、分区级加载/错误、稳定排序、无“查看全部”以及返回后的滚动恢复。
4. 分别通过侧栏和 `Ctrl/Cmd + K` 打开 Global Search Palette，验证整个 App Shell 背景同时模糊、压暗，再搜索功能、配置、四个智能体、工具和业务对象，使用键盘打开结果，并验证 Escape 关闭、焦点恢复、无独立路由与无风险动作。
5. 打开项目目录，验证 `1120px` 画幅相对 Page Canvas 水平居中、顶部对齐，标题/搜索操作行/网格左右边界一致，并验证三/二/一列响应式网格、简单卡片内容、项目搜索、新建入口和卡片跳转。
6. 通过左侧项目列表打开项目，验证直接进入看板且右侧顶部只有一行：不可点击的项目身份、当前项目 Issue 搜索、可信 Issue 数量和唯一主操作“新建 Issue”；确认没有项目级 Page Tabs、列表、筛选、显示、项目切换、Agent 或工作流操作。验证搜索只影响当前项目并可在刷新及浏览器前进/后退后恢复，数量随搜索结果更新；验证看板只按可见状态和 `sort_order` 生成约 `300px` 等宽列，列头只有色标、名称、可信数量与可访问的列内新增，列内新增自动带入当前状态。制造不同长度的列，确认整组列横向滚动、全部列共享一条纵向滚动、列头吸顶且没有单列滚动条；鼠标滚轮、触控板与键盘滚动不被嵌套容器截获。再通过会话列表验证相同的对象切换原则。
7. 核对无 Task、一个 Task 和三个以上 Task 的 Issue 卡片：基础内容只显示 ID、两行内 Issue 标题、优先级和最多两个标签；任务区最多显示两个按关注顺序排列的单行标题和 `+N 个任务`。桌面分别轻点和拖动非交互区域，确认移动阈值正确；触屏确认只有至少 `44 × 44px` 的专用把手启动拖拽，卡片仍可正常滚动。验证 Task 行、完整任务入口、标签与更多按钮只执行自身动作，不误拖、不误开 Issue；再用键盘完成移动与取消并检查可见/可访问反馈。确认 Agent、运行时长、描述、负责人、PR、关系和工作区数量没有进入卡片。
8. 验证侧栏可连续访问全部项目和会话、严格按真实 `updated_at DESC` 排序；点击和浏览不改序，当前对象保持高亮。
9. 从看板打开 Issue，验证桌面端只出现右侧留白浮动框，看板不缩放、不位移且背景无模糊/压暗；点击另一 Issue 时外框稳定切换内容，关闭后焦点回到当前卡片。确认内容严格按标题、Task 列表、单智能体 / Workflow / Arena 三个入口、默认收起的 Issue 信息排列；展开后可在同一区域编辑描述、状态、标签、关系和评论，不出现 Tabs，键盘和 `aria-expanded` 状态正确。Task 行只出现标题、执行方式、状态和箭头，整行可打开正确执行页面。移动端使用可返回看板的全屏详情，三个入口纵向堆叠且不折叠。分别进入并取消三个配置流程，确认不会提前生成空任务。
10. 通过“单智能体”完成一次配置，确认同一事务只创建一条带标题和固定执行方式的顶层 Task、唯一 Session binding、工作区与会话；在该 Task 运行中再次使用三个按钮创建其他 Task，确认已有 Task 不被覆盖且多条 Task 可以并行。注入事务中途失败并确认不存在空 Task 或孤立记录。
11. 发送消息、观察运行、处理输入或审批、取消和重试。
12. 查看文件、Diff、Git、终端和预览。
13. 通过“Workflow”创建、编辑并运行 Workflow Task，确认 Agent/Arena Node 运行时产生正确父子 Task，其他 Node 不产生 Task；用两个页面同时保存验证数据库 revision 冲突不丢 Draft。
14. 通过“Arena”创建 Arena Task、比较候选并选择结果；改名候选 Workspace 后 attempt/synthesis 分类保持不变，综合候选可成为合法 winner 且 Issue Task 数仍为一。
15. 发现 Provider、启停工具并跨 Provider 复制。
16. 刷新、断线重连和历史恢复。

### 视觉回归

每个页面模板至少保存以下基线：

- Dark 1440px。
- Light 1440px。
- Dark 1024px。
- System 分别解析为 Dark 与 Light 的首屏基线。
- Mobile 375px。
- Empty、Error、关注状态，以及品牌 selected/focus 与 Running/Waiting/Error 的组合状态。

动态时间、随机 ID、流式光标和运行时长必须在视觉测试中稳定化。

### 仓库质量门

按照仓库规范运行：

```bash
pnpm run format
pnpm run check
pnpm run lint
cargo test --workspace
pnpm run generate-types:check
pnpm run prepare-db
```

数据库/SQLx owner 变化时必须执行 `pnpm run prepare-db`、目标 migration fixture 和 backend checks；仅修改前端时仍要至少执行受影响包的 TypeScript、ESLint、Vitest 和 Playwright 检查。发布验证继续使用 GitHub Actions 和官方 npm registry，不在本机制作 release 包。

## 性能要求

- 按路由和大型 Feature 拆包，Workflow、Arena、编辑器和终端不进入首次总览 bundle。
- 看板卡片不挂载完整 Workflow 画布或完整会话。
- 长会话、日志、文件树和大型列表使用虚拟化或增量加载。
- Product Sidebar 分别订阅产品路由、聚合徽标、项目轻量列表与会话轻量列表；分区级 memo 和独立查询避免流式事件重渲染整个侧栏。
- 项目、会话和顶层 Task 列表由服务端按 `(updated_at DESC, id)` 稳定游标分页，前端增量加载并虚拟化；超过 50 行时不同时挂载全部 DOM 节点。
- 列表投影只返回 ID、名称、`updated_at`、路由和必要状态；会话消息、Diff、文件树和完整运行时间线不得进入 App Shell 查询。
- 流式事件更新避免重渲染整个 App Shell。
- Inspector 隐藏时不持续渲染不可见的大型组件。
- 页面切换保留必要缓存，但不把所有工作区常驻内存。

## 提交建议

提交按可评审边界组织，而不是一次产生不可审查的大提交：

```text
docs(frontend): define redesign architecture and page matrix
refactor(db): establish canonical task and execution bindings
feat(ui): add redesign tokens and primitives
feat(web): replace shared application shell
feat(projects): redesign projects and issue surfaces
feat(workspaces): add agent workbench layout
feat(workflow): redesign editor and runtime views
feat(agents): redesign provider and tool management
feat(web): complete responsive and accessibility states
refactor(ui): remove legacy frontend system
```

## 风险与控制

| 风险                                | 控制方式                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| 页面多，重构过程长期不可用          | 每阶段保持分支可启动，并用页面矩阵跟踪完成度                                                     |
| View 重写时复制业务逻辑             | 先提取共享 ViewModel 和 action policy，再换组件                                                  |
| Local / Remote 再次分叉             | 共享 View，环境差异只进入 route/container/capability                                             |
| Agent 状态退回旧日志推断            | 审查所有新 UI 数据源，canonical projection fail closed                                           |
| 新旧设计系统长期共存                | 最终阶段设为合并前阻断项，未删除旧入口不算完成                                                   |
| 大量 UI 改动造成回归                | Playwright 核心链路 + 视觉基线 + 分阶段提交                                                      |
| 移动端最后补导致重写                | 每个页面模板从第一阶段同时验证 375/768/1024/1440                                                 |
| 视觉好看但信息效率下降              | 采用数据密集模板，关键任务以时间和点击数验收                                                     |
| 完整侧栏退化成无限对象树            | 只允许扁平轻量列表；组件测试禁止嵌套、消息历史与完整对象载荷                                     |
| 长列表挤走系统入口                  | 身份、产品入口和系统区固定，中间对象区独立滚动并虚拟化；覆盖 768px 与 900px 高度视觉测试         |
| 点击对象污染最近更新排序            | `updated_at` 只由真实领域更新写入；路由、浏览和 current 状态使用纯客户端状态，增加排序契约测试   |
| Task 仍只是三套执行对象的外观 UNION | 先落 canonical Task + subtype bindings；TaskSummary 只有一个 Rust owner，禁止页面自行分支        |
| 一次性迁移丢失或重复测试数据        | fresh/upgrade fixture、事务备份、外键/唯一 binding/orphan 检查；发现无法判定的数据直接失败并诊断 |
| Task 状态和 runtime 状态漂移        | Task 表不存 status；按不可变 execution kind 从唯一 binding 派生                                  |
| Workflow 多页面保存互相覆盖         | 数据库 revision + `expected_revision` 条件更新，客户端 Draft revision 继续防旧响应覆盖           |
| Arena synthesis 继续依赖名称        | 显式 candidate purpose 与稳定 winner candidate ID，重命名回归测试                                |
| Local 与 Remote 成为双写 owner      | Local Host 唯一执行 writer；Remote 使用 host-bound API，离线明确失败                             |

## 最终 Definition of Done

- [ ] 页面矩阵没有“未迁移”项。
- [ ] canonical Task、Session/Workflow/Arena/Node bindings、Workflow database revision 和显式 Arena candidates 已落库；每个 Task ID 唯一解析标题、执行方式、状态和打开目标，Issue 只列顶层 Task。
- [ ] 当前测试数据库和全新数据库迁移到同一最终 schema，旧 Issue-shaped Task、`workspaces.task_id`、Task subtype UNION、名称推断和双读/双写路径全部删除。
- [ ] Agent/Workflow/Arena 创建与失败回滚、Workflow 父子 Task、Arena 单 Task 多候选、expected-revision 冲突和 `(updated_at DESC, id)` 分页均有自动化覆盖。
- [ ] 产品名称保持 `Vibe Kanban`，Dashboard、项目、Agent、Workflow、Arena 与工具管理共同体现“多智能体开发控制台”定位，工作页面不重复宣传性副标题。
- [ ] Local、Remote、System、Dark、Light、桌面和移动端全部使用新系统；首次启动默认 System，三种模式的解析、持久化和系统变化行为正确。
- [ ] 品牌橙只承担产品身份、唯一主操作和 selected/focus；所有运行状态使用独立语义色、文字或图标，品牌表面前景对比度和组合状态通过验证。
- [ ] 所有 Agent 操作符合 canonical runtime contract。
- [ ] 所有核心路径具有 Playwright 覆盖。
- [ ] 所有页面模板具有视觉回归基线。
- [ ] 键盘、焦点、对比度和减少动画通过。
- [ ] Product Sidebar 始终保持身份、五项产品入口、按 `updated_at DESC` 排列的完整项目/会话列表和底部系统区；点击对象只更新 Page Canvas。
- [ ] 旧 App Shell、旧 Token 和废弃组件删除。
- [ ] `format`、`check`、`lint`、Rust 测试和生成类型检查通过。
- [ ] GitHub Actions 构建发布版本，并从官方 npm registry 完成安装验证。
