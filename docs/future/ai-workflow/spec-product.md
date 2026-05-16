# AI Workflow 产品化新设计

> 状态：2026-05-16 讨论确认稿
> 范围：AI Workflow 的产品定义、业务模型、画布交互、节点会话、运行语义和视觉方向
> 目标：把当前 workflow 从“普通节点编辑器”改造成 issue 下的一种 Task Attempt 实施方式
> 相关文档：`spec.md`、`spec-0512c.md`、`benchmarks.md`、`canvas-open-source-analysis-0511.md`

## 1. 核心结论

AI Workflow 不是一个独立的通用自动化模块，也不是项目顶部的模板管理器。

新的定义是：

> 一个 Workflow Attempt 就是一个 Task Attempt，只是它通过多个 agent session 组成的流程图来完成任务。

关键原则：

- Workflow Attempt 必须在 Issue 下创建。
- Workflow Attempt 创建时就关联 repository，并创建或绑定一个共享 worktree。
- 每个 Agent Step 对应一个稳定的 agent session。
- 节点 session 的使用方式应尽量复用外面普通 Task Attempt 的会话能力。
- Workflow 只是负责按图触发各节点 session，不负责把上游输出拼进下游 prompt。
- 节点之间共享上下文的方式是同一个 worktree，而不是 edge payload。
- 默认运行是自动的：一个节点完成后，按出边触发后续节点。
- 画布视觉方向偏 Dify：更现代、更酷、更有执行流动感。

## 2. 产品心智

用户的心智应该是：

> 我在一个 Issue 下面创建一次 Workflow Attempt，给不同阶段配置不同 agent session，然后让这些 session 按流程自动执行。

不是：

- 我在项目顶部画一个和任务无关的 workflow。
- 我在画一个只有节点信息的流程图。
- 我在配置一堆不能直接对话的表单节点。
- 我在搭建 n8n 那种数据流自动化。

Workflow 的业务语言必须贴近现有产品：

- Issue 是任务来源。
- Task Attempt 是一次实施尝试。
- Workflow Attempt 是 Task Attempt 的一种形态。
- Agent Step 是 workflow 里的一个 agent session。
- Session 是用户真正进入和交互的会话。
- Worktree 是整个 Workflow Attempt 共享的代码状态。

## 3. 业务对象模型

| 业务概念 | 用户理解 | 实现含义 |
| --- | --- | --- |
| Issue | 要解决的问题 | Workflow Attempt 的父对象 |
| Task Attempt | 一次解决该 Issue 的尝试 | 普通单 agent attempt 或 workflow attempt |
| Workflow Attempt | 用流程图执行的一次 Task Attempt | issue-bound graph + shared worktree + node sessions |
| Workflow Run | 对该 workflow attempt 的一次运行 | 运行事件和状态记录 |
| Agent Step | 一个阶段节点 | 一个稳定 agent session + 节点配置 |
| Node Session | 节点对应的会话 | 复用现有 session / execution 能力 |
| Execution Process | 一次实际 agent 执行 | 节点 session 中的一次执行 |
| Repository | 代码仓库 | 创建 Workflow Attempt 时绑定 |
| Worktree | 共享代码工作区 | Workflow Attempt 内所有节点共享 |
| Start | 起始结构标记 | 触发所有出边，不创建 session |
| End | 完成结构标记 | 展示完成/汇聚状态，不创建 session |
| Edge | 执行顺序 | source 成功后触发 target |

## 4. 信息架构

### 4.1 主入口

主入口只能在 Issue 的 Task Attempt 区域。

推荐路径：

```text
Issue
  -> New Task Attempt
  -> Workflow Attempt
  -> 进入 canvas draft
  -> 配置 Agent Step
  -> Run Workflow
```

### 4.2 移除项目顶部 Workflow 入口

短期不保留 Project 顶部的 Workflow 页面。

原因：

- Workflow 本质上是某个 Issue 的一次 Task Attempt。
- 脱离 Issue 的 workflow 会让用户困惑“这个流程到底要解决哪个任务”。
- 模板库、市场、项目级 workflow 管理都不是当前主路径。

后续如果需要模板能力，也应该从 Issue 创建 Workflow Attempt 时作为模板选择出现，而不是成为当前 V1 的主入口。

## 5. 创建 Workflow Attempt

### 5.1 创建时必须做的事

用户在 Issue 下创建 Workflow Attempt 时，系统应立即完成：

