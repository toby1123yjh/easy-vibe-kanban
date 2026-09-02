---
title: '前端重构全页面覆盖矩阵'
description: '列出 Vibe Kanban Local Web、Remote Web、核心业务页面、弹窗与状态页面的重构范围。'
---

## “所有页面”的定义

全量重构不仅包含可直接访问的路由，还包括：

- 全局 App Shell、导航、Global Search Palette 和通知入口。
- 页面内 Inspector、Drawer、Panel、Popover 和 Dialog。
- Onboarding、空状态、加载、错误、离线和权限状态。
- Local Web、Remote Web、Tauri 桌面壳和移动响应式。
- 工作区内的对话、文件、Diff、Git、终端和预览。
- Workflow 和 Arena 的编辑态、运行态和异常态。
- Codex、Claude Code、Gemini、Oh My Pi 的 Provider、工具和原生配置管理。

页面矩阵是完成范围的唯一清单。实现过程中发现新页面时，必须先补充本矩阵。

## 页面模板图例

| 模板       | 用途                                        | 默认画布模式                            |
| ---------- | ------------------------------------------- | --------------------------------------- |
| Dashboard  | 总览、运行关注队列和智能体配置摘要          | Contained                               |
| Collection | 列表、看板、目录、筛选和批量操作            | 目录使用 Contained；看板使用 Full-bleed |
| Detail     | 任务、对象详情和关联资源                    | Contained；复杂详情可展开为 Full-bleed  |
| Workbench  | Agent 会话、文件、Diff、终端和预览          | Full-bleed                              |
| Canvas     | Workflow 编辑和运行画布                     | Full-bleed                              |
| Comparison | Arena 候选横向对比                          | Full-bleed                              |
| Settings   | 智能体中心、工具管理和应用配置              | Contained                               |
| Onboarding | 首次启动、登录和环境检查                    | Contained                               |
| Utility    | 导出、通知、错误、嵌入式 VS Code 等辅助页面 | 按内容选择，默认 Contained              |

`Contained` 在 Product Sidebar 右侧的 Page Canvas 内使用最大 `1120px` 的水平居中画幅，标题、工具栏和主体共用左右边界并从页面顶部开始；`Full-bleed` 使用侧栏之外的全部可用空间。两者共享同一个 App Shell，不是两套页面外壳。

## 全局与入口

