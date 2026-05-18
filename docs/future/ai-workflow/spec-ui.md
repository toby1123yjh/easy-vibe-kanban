# AI Workflow Canvas UI/Interaction Design Spec

> 状态：2026-05-18 UI 高级感专项设计稿  
> 范围：AI Workflow 画布、Agent Step 节点、连线、右侧面板、动效、交互反馈  
> 目标：把当前 workflow 画布从“可用的流程编辑器”提升为“成熟、专业、有运行生命感的多 Agent 工作流画布”

## 1. 核心判断

当前 AI Workflow 的“半成品味道”主要不是功能数量不足，而是 UI 语言、交互反馈和动效语义还没有形成系统。

成熟画布产品的高级感来自：

- 视觉层级稳定：画布、节点、连线、右侧面板、浮层各自有清楚层级。
- 操作可发现：节点、连线、画布上的下一步动作贴近对象本身。
- 动效有语义：只有选中、拖拽、连接、运行、失败等状态才动。
- 状态反馈细腻：draft、running、succeeded、failed、stale 等状态能一眼识别。
- 细节一致：圆角、阴影、边框、颜色、图标、间距、动画速度来自同一套规则。

AI Workflow 不应该只是“深色背景 + 卡片 + 发光线”。高级感的方向应该是：

> 平时克制，操作时清晰，运行时有生命感，出错时一眼定位。

## 2. 参考产品取舍

### 2.1 n8n

重点参考：

- 节点 hover 后出现对象级操作。
- 从节点端口继续添加下一步的交互。
- 连接线 hover/selected 后可操作。
- Node Detail View 的清晰工作区结构。
- 键盘快捷键、复制粘贴、删除、打开、缩放等编辑器成熟度。

不直接照抄：

- n8n 的核心语义是数据流，AI Workflow 的 edge 语义是执行顺序。
- n8n 的 input/output 主心智不应成为 AI Workflow 的主界面。

### 2.2 Dify

重点参考：

- 现代 AI 产品的深色视觉质感。
- 节点状态和运行过程的视觉反馈。
- 右侧配置/调试面板的产品感。
- 局部发光和状态动效的情绪表达。

不直接照抄：

- 不做纯装饰性大面积渐变和发光。
- 不让视觉情绪压过工具效率。

## 3. 产品 UI 定义

AI Workflow 的画布 UI 心智：

```text
Workflow Attempt = 一次通过流程图实施的 Task Attempt
Agent Step = 一个稳定的 agent session
Edge = 一个执行触发顺序
Canvas = 本次任务的实施路线图
Right Panel = 当前节点的 session cockpit 或配置面板
```

设计重点：

- 节点不是普通流程块，而是可打开、可配置、可运行、可复用的 agent session。
- 连线不是数据管道，而是“上游完成后触发下游”的执行路径。
- 右侧面板不是普通 inspector，而是当前节点的工作舱。

## 4. 视觉设计方向

### 4.1 整体风格

推荐风格：

- 专业工具型深色界面。
- 克制的 AI 科技感。
- 局部状态发光，不做全局炫光。
- 信息密度适中，避免营销页式大块装饰。

关键词：

- precise
- cockpit
- graph editor
- dark professional
- agent orchestration
- execution flow

### 4.2 色彩层级

画布色彩必须分层：

| 层级 | 用途 | 建议 |
| --- | --- | --- |
| Canvas background | 主画布背景 | 深灰黑，不用纯黑 |
| Grid | 空间参考 | 极低对比，不能抢节点 |
| Node surface | 节点卡片 | 比画布亮一级 |
| Panel surface | 右侧面板 | 比节点/画布更稳定、更清晰 |
| Popover/menu | 悬浮操作 | 比 panel 亮一级，有明确边界 |
| Brand accent | 选中/主操作/active | 小面积使用 |
| Status colors | success/warning/error | 仅用于状态点、角标、边框、文本 |

禁止：

- 所有连线常驻发光。
- 所有节点都有强 glow。
- 一屏同时出现大量品牌色。
- 使用颜色作为唯一状态表达。

### 4.3 背景和网格