- 绑定当前 Issue。
- 绑定 repository。
- 创建或绑定一个 shared worktree。
- 创建默认画布骨架。
- 为默认 Agent Step 创建或绑定稳定 session identity。

这不是副作用。既然用户已经确认创建 workflow，这些就是 Workflow Attempt 的必要资源。

### 5.2 默认骨架

创建后必须先进入画布，而不是先弹出 `Run workflow`。

默认骨架：

```text
Start -> 熟悉项目 -> End
```

要求：

- 三个节点必须有稳定、不重叠的位置。
- 每次新建或重新打开画布，Start、Agent Step、End 不能堆在一起。
- 默认 Agent Step 是普通 Agent Step 的 preset，不是独立节点类型。
- 默认 Agent Step 的阶段目标是“熟悉项目/理解任务/形成方案”，不是直接实现。
- Start 和 End 视觉弱化，只作为小型结构标记。

### 5.3 Workflow Goal

Workflow Goal 只作为标题或人类可读说明。

它不参与任何 prompt 注入。

Agent session 的启动 prompt 只来自对应 Agent Step 自己配置的默认 prompt。

## 6. Agent Step 与 Session

### 6.1 一个 Agent Step 对应一个 Session

核心规则：

- 一个 Agent Step 就是一个稳定 agent session。
- 不管 Workflow 是否已经运行，用户都可以打开这个 session 并开始会话。
- Workflow 运行到该节点时，只是把该节点配置好的默认 prompt 发送到这个 session。
- 多次运行 Workflow 时，复用同一个节点 session。
- 不为每次 run 创建新的 node session。

### 6.2 必须复用现有 Task Attempt 能力

Agent Step session 必须复用现有普通 Task Attempt 的 session / execution / transcript / agent 配置能力。

短期不要做第二套 workflow-only conversation model。

也就是说：

- 外面普通 Task Attempt 能聊天，节点 session 也应该能聊天。
- 外面能选 agent，节点也应该能选 agent。
- 外面支持模型、思考等级、plan mode 等 executor 配置，节点也应支持。
- 外面能看执行状态、输出、日志，节点侧也应尽量复用。

区别只有一个：

- 普通 Task Attempt 创建时可能要选 repository。
- Workflow 节点 session 不再选 repository，因为 Workflow Attempt 创建时已经绑定 repository 和 shared worktree。

### 6.3 未运行前的节点 Session

未运行 workflow 前，双击 Agent Step 也必须能打开右侧 session panel。

这个 panel 不应是空状态，也不应只是配置表单。它应该和外面打开一个普通 Task Attempt 的会话体验尽量一致：

- 显示节点标题、agent、状态。
- 显示当前 session 尚未执行或已有历史。
- 可以直接输入消息并启动该节点 session。
- 可以查看 transcript。
- 可以从这里继续对话。
- 不需要选择 repository。

### 6.4 多次运行

Workflow Attempt 可以多次运行。

用户可以：

- 运行一次。
- 不满意。
- 修改某个节点的默认 prompt 或 agent 配置。
- 再次运行。

这和普通 Task Attempt 里多次执行 prompt 的心智一致。

节点 session 复用，session transcript 中应能标记 run boundary，例如：

```text
Run #1 started
Run #1 completed
Run #2 started with updated prompt
Run #2 completed
```

## 7. 节点配置设计

### 7.1 节点卡片

这里的“节点卡片”指画布上每个节点本体。

节点卡片保持轻量，只展示：

- 节点标题。
- 智能体类型。
- 状态标签。
- 是否已有 session。
- 可选：模型或 plan mode 这类极少量关键 chip。

节点卡片不直接编辑 prompt，不展示完整配置表单。

### 7.2 右侧 Session Panel

双击 Agent Step 固定打开右侧 session panel。

右侧 panel 的职责是会话，不是配置：

- transcript。
- 用户输入框。
- 当前执行状态。
- 运行输出。
- 停止/继续等会话操作。

右侧区域宽度有限，不应放完整 prompt 编辑器和 agent 配置表单。

### 7.3 Edit Dialog

编辑节点配置通过右键菜单进入。

右键 Agent Step 后出现菜单，其中 `Edit` 打开配置弹框。

Edit Dialog 字段：

- Step title。
- Default prompt。
- Agent。
- Agent/executor 配置：
  - model。
  - reasoning/thinking level。
  - plan mode。
  - 其他现有 Task Attempt 创建流程已经支持的 executor 参数。

Edit Dialog 不包含：