| 当前页面 / 入口                | 目标页面                     | 模板       | Local | Remote | 必须覆盖                                                                                                                                                             |
| ------------------------------ | ---------------------------- | ---------- | :---: | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_app` / Remote Root Shell    | 统一 App Shell               | —          |   ✓   |   ✓    | Product Sidebar、Page Canvas、移动导航、Global Search Palette                                                                                                        |
| Product Identity Contract      | 多智能体开发控制台定位       | —          |   ✓   |   ✓    | 保留 `Vibe Kanban` 名称；项目、Agent、Workflow、Arena 与工具管理均为核心能力；侧栏只显示紧凑身份和环境，完整定位文案仅在 Onboarding/About 等适用语境出现             |
| 当前 AppBar / Navbar / Sidebar | 分区式 Product Sidebar       | —          |   ✓   |   ✓    | 身份与环境、四项 routed 产品入口、一个搜索触发器、完整项目列表、完整会话列表、底部系统区                                                                             |
| 新增                           | Sidebar Project List         | —          |   ✓   |   ✓    | 当前环境全部项目、`updated_at DESC`、current 高亮、增量加载/虚拟化、加载/空/错误                                                                                     |
| 新增                           | Sidebar Session List         | —          |   ✓   |   ✓    | 当前环境全部会话、`updated_at DESC`、current 高亮、运行状态、增量加载/虚拟化、加载/空/错误                                                                           |
| 新增                           | Page Canvas Content Contract | —          |   ✓   |   ✓    | 点击项目或会话后只更新右侧内容；对象内部使用 Page Tabs、页内分类和 Inspector，不新增纵向导航列                                                                       |
| 新增                           | 总览 Dashboard Scope Stats   | Dashboard  |   ✓   |   ✓    | 项目全部/活跃/需关注、Issue 待办/进行中/今日完成、智能体运行为需处理/运行中；紧凑分组、无创建按钮                                                                    |
| 新增                           | 总览 Attention Queue         | Dashboard  |   ✓   |   ✓    | 等待审批、等待输入、失败与阻塞，默认 6 条、稳定排序和直接动作；左侧只保留徽标，不提供“查看全部”                                                                      |
| 新增                           | 总览 Active Runs             | Dashboard  |   ✓   |   ✓    | 运行状态、Provider、持续时间、当前工作区、溢出折叠                                                                                                                   |
| 新增                           | 总览 Agent Config Summary    | Dashboard  |   ✓   |   ✓    | 连接状态、默认模型、API 地址、运行数量、整行进入详情；不编辑配置，不展示秘密字段                                                                                     |
| 当前项目与会话入口             | Product Sidebar 完整列表投影 | —          |   ✓   |   ✓    | 仅加载 ID、名称、`updated_at`、路由和必要状态；点击、浏览不写更新时间，不展开对象树或管理操作                                                                        |
| 当前主机 / 用户 / 版本入口     | Sidebar System Zone          | —          |   ✓   |   ✓    | 主机健康、设置、用户、版本和更新状态，固定在底部                                                                                                                     |
| Design System Contract         | 品牌与语义色职责             | —          |   ✓   |   ✓    | 橙色只用于产品身份、唯一主操作和 selected/focus；运行、等待、成功、失败、取消等使用独立语义色与文字/图标；两层状态可同时辨认，品牌表面前景满足对比度                 |
| `/`                            | 启动路由与恢复上次位置       | Utility    |   ✓   |   ✓    | 首次启动、已登录、未登录、无项目                                                                                                                                     |
| `/dashboard`                   | 总览                         | Dashboard  |   ✓   |   ✓    | 无创建按钮、项目/Issue/智能体运行统计、关注队列、活跃运行、智能体配置摘要、分区级错误与离线状态；不展示最近访问、环境健康或“查看全部”，不使用装饰性 KPI 卡片         |
| 侧栏搜索 / `Ctrl/Cmd + K`      | Global Search Palette        | Utility    |   ✓   |   ✓    | 唯一弹框实例、完整 App Shell 背景模糊并压暗、无独立路由或 active 状态；功能、配置、四个智能体、工具和业务对象分组结果；只打开 canonical 路由，支持完整键盘与焦点恢复 |
| `/notifications`               | 通知与关注事项               | Collection |   ✓   |   ✓    | 未读、筛选、跳转、批量已读、空状态                                                                                                                                   |
| Release Notes                  | 版本更新页或轻量 Dialog      | Utility    |   ✓   |   ✓    | 新版本、已读、离线                                                                                                                                                   |

## Onboarding 与账户

| 当前页面 / 入口       | 目标页面                 | 模板       | 状态与要求                                |
| --------------------- | ------------------------ | ---------- | ----------------------------------------- |
| `/onboarding`         | 本机环境发现与首次工作区 | Onboarding | Provider 已发现、未安装、未登录、扫描失败 |
| `/onboarding/sign-in` | 登录与 Cloud 说明        | Onboarding | 登录、取消、本地继续、OAuth 失败          |
| OAuth Dialog          | 账户连接                 | Onboarding | Provider 选择、浏览器返回、超时、错误     |
| User Popover          | 账户与组织入口           | Utility    | 本地用户、Cloud 用户、组织切换、退出      |
| Update Ready          | 应用更新提示             | Utility    | 可重启、下载中、失败、稍后处理            |

## 项目与任务

| 当前页面 / 路由族                      | 目标页面                                    | 模板                    | 状态与要求                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/projects`                            | 项目目录                                    | Collection / Contained  | 标题、项目搜索、新建项目、三列封面卡片；卡片仅显示名称、更新时间和更多菜单，不提供统计、筛选器或视图切换；加载、空、错误、响应式                                                                                                                                                                                    |
| `/projects/$projectId`                 | 项目看板                                    | Collection / Full-bleed | 左侧具体项目直达看板；顶部单行展示项目身份、当前项目 Issue 搜索、canonical Issue 数量和新建 Issue；加载、无权限、同步错误                                                                                                                                                                                           |
| Project Navigation                     | Product Sidebar 项目列表 + 项目项上下文菜单 | Collection              | 左侧切换项目并直达看板；编辑、设置、归档等低频项目操作进入项目项上下文菜单；右侧不提供项目级 Page Tabs                                                                                                                                                                                                              |
| `LocalProjectKanban` / `ProjectKanban` | 共享项目看板                                | Collection / Full-bleed | Local/Remote 只替换能力，不复制视觉结构；看板是唯一视图，不提供列表、筛选或显示按钮；搜索词可通过 URL 恢复；Issue 数量随当前搜索结果更新；按可见状态和 `sort_order` 生成约 `300px` 等宽列，列头为色标、名称、可信数量和弱化列内新增，不提供更多菜单；整组列横向滚动、所有列共享纵向滚动且列头吸顶，单列无独立滚动条 |
| Kanban Issue Card                      | 精简 Issue 卡片                             | Collection              | 弱化 ID、最多两行 Issue 标题、优先级和最多两个标签；有 Task 时显示总数、最多两个按关注顺序排列的单行任务标题和 `+N 个任务`；不显示 Agent、运行时长或执行统计；桌面从非交互区域拖动，触屏只用 `44 × 44px` 专用把手，内部控件不启动拖拽，并提供键盘移动/取消路径                                                      |
| `/projects/$projectId/issues/$issueId` | 看板内 Issue 浮动框                         | Detail / Overlay        | 仍显示项目看板，不建立独立详情页；桌面端右侧留白浮动、不压缩看板、无 Scrim/Blur，点击其他 Issue 直接切换内容；移动端全屏。内容按标题、Task 列表、三个执行入口、默认收起的单一 Issue 信息区排列                                                                                                                      |
| Kanban Issue Panel                     | `IssueFloatingPanel`                        | Detail / Overlay        | 作为上述路由唯一详情容器，不再并列维护“完整详情”和“快速 Inspector”两套界面                                                                                                                                                                                                                                          |
| Issue Information                      | `IssueInformationSection`                   | Disclosure              | 默认收起；展开后在同一区域直接查看和编辑描述、状态、标签、关系与评论；无内部 Tabs，支持键盘与 `aria-expanded`                                                                                                                                                                                                       |
| Kanban Filter Dialog                   | 移除                                        | —                       | 新项目看板不提供筛选入口，只保留当前项目 Issue 搜索                                                                                                                                                                                                                                                                 |
| Bulk Action Bar                        | 看板批量操作                                | Collection              | 多选、跨列移动、归档、取消                                                                                                                                                                                                                                                                                          |
| Tag Manager / Edit                     | 标签管理                                    | Settings                | 创建、编辑、删除、颜色、被引用状态                                                                                                                                                                                                                                                                                  |
| Project Sidebar                        | 项目上下文 Inspector                        | Detail                  | 仓库默认值、活动、工作区、项目设置                                                                                                                                                                                                                                                                                  |
| Project Sunset                         | 项目不可用状态                              | Utility                 | 删除、失效、无权限、返回可用项目                                                                                                                                                                                                                                                                                    |

