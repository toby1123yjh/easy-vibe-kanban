# AI Arena Spec v2

> 状态：Draft
> 背景：v1 已经完成一轮真实 npm 包 + Playwright 验证。验证结果显示，当前 Arena 更像“并行跑多个 workspace + 展示 diff 统计”，但这并不符合用户对“竞争模式”的主要期待。

## 1. 核心转向

AI Arena v2 的核心不再是“多个 agent 同时写代码，然后按 diff 选一个合并”，而是：

> 多个 agent 围绕同一个问题产出不同设计思路，用户通过并排阅读、追问、反驳、融合来形成决策。代码实现是后续动作，不是默认目标。

换句话说，Arena 的主价值是“方案竞争”，不是“代码竞速”。

v1 的 implementation race 仍然有价值，但它应该是第二阶段或高级模式。默认入口应该服务于设计、讨论、判断方向。Design Arena 仍然可以创建多个隔离的 workspace / worktree，用来让 agent 读取代码上下文、保留完整对话和承接后续实现；但这些 workspace / worktree 的默认语义不是“产出可合并代码”，而是“隔离的方案讨论环境”。

## 2. v1 暴露的问题

真实验证中暴露了几个根本问题：

1. Arena 首页只显示文件数和增删行数，例如 `1 file +86 -81`，对判断方案质量几乎没有帮助。
2. 当 agent 只输出分析、不改代码时，Arena 页会显示空白或 `Waiting for first changes...`，用户会误以为功能坏了。
3. `Running` 状态显示的是 arena workspace 状态，不是 agent 执行状态。agent 已经结束时，页面仍可能显示 Running。
4. 用户说“不提交”时，系统实际可能在临时 arena 分支生成本地 commit。虽然没有进入 main、没有 promote、没有 PR、没有 push，但语义仍然容易误导。
5. 创建时选择了 executor，但 Arena API 返回里 executor 可能为空，导致结果页不能可靠解释“谁和谁在竞争”。
6. 当前体验更像“两个 workspace 入口”，不是一个真正的决策面板。

这些问题说明，v1 的产品假设错位：它把 Arena 设计成 diff review 工具，但用户更需要 design review 工具。

## 3. 设计原则

### 3.1 自由文本优先

Design Arena 不应该强制结构化输出。

不要要求每个 agent 必须按固定模板回答，例如：

- 需求理解
- 方案设计
- 优点
- 风险
- 实施步骤

这些字段看起来整齐，但会限制真正有价值的讨论。很多时候，一个好的方案可能是一段完整论述、一个反驳、一个重新定义问题的角度，或者一个“不要这样做”的判断。

Design Arena 应该允许 agent 用自由文本表达设计思路。

### 3.2 UI 可以提取元信息，但不能约束内容

系统可以为了展示效果提取轻量元信息，例如：

- agent 名称
- 模型或 executor
- 最后更新时间
- 是否产生代码变更
- 首句或标题
- 是否已完成

这些信息只属于展示层。它们不应该反过来要求 agent 按固定格式写作。

### 3.3 对比是阅读体验，不是数据表

Design Arena 的首页应该让用户直接阅读多个方案，而不是只看统计数字。

核心视图应该是并排对话框，而不是摘要卡片：

- 每个 attempt 是一条完整的对话线程，形态上应接近项目现有 workspace conversation view。
- 用户看到的首先应该是 agent 的原始回答和后续讨论，而不是系统抽取后的摘要。
- 两个 attempt 时默认左右并排；超过两个 attempt 时再考虑横向滚动、分栏缩放或切换视图。
- 文本可以折叠或定位，但不能被摘要替代。
- 用户可以在同一屏里比较两个或多个方向。
- 代码 diff 如果存在，只作为附属信息。

### 3.4 允许继续讨论，而不是只能选胜者

设计阶段通常不会马上选一个 winner。用户更可能需要：

- 让 A 反驳 B
- 让 B 回应 A 的风险点
- 要求两个方案都考虑成本
- 让系统融合两个方案
- 基于某个方向继续细化
- 等设计稳定后再进入实现

因此，Design Arena 的主要动作不应该是 `Promote`，而应该是讨论和推进：