- repository 选择。
- worktree 选择。
- 上游输出映射。
- 节点类型选择。

### 7.4 右键菜单

Agent Step 右键菜单至少包含：

- `Open Session`：打开右侧 session panel。
- `Edit`：打开配置弹框。
- `Duplicate`：复制节点配置，但不复制 session transcript 或执行历史。
- `Delete`：删除节点和相关边；如果已有 session，必须有确认。
- `Run From Here`：从当前节点开始触发后续流程。

Start 和 End 是低交互结构节点，不需要复杂菜单。

## 8. 运行语义

### 8.1 Edge 只表示执行顺序

Edge 不表示数据传递，也不表示 prompt 变量映射。

V1 不做：

- 自动把上游输出拼进下游 prompt。
- Output Capture 主路径。
- 上游 summary 自动注入。
- edge payload。

Edge 只表示：

```text
source 完成后，触发 target
```

共享上下文来自同一个 worktree。

### 8.2 Run Workflow

画布顶部工具栏有主按钮 `Run Workflow`。

行为：

- 从 Start 出边开始。
- 触发所有 Start 出边目标节点。
- 每个 Agent Step 用自己的 default prompt 启动或继续自己的稳定 session。
- 所有节点使用同一个 shared worktree。
- 运行中按钮变为 `Stop`。
- 节点失败时，workflow 停在失败节点并打开右侧 session panel。
- 节点进入 `waiting_user` 时，workflow 暂停并打开右侧 session panel。
- 用户再次点击 `Run Workflow`，表示按当前配置再运行一次，不清空 session。

### 8.3 Start

Start 是结构触发节点。

规则：

- 不创建 session。
- 不发送 prompt。
- 可以有多条出边。
- `Run Workflow` 时触发 Start 的所有出边目标。
- 没有出边时，Run disabled 或 validation error。
- 双击 Start 不需要打开 panel。

### 8.4 End

End 是结构完成/汇聚标记。

规则：

- 不创建 session。
- 不发送 prompt。
- 不产生业务逻辑。
- 可以有多条入边。
- 某个分支到达 End 时，End 可显示 partial reached。
- 只有所有 active 分支完成，并且没有 running/pending 节点执行时，workflow 才算完成。
- 双击 End 不需要打开 panel。

### 8.5 Fan-out

一个节点可以有多条出边。

多条出边表示 fan-out：

- source 成功后，同时触发所有 target。
- 多个目标节点默认并行执行。
- 画布上多条 outgoing edge 同时显示 active beam。
- 多个 target 节点同时进入 running/pending。

Workflow V1 不负责并行 worktree 冲突管理。

用户应避免把会互相冲突的 agent 设计成并行任务。产品只按图触发 session，并展示对应执行结果或失败。

### 8.6 Fan-in

一个节点可以有多条入边。

多条入边不是 barrier，也不是“等所有上游都到齐”。

语义是：

- 任意一条入边触发，就向目标节点 session 输入一次该节点当前 default prompt。
- 如果另一个上游之后也触发到同一个节点，就再输入一次 default prompt。
- 这是同一个稳定 session 中的多次输入/执行。

如果目标 session 正在运行时又收到一次触发，workflow 层不发明新的调度系统。它应复用现有 Task Attempt/session 层的处理方式。是排队、拒绝、打断还是串行，由现有 agent/session 能力决定。

## 9. 状态模型

Agent Step 至少支持以下状态：

- `draft`：未运行。
- `pending`：等待触发或已被排入。
- `running`：正在执行。
- `succeeded`：最近一次执行成功。
- `failed`：最近一次执行失败。
- `cancelled`：被取消。
- `waiting_user`：需要用户进入 session 处理。

Edge 至少支持：

- `idle`：未激活。
- `active`：当前正在触发或执行路径中。
- `completed`：该次触发已完成。
- `blocked_or_failed`：路径被失败或暂停阻断。

Start/End 状态：

- Start：idle / active / completed。
- End：idle / partial reached / completed。

状态不能只靠颜色表达，至少还需要图标、标签、动效或边框变化。

## 10. 画布交互设计

### 10.1 新增节点

V1 只保留一个新增节点入口：

```text
Toolbar -> Add Agent Step
```

短期移除或不做：

- 边上 `+` 插入节点。
- 画布右键新增节点。
- 复杂节点库。
- command search 添加节点。
- preset 菜单库。

`Add Agent Step` 行为：