## Task 执行入口

| 当前页面 / 入口         | 目标页面           | 模板      | 状态与要求                                                                                                                                                                                                                   |
| ----------------------- | ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task Canonical Contract | 所有 Task 投影     | Data      | Task 是数据库一等实体；顶层/子 Task 使用同一模型，执行方式不可变，状态和打开目标从唯一 binding 派生；禁止前端/API UNION Workspace、WorkflowAttempt、ArenaGroup 或维护重复 status                                             |
| Issue Tasks             | Issue 执行区域     | Detail    | 一个 Issue 对应多条独立 Task；每行只显示标题、单 Agent/Workflow/Arena 执行方式、状态和打开箭头，不显示 Agent、模型、耗时、工作区或 PR；整行直接进入对应 Agent 工作台、Workflow 运行页或 Arena 对比页，不经过 Task 详情中转页 |
| Issue Execution Actions | 创建 Task          | Detail    | 单智能体、Workflow、Arena 三个直接可见的同级按钮，各自进入对应配置；确认事务原子创建 Task 与唯一 binding，取消/失败不产生空 Task；已有运行不阻止再次执行                                                                     |
| Workspace Create Draft  | 创建工作区流程     | Workbench | 仓库、目录、分支、Direct Folder、Worktree                                                                                                                                                                                    |
| Executor Config Dialog  | 创建会话步骤       | Workbench | Provider 能力、模型、推理、权限、Skills                                                                                                                                                                                      |
| Workspace Target Dialog | 工作位置选择       | Workbench | Git / 非 Git、本机 / 远程、校验错误                                                                                                                                                                                          |
| Create from PR          | 从 PR 创建工作区   | Workbench | PR 加载、目标分支、冲突、权限                                                                                                                                                                                                |
| Review / PR Dialogs     | Git 与 Review 操作 | Utility   | 创建 PR、关联 PR、Review、失败恢复                                                                                                                                                                                           |

## 工作区与 Agent 工作台