- `Ask follow-up`
- `Challenge this`
- `Compare`
- `Synthesize`
- `Continue with this`
- `Start implementation from this`

### 3.5 Workspace-backed，但不默认提交

Design Arena 不应该被设计成纯文本聊天。它仍然需要为每个 attempt 创建独立 workspace / worktree / session：

- workspace 提供现有对话、工具调用、日志、上下文读取和后续继续实现的承载对象。
- worktree 提供隔离环境，避免多个 agent 在同一个工作目录里互相影响。
- session 保存 agent 的完整 conversation timeline，Arena 首页可以直接并排展示这些 timeline。

但是，Design Arena 的默认执行策略必须和 Implementation Arena 区分开：

- 默认不要求 agent 修改代码。
- 默认不提醒 agent 创建 commit。
- 默认不自动创建 commit。
- 默认不 push。
- 默认不创建 PR。
- 默认不进入 promote / merge 流程。

如果 agent 在方案讨论过程中为了理解问题产生了本地改动，这些改动只能作为附属状态展示。页面不能因为存在 diff 就把该 attempt 当作实现结果，也不能因为没有 diff 就认为 attempt 没有输出。

## 4. 两种模式

### 4.1 Design Arena

Design Arena 是默认模式。

特点：

- 为每个 attempt 创建独立 workspace / worktree / session。
- worktree 用作隔离执行环境和上下文读取环境，不默认代表实现产物。
- 默认不要求创建代码变更。
- 默认不提醒或要求 agent 创建 commit。
- 默认不自动创建 commit。
- 默认不创建 PR。
- 默认不进入 promote/merge 流程。
- agent 输出自由文本方案。
- Arena 首页展示多个方案文本。
- 用户可以追问、反驳、融合、继续细化。
- 只有用户明确选择“开始实现”或“从此 attempt 生成提交”时，才进入实现或提交阶段。

Design Arena 的目标是帮助用户回答：

> 我应该采用哪个设计方向？

### 4.2 Implementation Arena

Implementation Arena 是第二阶段或高级模式。

特点：

- 创建多个 workspace 或 worktree。
- 每个 attempt 可以修改代码。
- 对比 diff、测试结果、运行状态。
- 用户选择一个实现结果进入 promote/PR/merge 流程。

Implementation Arena 的目标是帮助用户回答：

> 哪个实现结果更适合合并？

这两个模式不应该混在一起。它们都可以使用 workspace / worktree，但默认目标不同：Design Arena 的 worktree 是讨论环境，Implementation Arena 的 worktree 是实现环境。混在一起会造成当前 v1 的问题：用户想看思路，系统却展示 diff；用户要求不提交，系统却在临时分支产生提交对象。

## 5. 推荐产品流

### 5.1 启动

用户点击 `Start Arena` 后，先选择模式：

- `Design Arena`：默认推荐，用于方案竞争和设计讨论。
- `Implementation Arena`：用于已经明确需求后，让多个 agent 直接实现。

如果只有一个入口，也应该默认进入 Design Arena。

### 5.2 Design Arena 流程

1. 用户输入问题或需求。
2. 选择参与 agent。
3. 系统创建一个 design arena group。
4. 系统为每个 agent 创建独立 workspace / worktree / session。
5. 每个 agent 在自己的隔离环境中读取必要上下文，输出自由文本方案。
6. Arena 首页并排展示各 attempt 的 conversation timeline。
7. 用户可以继续追问或要求互相反驳。
8. 用户可以要求系统生成综合总结。
9. 用户选择一个方向后，点击 `Start implementation from this`，或者显式要求基于某个 attempt 创建提交。

### 5.3 Implementation Arena 流程

1. 用户已经有明确方案或需求。
2. 用户选择多个 agent。
3. 系统创建多个 workspace。
4. 每个 agent 实现。
5. Arena 首页展示实现摘要、测试状态、关键 diff。
6. 用户选择一个结果进入 promote/PR/merge。

## 6. Design Arena 首页信息架构

Design Arena 首页应该优先展示文本内容，而不是 diff 数字。

### 6.1 基础形态：并排对话框