画布背景应该服务于定位，不应成为装饰主角。

要求：

- 背景使用深灰黑的细微层次。
- 网格点/线低对比，idle 状态下只提供空间感。
- 不使用大面积廉价渐变、光斑、orb、bokeh。
- 缩放时网格密度保持稳定，避免视觉噪声。

验收：

- 退远看，节点和连线是第一视觉焦点。
- 空白画布不显廉价，但也不抢内容。

## 5. 节点 UI 规格

### 5.1 Agent Step 卡片信息

Agent Step 卡片保持轻量，只展示：

- 标题。
- Agent 类型。
- 模型或 preset。
- 状态。
- 是否有 session。
- 必要时展示 “updated for next run” 这类角标。

不展示：

- 完整 prompt。
- 完整 executor 配置表单。
- 大段输出。
- 内部 node/session/process id。

### 5.2 节点视觉结构

推荐结构：

```text
+------------------------------------------------+
| icon  Step title                         state |
|       Codex / gpt-5.5                         |
|                                                |
| [Session ready] [Running/Done/Error/Stale]     |
+------------------------------------------------+
```

要求：

- icon 区域固定尺寸。
- 标题单行截断，但 hover/title 可看完整。
- agent/model 一行轻量展示。
- 状态 chip 不超过 2-3 个。
- 卡片尺寸稳定，hover/selected/running 不导致布局跳动。

### 5.3 节点状态皮肤

| 状态 | 视觉 |
| --- | --- |
| draft | 低对比边框，Draft chip |
| configured | 普通边框，agent/model 明确 |
| session ready | 小型 success/neutral chip |
| running | 品牌色呼吸边框 + 小状态点 pulse |
| succeeded | 低饱和 success 状态点/边框 |
| failed | error 状态点 + 小角标 |
| waiting_user | warning 状态点 + 轻量提示 |
| stale config | 黄色角标：Updated for next run |
| selected | 品牌色 ring + 柔和阴影 |
| hover | 边框略亮 + 操作条出现 |

原则：

- idle 状态克制。
- running 才允许持续动效。
- failed 必须比 succeeded 更容易定位。
- stale config 必须明确表示“已保存，但只影响后续运行”。

### 5.4 节点 hover 操作条

Agent Step hover 或 selected 时显示操作条：

```text
Open Session | Edit | Run Step | Duplicate | Delete
```

实现形式：

- 节点右上角浮动 icon group。
- 或节点上方轻量 pill toolbar。
- icon 必须有 tooltip。
- destructive 操作视觉弱于主操作，但颜色语义明确。

要求：

- 不依赖右键作为唯一入口。
- 操作条出现/消失使用 120-180ms fade/slide。
- 操作条不挤压节点内容。
- 点击操作条不触发节点拖拽。

## 6. 连接线 UI 规格

### 6.1 Edge 语义

Edge 只表达：

```text
source 节点完成后，触发 target 节点
```

不表达：

- 数据映射。
- prompt 注入。
- output capture 主路径。

### 6.2 Edge 状态

| 状态 | 视觉 |
| --- | --- |
| idle | 细线、低对比、无动画 |
| hover | 线条略亮，显示中点操作 |
| selected | 品牌色高亮，显示操作点 |
| running | 从 source 到 target 的方向性光束 |
| succeeded | 静态低饱和 success 线 |
| failed/blocked | error/warning 线，必要时断点或小标记 |

禁止：

- idle edge 常驻光束。
- 所有 edge 同时发光。
- 连线拖拽过程中出现反向大弯曲或异常绕行。
- 只靠颜色区分状态。

### 6.3 Edge 操作

Edge hover/selected 后必须可发现：

- Delete。
- Reconnect source。
- Reconnect target。
- Insert Agent Step。

短期可以先做到：

- 中点操作按钮。
- Delete 快捷操作。
- 右侧 edge inspector 作为补充。

长期目标：

- 连接线中点点击弹出 edge action menu。
- 支持在边上插入 Agent Step，并自动重连为 source -> new -> target。

## 7. 端口和连接交互

### 7.1 四方向端口

Agent Step 必须支持上下左右四方向连接。