| 当前页面 / 路由族                        | 目标页面                                | 模板       | 状态与要求                                                                                  |
| ---------------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `/workspaces`                            | 工作区总览                              | Collection | 本机/远程筛选、活动状态、空状态                                                             |
| `/workspaces?view=sessions`              | 会话管理页                              | Collection | 搜索、状态/Provider/项目筛选、分页、归档和空状态；不作为侧栏列表的另一份“完整入口”          |
| `/hosts/$hostId/workspaces`              | 指定主机工作区                          | Collection | 主机在线、离线、配对失效                                                                    |
| `/workspaces/$workspaceId`               | Agent 工作台                            | Workbench  | 左侧会话或 Issue 单 Agent Task 进入同一页面；中间固定对话，右侧为可折叠 Inspector           |
| `/hosts/$hostId/workspaces/$workspaceId` | 远程 Agent 工作台                       | Workbench  | 保持相同三栏结构，并处理网络延迟、断线重连和能力差异                                        |
| Workspace Navigation                     | Product Sidebar 会话列表 + Agent 工作台 | Workbench  | 左侧切换会话；主区不提供重复的对话/变更/文件/终端 Page Tabs                                 |
| Agent Workbench Header                   | 页面自有工作台标题区                    | Workbench  | 第一行任务名称；第二行可选 Issue、工作空间路径和分支；长路径中间截断、完整值与复制          |
| Composer Accessory Area                  | 输入框顶部的偶现扩展区域                | Workbench  | 会话产物、待提交上下文、权限配置、Command/Skill 参数、Agent UI 和排队内容；无内容时不占位   |
| Composer Resource Picker                 | 输入框外部的级联资源选择器              | Workbench  | 桌面双栏、移动单栏；四类资源、快捷预选、键盘路径、边界翻转、独立滚动和管理页跳转            |
| Workspace Context                        | Inspector 技术上下文                    | Workbench  | Direct Folder/Worktree、主机和其他技术信息，不重复标题区已有路径与分支                      |
| Session Resume Picker                    | Provider 会话发现与接管                 | Workbench  | 来源、目录匹配、只读历史、接管点                                                            |
| Conversation List                        | 固定主区的 canonical 会话时间线         | Workbench  | 历史加载、流式更新、重连和分页；辅助面板切换不能替换主区                                    |
| Session Composer                         | 单层矩形固定输入区                      | Workbench  | 纯文本、草稿、粘贴、级联资源选择，以及底层驱动的发送、追加、canonical 排队、停止和失败恢复  |
| Agent Interaction Event                  | Agent 原生交互事件视觉容器              | Workbench  | 底层提供的审批、输入、失败恢复与冲突；待处理、处理中、已处理、失效、只读和能力不可用        |
| Changes Panel                            | Diff Inspector                          | Workbench  | 未改动、加载、二进制文件、大 Diff                                                           |
| File Tree / Preview                      | 文件 Inspector                          | Workbench  | 文本、Markdown、图片、不支持格式                                                            |
| Git Panel                                | Git Inspector                           | Workbench  | clean、dirty、conflict、detached HEAD                                                       |
| Terminal Panel                           | 终端 Inspector                          | Workbench  | 启动、断线、完成、多终端                                                                    |
| Preview Browser                          | 预览 Inspector                          | Workbench  | 端口启动、加载失败、导航、刷新                                                              |
| Workbench Inspector                      | 统一右侧辅助面板                        | Workbench  | 变更、文件、Git、终端和预览标签；向右完全收起、边缘重新打开、调宽、状态恢复和能力不可用原因 |
| Logs / Processes                         | 技术详情 Inspector                      | Workbench  | AgentRun 与脚本进程明确分组                                                                 |
| Workspace Notes                          | 工作区笔记                              | Workbench  | 查看、编辑、空状态、保存失败                                                                |
| Rename / Delete Workspace                | 工作区管理 Dialog                       | Utility    | Direct Folder 不误删外部目录                                                                |
| VS Code Routes                           | 嵌入式 VS Code 工作区                   | Utility    | 本机、远程、加载失败、返回工作台                                                            |

## Workflow