Design Arena 的基础 UI 应该是两个或多个并排的对话框。这里的“对话框”不是 modal，而是 conversation pane：

- 每个 pane 对应一个 agent attempt。
- pane 内部展示该 attempt 的完整 conversation timeline。
- 展示方式尽量复用项目现有 workspace 对话实现，包括消息气泡、工具调用、agent 输出、错误状态、继续输入等基础体验。
- 用户不需要先点进详情页才能看到方案正文。
- 对话正文是主内容；文件 diff、统计数字、摘要、标签都是附属内容。

两个 agent 竞争时，页面应该像“两个 workspace 对话窗口并排放在同一个 Arena 页面里”。这比“两个结果卡片”更符合 Design Arena 的定位，也能最大程度保持与项目现有交互模型一致。

### 6.2 每个对话框建议包含

每个 attempt 对话框建议包含：

- agent 名称
- 状态：thinking / completed / failed
- 完整自由文本对话正文
- 工具调用和执行过程的折叠展示
- 继续追问
- 要求反驳其他方案
- 基于此方案开始实现

### 6.3 页面级操作

页面级操作建议包含：

- `Compare responses`
- `Synthesize`
- `Ask all`
- `Start implementation`

其中 `Compare responses` 和 `Synthesize` 是辅助动作，不是强制结构化。系统可以基于自由文本生成一段新的主持人总结，但不能要求原始 agent 按固定格式输出。

## 7. 状态语义

必须区分以下状态：

- agent execution status：agent 是否还在运行。
- arena attempt status：该 attempt 在竞技场中的状态。
- workspace status：是否存在 worktree、是否归档、是否 promoted。
- git status：是否有本地改动、本地 commit、PR、push。

v1 把这些状态混在一起，导致用户看到 Running 但 agent 实际已经结束。

Design Arena 尤其不应该把“是否有 diff”当作是否有结果的判断依据。没有 diff 仍然可能有完整方案。

## 8. “提交”语义

Design Arena 默认不应产生代码提交。这里的“提交”不仅指后端不要自动运行 `git commit`，也包括不要通过 executor 的默认行为去提醒或推动 agent 提交。

当前系统中，某些 executor 会在回合结束后检查未提交改动，并提示 agent 创建 commit。例如 Codex 的 commit reminder 会在发现 uncommitted changes 后追加一条“请提交”的用户消息；Claude 的 stop hook 也可能在发现未提交改动时阻止结束并要求处理。这类行为在普通 workspace 中可能合理，但在 Design Arena 中会破坏“不默认提交”的语义。

因此，Design Arena 启动 agent 时应该使用独立执行策略：

- 关闭 commit reminder。
- prompt 中明确说明当前目标是方案讨论，不需要提交。
- `git commit`、push、PR 创建等动作应当需要用户显式确认，或至少在 supervised / plan 权限下被拦截。
- 未提交改动可以展示为附属 git status，但不能自动升级为提交。
- `Start implementation from this` 可以继续使用同一个 workspace / worktree，但应在进入实现阶段时重新声明提交策略。

Implementation Arena 如果需要在临时分支记录结果，UI 必须明确说明：

- 是否修改了主分支：否。
- 是否创建本地临时提交：可能。
- 是否创建 PR：否，除非用户明确操作。
- 是否 push 到远程：否，除非用户明确操作。
- Promote 的后果是什么。
- Dissolve 会清理什么。

“不提交”对用户来说通常表示“不进入主分支、不创建 PR、不推送、不影响原仓库”。如果系统内部为了记录结果生成临时提交，需要在 UI 上换个词解释清楚，避免让用户觉得被欺骗。

## 9. v2 非目标

Design Arena v2 不追求：

- 自动给方案打分。
- 强制 agent 输出结构化表格。
- 让 agent 必须互相阅读对方全部内容。
- 默认把 workspace / worktree 里的改动当作最终实现结果。
- 默认产生 commit。
- 默认 promote。
- 默认合并。

这些能力可以后续增加，但不能作为第一版 Design Arena 的核心约束。

## 10. 一句话定位

AI Arena v2 是一个多 agent 设计讨论和方案决策工具。

它先帮助用户形成方向，再让用户决定是否进入实现。