视觉要求：

- 平时弱可见或半透明。
- hover/selected 节点时清晰可见。
- 连接拖拽时目标端口高亮。
- 端口尺寸和 hit area 分离：视觉可以小，命中区域必须足够大。

### 7.2 Add Next Step

成熟画布不应该只靠顶部 Add。

节点上应提供“添加下一步”的对象级入口：

- 从节点右侧端口拖出，释放到空白处时创建新 Agent Step。
- 或 hover 节点时出现 `+`，点击后在右侧创建并自动连线。

行为：

- 新节点自动放到当前节点右侧或合适方向。
- 自动连接 selected/source -> new node。
- 创建后打开右侧 Edit Panel。
- 保证不与现有节点重叠。

## 8. 右侧面板 UI 规格

### 8.1 面板角色

右侧面板有两种主要模式：

- Session Cockpit：双击 Agent Step 打开。
- Edit Panel：右键/hover Edit 打开。

不再使用 modal 作为主编辑路径。

### 8.2 Session Cockpit

顶部固定 header：

- 节点标题。
- agent/model。
- 当前状态。
- session ready / not started。
- Run this step。
- Edit config。
- Open workspace。

主体：

- conversation transcript。
- 当前输入框。
- 当前执行状态。
- 最近错误或 waiting user 提示。

底部：

- 输入框固定或随现有 session 体系保持一致。

内部 id：

- session id、process id、node id 只能放在 secondary technical details。
- 不能作为主标题或主副标题。

### 8.3 Edit Panel

Edit Panel 包含：

- Step title。
- Default prompt。
- Agent。
- Model。
- Reasoning/thinking。
- Plan/permission 等现有 agent 配置。

要求：

- 在右侧 panel 中编辑，不弹 modal。
- 保存按钮固定在底部。
- 修改后明确提示影响下一次 run/trigger。
- 节点正在 running 时锁定 prompt/agent/model。
- title 可以允许继续改，但不能误导为已影响当前运行。

### 8.4 面板动效

要求：

- 面板首次打开：slide/fade，150-220ms。
- Session/Edit/Edge Inspector 切换：crossfade，120-180ms。
- header 固定，内容区独立滚动。
- 面板宽度可拖拽调整。
- reduced motion 下关闭 slide，仅保留快速 opacity。

## 9. 动效系统

### 9.1 原则

动效必须表达状态或空间关系，不做纯装饰。

允许动效：

- running edge beam。
- running node breathing border。
- selected ring transition。
- hover toolbar fade/slide。
- panel slide/crossfade。
- drag preview。
- save success flash。

不允许：

- idle 状态持续发光。
- 大面积背景动画。
- 装饰性粒子常驻。
- 慢于 500ms 的常规 UI 动效。
- 会导致布局 reflow 的 width/height 动画。

### 9.2 时间和 easing

| 场景 | 时间 |
| --- | --- |
| hover/press | 100-160ms |
| selected/focus | 120-180ms |
| panel open/close | 150-220ms |
| content crossfade | 120-180ms |
| running pulse | 1500-2000ms |
| edge beam loop | 1000-1600ms |

实现要求：

- 使用 transform/opacity。
- 避免动画 top/left/width/height。
- 支持 `prefers-reduced-motion`。

## 10. 工具栏和快捷键

### 10.1 顶部工具栏

顶部工具栏只保留全局操作：

- Back。
- Workflow title/description。
- Add Agent Step。
- Validate。
- Run Workflow。
- Open latest run。
- Save。

对象级操作不要堆到顶部，应贴近节点/edge。

### 10.2 快捷键

建议支持：

| 快捷键 | 行为 |
| --- | --- |
| Enter | 打开选中 Agent Step session |
| F2 | 重命名选中节点 |
| Delete/Backspace | 删除选中节点或 edge |
| Cmd/Ctrl + C | 复制选中节点 |
| Cmd/Ctrl + V | 粘贴节点 |
| Cmd/Ctrl + D | 复制节点并放到旁边 |
| Cmd/Ctrl + K | 打开 command palette |
| 0 | fit view |
| + / - | zoom in/out |
| Space + drag | pan canvas |