| 当前页面 / 路由族                | 目标页面                      | 模板                      | 状态与要求                                                                                                                                                                                 |
| -------------------------------- | ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/projects/$projectId/workflows` | 工作流模板列表                | Collection                | 搜索、空状态、最近运行、草稿                                                                                                                                                               |
| Workflow Navigation              | Workflow Page Tabs 与页内控件 | Canvas                    | 模板、运行记录、定时任务、当前编辑对象；不增加纵向菜单列                                                                                                                                   |
| `/workflows/$workflowId/edit`    | 工作流编辑器                  | Canvas                    | 本地草稿、已保存、Dirty、校验错误                                                                                                                                                          |
| Workflow Node Type Picker        | Node Type 选择入口            | Anchored Popover          | 按按钮或连线落点锚定；Agent/Condition/Human Gate/Transform/Arena 五项纵排，图标+名称+单行说明；无搜索/分类/Tabs/Start/End，支持键盘，取消不改 Draft                                        |
| Workflow Draft Node              | 画布中的新建 Node             | Canvas                    | 选定 Type 后立即出现；配置不完整时显示“待配置”，关闭配置框保留，只有显式删除才移除，未完成时阻止页面级保存                                                                                 |
| Workflow Node Card               | Node 紧凑摘要                 | Canvas                    | 普通卡固定宽 `220–240px`、两/三层自适应高度、标题最多两行且 hover/focus 可读全文；无 resize，Start/End 使用紧凑系统变体                                                                    |
| Workflow Node Visual State       | 卡片交互与校验状态            | Canvas                    | 全 Type 中性表面；弱化 Type，hover 增强边框，selected 品牌描边+轻阴影，待配置使用淡警示边框+文字且可与 selected 共存                                                                       |
| Workflow Node Runtime State      | Node 运行状态                 | Canvas                    | 运行页 Meta row 显示 icon/dot+文字；仅 Running 状态点轻微 pulse，其他状态静止，边框低强度着色、表面中性、selected 独立；编辑页仅待配置                                                     |
| Workflow Connection Gesture      | 直接连线建图                  | Canvas                    | Handle 拖到现有 Node 创建 Edge，拖到空白打开 Type Picker；合法目标高亮、非法回弹、键盘等价路径和原子 history command                                                                       |
| Workflow Semantic Handles        | 语义化多出口连接点            | Canvas                    | 普通/Start 为 Default，Human Gate 为 Approve/Reject，Condition 按 branch 对齐并提供弱化新增入口，Arena 为 Winner，End 无输出；连接点决定 Edge semantic，同一语义可连接多个并行目标         |
| Workflow Edge Visual             | 连线视觉与聚焦                | Canvas                    | 自动平滑独立曲线、目标端箭头、同源自然散开；Node 位于 Edge 上层，无手动路径编辑或路径重置；hover/selected 单线突出，不合并公共主干                                                         |
| Workflow Edge Semantic Label     | 特殊路由标签                  | Canvas                    | Default 无常驻标签；Approve/Reject/Winner/Condition branch 在来源侧淡色显示，hover/selected 增强完整语义，不占线条中段                                                                     |
| Workflow Edge Runtime State      | 运行路径反馈                  | Canvas                    | 编辑态静止；active 轻微定向流动、traversed 低强调高亮、Condition 未命中弱化；Node 承担失败/等待状态，减少动态效果使用静态替代                                                              |
| Workflow Edge Insertion Target   | 拖 Node 拆分 Edge             | Canvas                    | Edge 扩大 drop 命中区；第一段继承原路由与条件、第二段 Default，取消/非法不改 Draft，Undo 恢复原 Edge                                                                                       |
| Workflow Canvas Config Dialog    | Node / Edge 共享浮动外框      | Non-modal Floating Dialog | 外框位置与宽高稳定；Node / Edge 独立表单在内部 Crossfade，快速选择可中断；无 Scrim / Blur / Focus Trap，画布保持可操作                                                                     |
| Workflow Canvas Selection        | 画布选择与空白手势            | Canvas                    | 复用 canonical drag threshold；空白单击清除 selection 并关闭配置框，空白平移保留 selection 和配置框                                                                                        |
| Workflow Node Config Form        | Node 配置内容                 | Dialog Content            | 字段即时写入 Draft、直接切换 Node、无操作 Footer；普通 Node 删除立即改 Draft，Toast 原子撤销 Node、Task、位置、关联 Edge 和 Condition 分支；Start/End 禁止删除                             |
| Workflow Agent Node Form         | Agent Node 配置               | Dialog Content            | Task 标题、Agent、继承配置摘要与可选覆盖；不显示 Skills 列表/数量/开关，也不管理 MCP/Commands，会话 Skill 变化不写回 Draft                                                                 |
| Workflow Condition Node Form     | Condition Node 配置           | Dialog Content            | Node 名称、single/multi 与自然语言分支；目标只读投影画布连线，无目标下拉框或 Else；表单可新增待连接分支，画布入口原子创建 branch + Edge                                                    |
| Workflow Human Gate Node Form    | Human Gate Node 配置          | Dialog Content            | Node 名称、用户提示、仅批准/批准或拒绝；目标只由画布连线维护，首版无自由文本回答；降级为仅批准时原子移除 Reject Edge，一条 Toast 可撤销                                                    |
| Workflow Transform Node Form     | Transform Node 配置           | Dialog Content            | Node 名称、Template/Regex/Truncate 与单一模式字段；测试转换按需展开，临时输入/结果/错误不进入 Draft 或 history                                                                             |
| Workflow Arena Node Form         | Arena Node 配置               | Dialog Content            | 一个 Task、至少两个紧凑候选 Agent；候选配置覆盖/专属指令按行展开，无 Skills 或预设 winner，少于两个阻止页面保存                                                                            |
| Workflow Node Session Entry      | Node 会话入口                 | Canvas                    | 从承载 Task 的 Node 进入 canonical Session 与 AgentRun                                                                                                                                     |
| Workflow Edge Config Form        | Edge 配置内容                 | Dialog Content            | Header 显示来源 → 目标；来源/目标和连接点确定的路由语义只读，重连与改语义留在画布；Condition 只投影来源 Node 条件；底部删除立即改 Draft、关闭配置框并提供完整快照撤销                      |
| Workflow Unsaved Changes Dialog  | Dirty Draft 离开保护          | Modal                     | 离开编辑器或切换 Workflow 时提供继续编辑、不保存、保存并离开；保存失败留在原页，浏览器关闭使用原生 beforeunload                                                                            |
| Workflow Save Control            | 页面级保存与状态              | Canvas Header             | 捕获不可变 Draft revision 并提交数据库 `expected_revision`；保存期间继续编辑，旧响应不覆盖新 Draft，多页面冲突明确返回并保留本地 Draft；Clean/Dirty/Saving/Conflict/Failed、重试和状态宣告 |
| Workflow History Controls        | 会话级撤销与重做              | Canvas Header             | Node/Edge 结构与配置共用 command history；拖动/字段编辑合并、文本原生 undo、保存不清空、无历史面板                                                                                         |
| Workflow Multi-selection Bar     | Node 多选临时操作             | Canvas Overlay            | Shift 点击/框选普通 Node；关闭单对象配置框、整组移动、汇总删除与一次撤销；Edge/Start/End 不加入，不做批量配置                                                                              |
| Workflow Duplicate Node          | 单 Node 结构复制              | Canvas Command            | 保留 authoring 配置、清运行身份和 Condition branches、不复制 Edge；偏移放置、自动选中、同 ID 重做；Start/End/多选禁用                                                                      |
| Validation Panel                 | 验证结果                      | Canvas                    | error、warning、定位节点、全部通过                                                                                                                                                         |
| Run Workflow Dialog              | 运行确认                      | Canvas                    | 输入、仓库、分支、能力检查                                                                                                                                                                 |
| `/workflow-runs/$runId`          | 工作流单画布运行页            | Canvas                    | 顶部名称/状态/进度/取消；无总览、画布、节点会话、事件 Tabs                                                                                                                                 |
| Workflow Run Attention Card      | 等待与失败关注事项            | Canvas Overlay            | 仅 canonical waiting/approval/failure 时靠右浮动，不压缩画布；正常状态无空侧栏                                                                                                             |
| Workflow Run Node Details Dialog | Node 运行详情                 | Non-modal Floating Dialog | 点击 Node 靠右浮动；状态/输出/等待/错误按需显示，技术事件折叠；Human Gate 原位决策，Agent/Arena 深链；与关注卡互斥且不改变 viewport                                                        |
| Scheduled Task Dialog            | 定时运行设置                  | Settings                  | 时区、计划、启停、下次运行                                                                                                                                                                 |
| Workflow Template Picker         | 模板选择                      | Collection                | 搜索、预览、无模板、新建                                                                                                                                                                   |

## Arena

| 当前页面 / 路由族                 | 目标页面        | 模板          | 状态与要求                                                                                                                                         |
| --------------------------------- | --------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/issues/$issueId/arena/$groupId` | Arena 对比页    | Comparison    | 2–3 个结果列；超过三项或窄屏使用候选切换与固定摘要；无无限横向滚动                                                                                 |
| Create Arena Dialog               | 创建 Arena 流程 | Comparison    | Provider 能力、候选数、仓库和分支                                                                                                                  |
| Arena Candidate Result Column     | 候选结果列      | Comparison    | Agent、状态、摘要、Diff、测试、会话入口和获胜选择；candidate 使用稳定 ID 与显式 attempt/synthesis purpose，不从 Workspace 名称推断；不内嵌完整对话 |
| Synthesize Arena Dialog           | 综合结果        | Comparison    | 启动真实 synthesis 工作区；新结果进入候选集合，不覆盖原候选，失败可重试                                                                            |
| Arena Winner Panel                | 获胜方案        | Comparison    | 成功的原始或综合结果均可选择；点击只打开共享确认框，不直接提交 mutation                                                                            |
| Arena Winner Confirm Dialog       | 采用获胜方案    | Modal         | 候选、变更文件数、归档数量与实际后续影响；取消焦点返回，提交全局防重复，失败原位重试                                                               |
| Arena Stop All                    | 停止全部        | Header Action | 仅存在可取消真实运行时显示；通过 canonical cancel 取消全部可取消 AgentRun，不等同于关闭 Arena                                                      |
| Arena Lifecycle Menu              | 本轮生命周期    | Overflow Menu | “关闭本轮”保留结果与工作区；“解散并归档”二次确认后归档工作区并删除 Arena；离开页面不触发任何一项                                                   |