- 如果当前选中了一个节点，新节点放在该节点右侧，并自动连接 `selected -> new`。
- 如果没有选中节点，新节点放在当前 viewport 中心附近。
- 新节点必须避开已有节点，不能重叠。
- 创建后自动选中新节点。
- 创建后打开 Edit Dialog，不打开右侧 session panel。

### 10.2 连接点

移除固定两个出入口的节点设计。

Agent Step 必须在四个方向都有可用 handle：

- top。
- right。
- bottom。
- left。

默认骨架可以使用 left-to-right 方向，但这只是布局偏好，不是能力限制。

要求：

- 用户可以从任意方向连出/连入。
- 连接预览必须稳定，不能拖拽中异常弯曲。
- 已有 edge 必须可以重新拖拽 source/target handle。
- 节点 hover 或选中时 handle 清晰可见。
- 非 hover 时 handle 可以弱化，但不能完全不可发现。

### 10.3 拖拽与布局

必须修复当前明显问题：

- 节点不能拖拽。
- 节点拖拽后位置不保存。
- 默认骨架节点重叠。
- 连线拖拽中异常弯曲。
- 已有连线不能重新拖拽。
- minimap 空白或白色块。

最低验收：

- 新建 workflow 第一次进入画布，节点不重叠。
- 拖动节点后刷新或重新打开，位置保持。
- 连接线在拖拽、重连、节点移动时路径稳定。
- minimap 和当前主题一致，并能显示节点位置。

## 11. 视觉设计方向

目标风格偏 Dify。

关键词：

- 酷炫。
- 现代。
- AI workflow 产品感。
- 有执行流动感。
- 不像普通流程图 demo。

n8n 作为交互成熟度参考，Dify 作为视觉质感参考。

### 11.1 画布背景

建议：

- 深色或半深色背景。
- 精细网格。
- 轻微层次感。
- 不使用大面积廉价渐变。
- 不使用干扰阅读的背景图。

背景要服务于工具感，而不是装饰感。

### 11.2 节点视觉

Agent Step 节点卡片需要精致，但信息保持轻量：

- 清晰标题。
- agent 类型或图标。
- 状态 tag。
- 是否已有 session。
- 轻微阴影。
- 运行态发光边框或状态环。
- 选中态高质量 focus ring。

不要把节点做成大表单。

Start/End：

- 小型结构标记。
- 视觉弱于 Agent Step。
- 不抢主视觉。

### 11.3 连线视觉

连线是本次画布高级感的重点。

要求：

- idle edge 克制。
- active edge 有从 source 到 target 的方向性光束或流动粒子。
- completed edge 有清晰但不过度的完成状态。
- failed/blocked edge 有错误态。
- 多条 fan-out active edge 可同时发光。
- 连接路径必须平滑稳定。

运行时用户应该一眼看到“执行正在从哪里流向哪里”。

### 11.4 右侧 Session Panel

右侧面板应像 AI cockpit，而不是普通设置抽屉。

重点：

- 会话 transcript 清晰。
- 当前 agent/session 状态明显。
- 输入框可用。
- 运行输出可读。
- 与画布选中节点状态联动。
- 不塞完整节点配置表单。

### 11.5 动效原则

动效必须表达状态，不做纯装饰。

建议：

- edge active beam。
- running node 呼吸光效。
- selected node focus transition。
- panel 打开关闭平滑过渡。

必须支持 reduced motion，用户关闭动效时不能影响可用性。

## 12. 与参考产品的取舍

### 12.1 Dify

重点参考：

- AI workflow 的现代感。
- 节点状态表达。
- 运行过程的视觉反馈。
- 右侧配置/会话面板的产品质感。

### 12.2 n8n

重点参考：

- 成熟的拖拽、连线、重连体验。
- 节点选择、运行状态、错误定位。
- 流程编辑器的基础可用性。

### 12.3 Circuit / Open Agent Builder

重点参考：

- agent-oriented workflow 的结构表达。
- 节点作为 agent/task 单元的建模方式。
- 多 agent 编排时的信息展示。

不盲目照搬它们的节点类型扩张。当前重点是把 Agent Step session 化和画布主体验做好。

## 13. 实现要求

### 13.1 数据模型

Workflow Attempt 至少需要表达：

- `issue_id`
- `repository_id`
- `worktree_id`
- `graph`
- `status`
- `created_at`
- `updated_at`

Agent Step 节点至少需要表达：

- `node_id`
- `workflow_attempt_id`
- `session_id`
- `title`
- `default_prompt`
- `agent`
- `executor_config`
- `position`
- `status`