快捷键必须配合菜单或 tooltip 可发现，不能成为唯一入口。

## 11. 注释和分组

当前画布缺少解释层，会导致多个节点后像“散落的卡片”。

建议引入：

- Sticky Note。
- Stage Group。
- 背景区域。

### 11.1 Sticky Note

能力：

- 添加文本说明。
- 支持 resize。
- 支持颜色轻量变化。
- 支持 Markdown 的基础格式。
- 可以放到节点后面作为说明。

用途：

- 解释阶段目标。
- 说明为什么分支。
- 标注手动注意事项。

### 11.2 Stage Group

能力：

- 包住一组节点。
- 有标题和轻量说明。
- 背景低对比。
- 不抢节点视觉焦点。

示例：

```text
[阶段 1：理解项目]
Start -> 熟悉项目

[阶段 2：实现与验证]
实现代码 -> Review -> 测试
```

## 12. 空态和默认骨架

默认骨架不能像随机放了三个节点。

默认布局：

```text
Start -> 熟悉项目 -> End
```

视觉要求：

- 三个节点水平排布稳定。
- Start/End 弱化为结构节点。
- Agent Step 是视觉中心。
- 首次进入时画布 fit view 正确。
- 不出现节点重叠。

默认 Agent Step：

- 标题：熟悉项目。
- agent：默认熟悉项目 agent 或系统默认 agent。
- prompt：完整默认 prompt。
- 状态：Draft / Session ready。

## 13. 高级感验收标准

### 13.1 静态视觉

- 画布第一眼是专业工具，不是流程图 demo。
- idle 状态整体克制，没有满屏发光。
- 节点、连线、面板层级清楚。
- 节点卡片信息少而准。
- 状态颜色使用小面积且一致。

### 13.2 交互

- hover 节点能看到主要操作。
- hover edge 能看到 edge 操作。
- 双击 Agent Step 打开 Session Cockpit。
- Edit 在右侧 panel，不使用 modal。
- 连接、重连、删除都可发现。
- 面板宽度可拖拽。

### 13.3 动效

- running edge 才有方向性流动光束。
- running node 有轻微呼吸状态。
- selected/hover/panel 切换平滑。
- reduced motion 生效。
- 无布局跳动。

### 13.4 可用性

- 新用户不看说明也能添加下一步。
- 用户能一眼知道哪个节点正在跑、哪个失败、哪个已更新等待下次运行。
- 用户能从节点进入会话，也能从会话回到配置。
- 用户不会因为内部 id 误解当前对象。

## 14. 分批实施排序

### 14.1 排序规则

需求按以下规则排序：

1. 用户第一眼可见影响：越能直接改善“半成品味道”，优先级越高。
2. 操作闭环依赖：越是后续功能依赖的基础交互，优先级越高。
3. 状态表达价值：越能让用户理解 workflow 当前状态，优先级越高。
4. 实现风险：风险低、可快速验证的需求优先放前面。
5. 可单独验收：每批必须能独立体验，不依赖后面批次才成立。

优先级不是按功能数量排序，而是按“高级感改善效率”排序。

### 14.2 Batch 0：已完成或作为基线保留

目标：确认后续 UI 改造建立在当前可用基线上。

| 序号 | 需求 | 状态 | 说明 |
| --- | --- | --- | --- |
| 0.1 | 移除右下角 MiniMap | 已完成 | 避免白块/低质缩略图破坏画布质感 |
| 0.2 | Zoom controls 高对比样式 | 已完成 | 左下角控制器不能看不清 |
| 0.3 | Agent Step Edit 改为右侧 panel | 已完成 | 不再使用 modal 作为主编辑路径 |
| 0.4 | 画布和右侧 panel 可拖拽调整宽度 | 已完成 | 提升 cockpit 感和专业工具感 |
| 0.5 | 节点卡片显示 agent/model | 已完成 | 节点不再只是普通流程块 |
| 0.6 | Session header 业务化 | 已完成 | 主标题不再展示内部 session/process id |

### 14.3 Batch 1：先去掉“廉价感”的状态和动效