## 智能体中心与工具

| 当前页面 / 入口          | 目标页面                   | 模板                 | 状态与要求                                      |
| ------------------------ | -------------------------- | -------------------- | ----------------------------------------------- |
| Agents Settings          | Provider 清单与详情        | Settings             | Ready、未安装、未登录、版本不兼容、Degraded     |
| Agents Navigation        | Agent Page Tabs 与页内分类 | Settings             | Provider、模型、MCP、Skills、Commands、原生配置 |
| Model Selector           | Provider 模型与推理选择    | Settings / Workbench | 默认值、最近值、显式 override                   |
| MCP Settings             | MCP 目录与管理             | Settings             | 发现、添加、编辑、删除、启停、错误              |
| Agent Tools Settings     | 工具总览                   | Settings             | Provider、项目、会话作用域                      |
| Skills                   | Skills 目录                | Settings             | 本机扫描、启停、搜索、来源、冲突                |
| Commands                 | Commands 目录              | Settings             | Provider 原生 CommandAdapter、启停、编辑        |
| Native Config            | 原生配置安全视图           | Settings             | 文件标识、结构化字段、Diff、无效配置；不展示路径、原文或未知值 |
| Configuration Profiles   | 配置档案                   | Settings             | 保存、复制、删除、跨 Provider 预览              |
| Tool Copy                | 跨 Provider 复制流程       | Settings             | 支持项、不支持项、目标 Diff、应用结果           |
| Garage / Capability View | Provider 能力详情          | Settings             | capability matrix、不可用原因、刷新             |