Edge 至少需要表达：

- `edge_id`
- `source_node_id`
- `target_node_id`
- `source_handle`
- `target_handle`
- `status`

`source_handle` / `target_handle` 必须持久化，以支持四方向连接点和重连。

### 13.2 Graph Migration

旧 graph 可能没有 handle 信息或仍然基于固定左右口。

需要 graph migration：

- 老图加载时补默认 handle。
- 新保存格式必须包含 handle。
- graph version 不支持时要自动迁移或给出清晰兼容处理。
- 不应再出现 `Unsupported graph version` 这种用户无法处理的红色错误。

### 13.3 配置器

Agent Step Edit Dialog 应尽量复用现有 Task Attempt 创建配置。

如果使用 schema-driven 配置器，它的含义是：

> 根据 agent/executor 的配置 schema 自动生成配置 UI，而不是为 Codex、Claude、Gemini 等各写一套硬编码表单。

目的：

- 保证节点配置和外面对话创建能力一致。
- 新增 agent 参数时少改 UI。
- 避免 workflow 节点配置落后于普通 Task Attempt。

但 schema-driven 是实现手段，不是用户需要理解的产品概念。

## 14. P0 验收标准

P0 完成后，用户应该能完成以下流程：

1. 在 Issue 下点击创建 Workflow Attempt。
2. 直接进入 canvas draft。
3. 看到 `Start -> 熟悉项目 -> End`，节点不重叠。
4. Workflow Attempt 已绑定 repository 和 shared worktree。
5. 双击 `熟悉项目` Agent Step，右侧打开类似普通 Task Attempt 的 session panel。
6. 未运行 workflow 前，也可以在该节点 session 里直接发消息。
7. 右键 Agent Step，选择 `Edit`，能配置标题、默认 prompt、agent、模型、思考等级、plan mode。
8. 点击 toolbar 的 `Add Agent Step`，新节点位置正确、不重叠，并自动连线。
9. 节点可以拖拽，位置能保存。
10. 节点四个方向都可以连线。
11. 已有 edge 可以重连，拖拽中不异常弯曲。
12. 点击 `Run Workflow`，Start 触发出边目标节点。
13. Agent Step 用自己的默认 prompt 在自己的稳定 session 中执行。
14. 多条出边会并行触发多个目标节点。
15. 多条入边会多次触发同一个目标节点 session。
16. 运行中 edge 有方向性光束效果。
17. running/succeeded/failed/waiting_user 状态在节点和 edge 上清晰可见。
18. End 只作为完成汇聚标记，不创建 session。
19. Project 顶部不再暴露容易误导的 Workflow 主入口。
20. minimap 不再是空白或白色块，能和主题一致地展示节点。

## 15. 暂不做

V1 暂不做：

- 项目顶部 Workflow 模板中心。
- Workflow marketplace。
- preset 菜单库。
- 复杂节点类型扩展。
- Output Capture 主路径。
- 自动上游输出注入。
- 条件分支编辑器。
- fan-in barrier / join 条件。
- 并行节点自动独立 worktree。
- 自动 merge / rollback / conflict resolution。
- 每次 run 给每个节点创建新 session。
- Start/End 的复杂交互面板。

这些不是永远不做，而是不能压过当前核心目标：

> 让 Workflow Attempt 真正成为 Issue 下可用、可运行、可进入节点会话的多 agent Task Attempt。

## 16. 下一阶段开发顺序

建议按以下顺序实施：

1. 信息架构修正：移除 Project 顶部 Workflow 入口，把 Workflow Attempt 主入口收敛到 Issue Task Attempt。
2. 创建流程修正：创建 Workflow Attempt 后进入 canvas draft，并绑定 repository/worktree。
3. 默认骨架修正：生成非重叠的 `Start -> 熟悉项目 -> End`。
4. 节点 session 复用：Agent Step 绑定现有 session，双击打开右侧会话。
5. Edit Dialog：右键 Edit 配置标题、默认 prompt、agent 和 executor 参数。
6. 画布基础交互：toolbar Add、拖拽保存、四向 handle、edge 重连。
7. 运行语义：Start 触发、Agent Step 发送默认 prompt、fan-out、fan-in、End 完成判断。
8. 视觉升级：Dify 风格背景、节点状态、运行光束、minimap 主题化、右侧 AI cockpit。
9. Playwright 验证：覆盖创建、编辑、拖拽、连线、双击 session、运行状态、fan-out/fan-in。