目标：让画布第一眼不再像 demo，让运行状态真正有语义。

| 序号 | 需求 | 优先级原因 | 验收 |
| --- | --- | --- | --- |
| 1.1 | Edge 状态分层：idle 不发光，running 才有 beam | 当前最容易造成“廉价炫光”和半成品感 | 静态图上 idle edge 克制；运行时才看到方向性光束 |
| 1.2 | Running node 呼吸边框/状态点 | 用户需要一眼知道哪个 agent 正在跑 | running 节点有轻微动效，非 running 节点不动 |
| 1.3 | Succeeded/failed/waiting/stale 状态皮肤 | 状态可信度是 workflow 产品的核心 | 每种状态有边框/点位/icon/chip 组合，不只靠颜色 |
| 1.4 | Updated for next run 角标 | 运行后可编辑配置后必须解释清楚 | 修改已运行节点配置后，节点显示下次运行生效 |
| 1.5 | Reduced motion 支持 | 动效系统必须专业且可访问 | 开启 reduced motion 后关闭 beam/pulse/slide 动效 |

这一批完成后，画布应该达到：

- idle 状态安静、专业。
- running 状态有生命感。
- 失败和等待状态一眼可定位。
- 用户知道哪些改动只影响下一次运行。

### 14.4 Batch 2：对象级操作可发现

目标：把核心操作贴回节点和连线本身，减少“我不知道从哪里操作”的感觉。

| 序号 | 需求 | 优先级原因 | 验收 |
| --- | --- | --- | --- |
| 2.1 | 节点 hover 操作条 | 节点是 Agent Step session，主操作必须贴近对象 | hover/selected 后出现 Open Session、Edit、Run Step、Duplicate、Delete |
| 2.2 | 节点级 Add Next Step | 顶部 Add 不够自然，n8n/Dify 类画布都有对象级续接 | 从节点右侧或 `+` 创建下游节点并自动连线 |
| 2.3 | Edge hover/selected 操作点升级为 action menu | 线条删除/重连/插入现在可发现性不足 | hover edge 后能 Delete、Reconnect、Insert Agent Step |
| 2.4 | 连接端口 hover/drag 状态优化 | 四方向 handle 技术上有了，但产品感不够 | 端口平时弱化，hover/drag/target 时清楚高亮 |
| 2.5 | 节点右键菜单与 hover 操作一致 | 避免两个入口能力不一致 | 右键菜单和 hover toolbar 的核心操作一致 |

这一批完成后，用户不需要记住右键或顶部按钮，也能自然完成：

```text
打开节点 -> 编辑节点 -> 添加下一步 -> 连线 -> 删除/重连
```

### 14.5 Batch 3：右侧 Session Cockpit 高级化

目标：让右侧不只是“嵌了一个聊天框”，而是当前 Agent Step 的工作舱。

| 序号 | 需求 | 优先级原因 | 验收 |
| --- | --- | --- | --- |
| 3.1 | Session Cockpit 固定 header | 当前节点身份和状态必须始终可见 | header 固定展示 title、agent/model、status、session state |
| 3.2 | Header 关键动作 | 用户要能从会话直接回到配置或触发节点 | Run this step、Edit config、Open workspace 可见 |
| 3.3 | Session/Edit/Edge panel 切换 crossfade | 面板切换不能像硬替换页面 | 切换有 120-180ms 过渡，reduced motion 下关闭 |
| 3.4 | 最近运行摘要/错误区域 | 用户需要从 session cockpit 理解节点最近发生了什么 | 显示最近 run、失败原因、waiting user 提示 |
| 3.5 | 技术信息降级折叠 | 内部 id 不能抢主视觉 | session/process/node id 放到 Technical details |

这一批完成后，双击 Agent Step 的体验应该像进入一个 AI cockpit，而不是普通 inspector。

### 14.6 Batch 4：默认骨架和画布结构解释层

目标：解决多个节点后像“散落的卡片”的问题。