## 通用设置

| 当前页面 / 入口       | 目标页面                      | 模板     | 状态与要求                                                                                                                                                          |
| --------------------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General Settings      | 外观与应用行为                | Settings | 密度、字体、IDE、更新                                                                                                                                               |
| Theme Settings        | 主题模式                      | Settings | `System / Light / Dark`；首次启动默认 System，System 实时跟随操作系统，显式 Light/Dark 固定；切换无首屏闪烁且不丢页面状态；两套主题覆盖边框、状态、Diff、终端和代码 |
| Settings Navigation   | Settings Page Tabs 与页内分组 | Settings | 应用、仓库、主机、Relay、组织、通知、数据                                                                                                                           |
| Repos Settings        | 仓库管理                      | Settings | 本机/远程、默认分支、失效路径                                                                                                                                       |
| Relay Settings        | 主机与配对                    | Settings | 在线、离线、配对、重连、删除                                                                                                                                        |
| Organizations         | 组织管理                      | Settings | 个人组织、成员、创建、离开                                                                                                                                          |
| Remote Projects       | Cloud 项目                    | Settings | 创建、删除、同步、无权限                                                                                                                                            |
| Notification Settings | 通知规则                      | Settings | 系统权限、应用规则、测试通知                                                                                                                                        |
| Data Settings         | 本地数据                      | Settings | 数据位置、导出、诊断信息                                                                                                                                            |

## 辅助页面与弹窗

以下组件不一定拥有独立路由，但必须迁移到新设计系统：

| 类别 | 覆盖对象                                                   |
| ---- | ---------------------------------------------------------- |
| 确认 | 删除、取消运行、Force Push、Rebase、Resolve Conflict       |
| 选择 | 项目、仓库、分支、工作区、Agent、模型、IDE、标签、负责人   |
| Git  | 创建 PR、关联 PR、改目标分支、编辑分支名、Rebase、冲突处理 |
| 文件 | 文件夹选择、图片预览、附件、恢复日志                       |
| 帮助 | 键盘快捷键、工作区指南、Release Notes、登录提示            |
| 错误 | Crash Screen、Error Dialog、同步错误、未找到页面           |
| 数据 | Export 页面、下载、导出项目选择                            |

通用 Dialog 必须复用统一 Shell、表单组件、错误区和底部操作栏。业务流程超过两个显著步骤时使用页面或 Stepper，不继续扩张 Modal。

## 实现与验证状态矩阵

这张表记录当前证据，不再用预期中的 `✓` 代替已完成验证：

- `✓`：已实现且有当前任务记录中的自动化或检查证据。
- `△`：已实现或部分验证，但仍需对应的 Phase 8 gate 收口。
- `缺`：业务上适用，但当前没有实现或验证证据。
- `N/A`：该状态对这个页面族没有业务意义；不能用同组其他页面已覆盖或
  暂时找不到证据来替代 `N/A` 理由。

| 页面 / 表面族 | 实现 | Loading | Empty | Error | Offline | Permission | Degraded | 响应式 | 键盘 / a11y | 证据或剩余 gate |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| App Shell / Sidebar | ✓ | △ | △ | △ | ✓ | N/A | △ | △ | ✓ | App Shell Chromium；P8-S1、P8-R1 |
| Dashboard | ✓ | △ | △ | △ | △ | N/A | △ | △ | △ | P8-S1、P8-R1、P8-A1 |
| Global Search Palette | ✓ | △ | ✓ | △ | N/A | N/A | △ | △ | ✓ | Shell/Search 覆盖；P8-S1、P8-R1 |
| 项目目录 | ✓ | △ | △ | △ | △ | N/A | △ | △ | △ | P8-S1、P8-R1、P8-A1 |
| 项目看板 / Issue 浮动框 | ✓ | ✓ | ✓ | ✓ | △ | △ | ✓ | △ | ✓ | Kanban Playwright 8/8；P8-S1、P8-R1 |
| 工作区列表 | ✓ | △ | △ | △ | △ | △ | △ | △ | △ | P8-S1、P8-R1、P8-A1 |
| Agent 工作台 / 原生接管 | ✓ | ✓ | ✓ | ✓ | △ | △ | △ | △ | ✓ | 原生接管状态与 390/reduced-motion 覆盖；P8-S1、P8-R1 |
| Workflow 列表 / 编辑 / 运行 | ✓ | ✓ | ✓ | ✓ | △ | △ | ✓ | △ | △ | Workflow route-state 覆盖；P8-S1、P8-R1、P8-A1 |
| Arena | ✓ | ✓ | ✓ | ✓ | △ | △ | ✓ | △ | △ | Arena zero-result Empty 与 route-state 覆盖；P8-S1、P8-R1、P8-A1 |
| 智能体中心 | ✓ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | △ | △ | Settings model Playwright；P8-S1、P8-R1、P8-A1 |
| 设置 / Host / 更新 | ✓ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | △ | ✓ | Settings 20/20、App Shell 5/5；P8-S1、P8-R1、P8-A1 |
| Onboarding | ✓ | ✓ | △ | ✓ | N/A | N/A | N/A | △ | △ | StateSurface 迁移；P8-S1、P8-R1、P8-A1 |
| Remote 登录 / 账户 / 邀请 | ✓ | ✓ | N/A | ✓ | △ | △ | △ | △ | △ | Remote auth milestone；P8-S1、P8-R1、P8-A1 |
| Remote Home / 组织项目 | ✓ | ✓ | ✓ | ✓ | △ | △ | ✓ | △ | △ | Remote Home milestone；P8-S1、P8-R1、P8-A1 |
| Notifications | ✓ | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | 缺 | 缺 | Utility state 10/10；P8-R1、P8-A1 |
| Export | ✓ | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | 缺 | 缺 | Utility state 10/10；P8-R1、P8-A1 |
| VS Code | ✓ | ✓ | ✓ | ✓ | N/A | N/A | ✓ | 缺 | 缺 | Utility state 10/10；Host Offline 由外层路由负责；P8-R1、P8-A1 |
| Crash Screen | ✓ | N/A | N/A | ✓ | N/A | N/A | N/A | 缺 | 缺 | 真实 CrashScreen browser 11/11；P8-R1、P8-A1 |
| 404 | ✓ | N/A | N/A | ✓ | N/A | N/A | N/A | △ | △ | 404 StateSurface 迁移；P8-R1、P8-A1 |
| Project Sunset | ✓ | N/A | N/A | N/A | N/A | △ | ✓ | △ | △ | Sunset Degraded 迁移；P8-S1、P8-R1、P8-A1 |
| Release Notes | ✓ | ✓ | ✓ | ✓ | △ | N/A | N/A | △ | ✓ | Release Notes milestone；P8-S1、P8-R1 |
| 共享 Dialog / Confirmation | ✓ | N/A | N/A | ✓ | N/A | N/A | N/A | ✓ | ✓ | UI foundations browser suite |

`P8-P1` 是全局性能 gate，适用于 Dashboard 初始 bundle、Workflow、Arena、
editor、terminal，以及大列表和长会话，不在每一行重复标记。只有表中全部
适用状态从 `△` / `缺` 收敛为 `✓` 或有理由的 `N/A`，P8-S1、P8-R1、P8-A1
才可以关闭。

## 完成检查

页面迁移完成前必须回答：

- 当前页面是否已经使用新 App Shell 和页面模板？
- 页面是否仍依赖旧 Token、旧组件或 `.new-design` 作用域？
- 所有可点击对象是否有 hover、active、focus 和 disabled？
- 关键操作在移动端和键盘模式下是否仍可发现？
- Agent 状态是否只来自 canonical AgentRun 投影？
- Local 与 Remote 是否共享同一 View，只在容器和能力上有差异？
- 页面矩阵中的边界状态是否有截图或自动化测试？