| 序号 | 需求 | 优先级原因 | 验收 |
| --- | --- | --- | --- |
| 4.1 | 默认骨架模板级排版 | 首屏质量决定用户对产品成熟度的判断 | Start -> 熟悉项目 -> End 不重叠，fit view 正确 |
| 4.2 | Start/End 视觉弱化 | 结构节点不应抢 Agent Step 的主视觉 | Start/End 更小、更轻、更像结构标记 |
| 4.3 | Sticky Note MVP | workflow 需要解释层，否则复杂图难维护 | 可添加、编辑、拖拽、resize note |
| 4.4 | Stage Group MVP | 支持阶段化组织多个 agent step | 可创建低对比背景组，有标题和说明 |
| 4.5 | Tidy/Auto layout 轻量能力 | 用户手动画布容易乱 | 提供基础横向 tidy，避免重叠 |

这一批完成后，画布从“节点集合”提升为“可解释的实施路线图”。

### 14.7 Batch 5：编辑器效率和专业细节

目标：补齐成熟画布编辑器的效率感。

| 序号 | 需求 | 优先级原因 | 验收 |
| --- | --- | --- | --- |
| 5.1 | Tooltip 体系 | icon-only 操作必须可理解 | hover toolbar、edge menu、zoom controls 都有 tooltip |
| 5.2 | 快捷键：Enter/F2/Delete/Copy/Paste/Duplicate/Fit view | 熟练用户效率入口 | 常用编辑快捷键可用且不影响输入框 |
| 5.3 | Command palette 入口 | 多操作时避免工具栏膨胀 | Cmd/Ctrl+K 可搜索 workflow 操作 |
| 5.4 | 保存/运行反馈微动效 | 操作后需要确认感 | 保存成功、运行触发、配置变更有轻量反馈 |
| 5.5 | 空态和错误态文案统一 | 低质空态会降低产品完成度 | 画布、panel、edge inspector 空态都有明确下一步 |

这一批完成后，workflow 画布会更像专业编辑器，而不是功能页。

### 14.8 Batch 6：视觉 token 和长期设计系统

目标：防止后续继续“每个组件各自设计一点”。

| 序号 | 需求 | 优先级原因 | 验收 |
| --- | --- | --- | --- |
| 6.1 | Canvas token | 背景、网格、control、selection 有统一 token | 不再散落硬编码画布颜色 |
| 6.2 | Node token | 节点背景、边框、状态、阴影、圆角统一 | Agent/Start/End/Note/Group 使用同一尺度 |
| 6.3 | Edge token | idle/hover/selected/running/succeeded/failed 统一 | 状态线条颜色、宽度、动画来自 token |
| 6.4 | Panel token | side panel、popover、menu、inspector 层级一致 | 面板和浮层不再像不同系统 |
| 6.5 | Motion token | fast/base/slow/pulse/beam 统一 | 所有动效速度和 easing 一致 |

这一批不是第一优先级，但它决定后续产品能不能持续变高级。

### 14.9 推荐开发顺序汇总

```text
Batch 1：状态和动效降噪
  -> 先让画布不廉价，运行状态可信

Batch 2：对象级操作可发现
  -> 让用户自然知道怎么操作节点和线

Batch 3：Session Cockpit 高级化
  -> 让节点双击后的右侧工作舱成立

Batch 4：解释层和默认骨架
  -> 让复杂 workflow 不像散落卡片

Batch 5：快捷键、tooltip、反馈
  -> 让它像成熟编辑器

Batch 6：视觉 token 系统
  -> 让后续迭代不继续变散
```

## 15. 反模式清单

避免：

- 继续堆节点类型来掩盖画布交互粗糙。
- 把 prompt、配置表单、输出都塞进节点卡片。
- 所有连线都发光。
- 所有状态都靠 chip 文案表达。
- 只靠右键菜单暴露核心操作。
- 只做深色和阴影，不做状态和动效体系。
- 让 session/process/node id 成为主视觉信息。
- 新增复杂配置但没有对应的保存/运行/反馈闭环。

## 16. 一句话设计原则

> AI Workflow 画布的高级感，不来自更多装饰，而来自对象级操作可发现、状态反馈可信、运行过程有生命感、视觉系统足够克制且一致。
