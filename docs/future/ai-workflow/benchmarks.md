# AI Workflow — 对标项目清单（Benchmarks）

> 状态：Draft · 创建于 2026-05-08 · 调研基础：super-search-skill 三通道（Exa + Tavily + Grok）2 轮共 91 条结果
>
> **用途**：列出可 clone 学习的开源项目，按"画布编辑器 / 看板 / 多 agent 编排 / 工作流"维度分类，每条标注**值得偷什么 + clone 优先级**。
>
> **覆盖时间窗**：2025–2026，重点补充 2026-05 之后新出现的项目（前一轮 [`../future_task.md`](../future_task.md) §2 已沉淀过 46 条，本表不再重复"通用看板"类，专注 workflow / 节点 / 编排维度）。
>
> **clone 路径建议**：在仓库外建一个 `~/research/ai-workflow-benchmarks/` 目录统一 clone，避免污染本仓库。

---

## 0. 优先 clone 顺序（Top-10，按"对本 spec 启发度"排序）

| # | 项目 | 类别 | 必看的功能 |
|---|---|---|---|
| 1 | [`smogili1/circuit`](https://github.com/smogili1/circuit) | B | **直接同类**：drag-and-drop 工作流跑 Claude Code + Codex，节点 + 实时 streaming，几乎是本 spec 的成品参考 |
| 2 | [`nodetool-ai/nodetool`](https://github.com/nodetool-ai/nodetool) | B | 节点编辑器最完整的 OSS：自定义节点协议、本地优先、跨平台、多模态 |
| 3 | [`langchain-ai/langgraph-studio`](https://github.com/langchain-ai/langgraph-studio) | C | **运行时可视化**调试器：时间旅行、断点、节点单步、变量检查 |
| 4 | [`stravu/crystal`](https://github.com/stravu/crystal) | D | 并行 Claude Code + worktree 桌面 dashboard 的成熟实现 |
| 5 | [`iOfficeAI/AionUi`](https://github.com/iOfficeAI/AionUi) | C | Gemini/Claude Code 桌面 GUI（Electron），多 agent 多会话；中文 README |
| 6 | [`FlowiseAI/Flowise`](https://github.com/FlowiseAI/Flowise) | B | **React Flow + LangChain** 的工业级范例；DeepWiki 已有 canvas 渲染逐行解析 |
| 7 | [`langgenius/dify`](https://github.com/langgenius/dify) | B | Workflow / Chatbot / Agent **三种模式分离**的产品定位经验 |
| 8 | [`comfyanonymous/ComfyUI`](https://github.com/comfyanonymous/ComfyUI) | F | 节点编辑器 UX 王者：键盘搜索建节点、节点市场、模板分享 |
| 9 | [`firecrawl/open-agent-builder`](https://github.com/firecrawl/open-agent-builder) | B | 节点 + Loop + Agent 配置面板的现代实现，附完整 blog 拆解 |
| 10 | [`johannesjo/parallel-code`](https://github.com/johannesjo/parallel-code) | A | Arena 概念发明者；528⭐；Electron + SolidJS |

> **极简起步**：只 clone 1（circuit）+ 3（langgraph-studio）+ 6（Flowise）三个就能覆盖 90% 设计灵感。

---

## A. 多 agent 编码看板（直接同类）

> 上一轮 `future_task.md` §2.1 已收录的 9 项不重复。本节只补**新发现 + 节点/工作流相关**的部分。

### A-1. [`BloopAI/vibe-kanban`](https://github.com/BloopAI/vibe-kanban) （上游，已 sunset）

- **Stars**：原 ~10k 量级（已存档），本仓库的母体
- **Stack**：Rust + React + Tauri
- **偷什么**：本仓库就是 fork，无须再 clone

### A-2. [`saltbo/agent-kanban`](https://github.com/saltbo/agent-kanban) ⭐ 192

- **Site**：https://agent-kanban.dev/
- **Stack**：TS + Cloudflare Pages
- **定位**："Agent-first task board, Mission control for your AI workforce"
- **偷什么**：
  - Agent 加密身份（Ed25519）的设计（虽然本 spec 决定不做，但值得看 architecture）
  - Leader / Worker / Daemon 四角色抽象 → 启发 Workflow 节点角色化设计
  - "Mission control" 信息架构：单页里如何同时塞看板 + agent 状态 + 日志

### A-3. [`kdlbs/kandev`](https://github.com/kdlbs/kandev) ⭐ ~50

- **Stack**：Go + TS 服务端
- **关键**：多 provider 用 ACP 抽象；本地 / Docker / 远程三种 runtime
- **偷什么**：ACP 抽象层（即使不实现协议本身，思路可借鉴）

### A-4. [`DanWahlin/ai-agent-board`](https://github.com/DanWahlin/ai-agent-board)

- **Stack**：—
- **偷什么**：drag-and-drop + 多 agent + worktree 隔离的 web 实现；参考其卡片 → workspace 流转

### A-5. [`TechDufus/openkanban`](https://github.com/TechDufus/openkanban)

- **Stack**：Go TUI
- **偷什么**：每卡片 worktree + 内嵌终端的本地化方案；TUI 可看其极简信息密度

### A-6. [`appsoftwareltd/vscode-agent-kanban`](https://github.com/appsoftwareltd/vscode-agent-kanban)

- **Stack**：VS Code 扩展
- **偷什么**：与 IDE 集成的入口形态（本仓库 P3 Windows 集成可参考）

### A-7. [`automagik-dev/forge`](https://github.com/automagik-dev/forge)

- **Stack**：TS
- **定位**："Vibe Coding++™" multi-agent kanban + MCP
- **偷什么**：MCP 在 kanban 中的统一入口（与本仓库 T0-2 MCP 面板路线交叉）

### A-8. [`catlog22/Claude-Code-Workflow`](https://github.com/catlog22/Claude-Code-Workflow)

- **Stack**：JSON-driven
- **定位**：multi-agent cadence-team development framework
- **偷什么**：JSON 驱动的 workflow 描述语言（直接对标本 spec 的 graph_json）

### A-9. [`agentclash/agentclash`](https://github.com/agentclash/agentclash)

- **定位**：AI agent 对抗 / clash 平台
- **偷什么**：Arena 的"对抗式"叙事；UI 上"哪个 agent 赢"的呈现

---

## B. 节点式 LLM workflow 编辑器 ⭐核心调研域⭐

### B-1. [`smogili1/circuit`](https://github.com/smogili1/circuit) ⭐⭐⭐ 必看

- **发布**：2026-01
- **定位**："Drag-and-drop agent workflow builder for orchestrating AI agents. Build multi-step pipelines to run Claude Code and OpenAI Codex, featuring real-time streaming"
- **偷什么**：**几乎是本 spec 的成品参考**
  - 节点 → Claude Code / Codex 的实际 spawn 实现
  - 实时 streaming 在节点上的渲染
  - 节点连线如何映射成 prompt chaining
  - 整体 React/Electron 栈
- **优先级**：🔴 第一个 clone

### B-2. [`nodetool-ai/nodetool`](https://github.com/nodetool-ai/nodetool) ⭐⭐⭐

- **定位**："Visual Builder for AI Workflows and Agents"，本地优先（macOS/Win/Linux）
- **偷什么**：
  - 节点扩展协议（如何让用户自定义节点）
  - 多模态节点（图像 / 音频 / LLM 混排）
  - 本地优先 + 跨平台打包
  - 节点市场 / 共享机制
- **clone 重点目录**：`packages/nodetool-core/` 的节点 schema

### B-3. [`FlowiseAI/Flowise`](https://github.com/FlowiseAI/Flowise) ⭐⭐⭐

- **Stars**：~40k+
- **Stack**：React Flow + Node.js + LangChain
- **DeepWiki 友好**：[Canvas & Node Rendering](https://deepwiki.com/FlowiseAI/Flowise/9.2-canvas-and-node-rendering) 已逐行解析渲染逻辑
- **偷什么**：
  - **CanvasNode vs AgentFlowNode 双系统**（chatflow 详细 vs agentflow 简洁）→ 对应本 spec 的 Agent vs 控制流节点
  - inputAnchors / outputAnchors 设计
  - NodeInputHandler 参数动态渲染
  - 内置 200+ 节点的分类法
- **clone 重点目录**：`packages/ui/src/views/canvas/` + `packages/components/nodes/`

### B-4. [`langgenius/dify`](https://github.com/langgenius/dify) ⭐⭐⭐

- **Stars**：~100k+
- **关键设计点**（参考 [Dify Workflows 2026](https://dify-hosting.com/en/guides/dify-workflow/)）：
  - **三种模式分离**：Workflow（确定性管道）vs Chatbot（多轮对话）vs Agent（动态决策） — 本仓库已有 Arena/Workflow 双入口，可借鉴定位话术
  - **节点 native parallel execution**
  - 节点之间的变量系统（命名空间 + 引用）
  - HTTP Request / Code 节点的"逃生通道"设计
- **偷什么**：变量引用 UX（前端 `{{...}}` 自动补全的实现）、Knowledge 节点形态

### B-5. [`langflow-ai/langflow`](https://github.com/langflow-ai/langflow)

- **Stars**：~50k+
- **定位**：开源 LangChain 可视化 canvas + live chat pane
- **偷什么**：边设计 + chat pane 同屏调试体验（"design while testing"）

### B-6. [`n8n-io/n8n`](https://github.com/n8n-io/n8n) ⭐⭐

- **Stars**：~80k+
- **关注**：[最近的 ai-builder commit](https://github.com/n8n-io/n8n/commit/23837499802e8ef31c66f49d664311e2de4df9aa) — Workflow evaluation framework with LLM mock execution（这正是本 spec §10.2 调研项 #7 "回放" 的工业级方案）
- **偷什么**：
  - **重试 / 错误处理 UX**（本 spec V2 失败语义参考）
  - 节点状态色 + 边动画的工业级实现
  - "Mock execution"（在不真跑 LLM 的情况下走完工作流，给前端调试用）

### B-7. [`firecrawl/open-agent-builder`](https://github.com/firecrawl/open-agent-builder) ⭐⭐

- **Blog 长文**：https://www.firecrawl.dev/blog/open-agent-builder
- **偷什么**：
  - **预览面板**：节点跑完实时显示输出，一目了然
  - Loop 节点的 Continue/Break 双出边设计
  - Agent 节点配置 modal：instructions + model selector + tools 三段式
  - `{{lastOutput.address}}` 变量引用语法

### B-8. [`activepieces/activepieces`](https://github.com/activepieces/activepieces)

- **定位**：n8n 替代品，AI Agents & MCPs & Workflow 三件套，280+ MCP servers
- **偷什么**：MCP 节点化的实现（本仓库 T0-2 MCP 面板可借鉴）

### B-9. [`comfyanonymous/ComfyUI`](https://github.com/comfyanonymous/ComfyUI) ⭐⭐⭐

- **Stars**：~80k+
- **虽然是 SD 图像，但是节点 UX 王者**
- **偷什么**：
  - **键盘搜索建节点**（按 `n` 弹搜索）→ 本 spec 应纳入 P2
  - 节点市场（自定义节点生态）
  - 模板分享 .json 文件
  - 节点 group / collapse / mute / bypass 这些"高级用户"操作
  - mini-map + viewport 状态保存
- **必读 docs**：[Custom Nodes 文档](https://docs.comfy.org/development/core-concepts/custom-nodes)

### B-10. [`run-llama/flow-maker`](https://github.com/run-llama/flow-maker)

- **定位**：LlamaIndex 出品的 flow 构造工具
- **偷什么**：与 RAG 强绑定的节点抽象（未来 T2-1 本地 RAG 时可参考）

### B-11. [CC Workflow Studio](https://dev.to/wonderlab/open-source-project-of-the-day-part-14-cc-workflow-studio-visual-ai-workflow-editor-for-4jbe)

- **dev.to 介绍文**：visual AI workflow editor，AI 辅助编辑工作流
- **偷什么**：**AI 帮用户画工作流**（"用自然语言描述 → 自动生成节点图"）—— 这是个独立的 V2 加分项

### B-12. 其他 agentflow 同名项目（命名碰撞，需逐个 clone 看）

- [`yeshuibo/agentflow`](https://github.com/yeshuibo/agentflow)
- [`berabuddies/agentflow`](https://github.com/berabuddies/agentflow)
- [`shouc/agentflow`](https://github.com/shouc/agentflow)
- [`AgentOrchestrator/AgentBase`](https://github.com/AgentOrchestrator/AgentBase)

---

## C. Multi-agent orchestration framework（带 UI）

### C-1. [`iOfficeAI/AionUi`](https://github.com/iOfficeAI/AionUi) ⭐⭐⭐ 用户特别提及

- **Wiki**：https://github.com/iOfficeAI/AionUi/wiki/Getting-Started
- **定位**：Gemini / Claude Code 的桌面 GUI（Electron），多 agent 多会话
- **偷什么**：
  - 桌面 app 怎么管理多个 agent CLI 进程
  - 中文社区的 UX 取向（侧边栏会话列表 + 主区代码 / 对话）
  - 与 Gemini CLI 的具体集成方式（本仓库 executors 已支持，可对照）
- **fork 也看看**：[`JoeWaffen/AionUi`](https://github.com/JoeWaffen/AionUi)

### C-2. [`langchain-ai/langgraph-studio`](https://github.com/langchain-ai/langgraph-studio) ⭐⭐⭐

- **定位**：LangGraph 官方可视化调试器
- **偷什么**：
  - **运行时调试**：时间旅行、断点、节点单步、状态检查
  - 历史 run 回放
  - 节点状态实时高亮（本 spec §7.3 直接对照）
  - State 流转可视化（多节点共享 state 怎么呈现）
- **clone 第一个看 demo 视频**：理解可视化调试器的"卖相"

### C-3. [`VelarIQ/langgraph-studio2`](https://github.com/VelarIQ/langgraph-studio2)

- **定位**：langgraph-studio 的社区改进 fork
- **偷什么**：对官方版的具体改进点

### C-4. Multi-agent 协调器（Claude Code + Codex + Gemini）小项目集

| 项目 | 看什么 |
|---|---|
| [`josstei/maestro-orchestrate`](https://github.com/josstei/maestro-orchestrate) | "maestro" 命名 + 编排策略 |
| [`PrimeLocus/Hydra`](https://github.com/PrimeLocus/Hydra) | 多头 agent 模型 |
| [`Z-M-Huang/claude-codex-gemini`](https://github.com/Z-M-Huang/claude-codex-gemini) | 三大 agent 互调 |
| [`dsifry/metaswarm`](https://github.com/dsifry/metaswarm) | "self-improving multi-agent orchestration framework" |
| [`haoyu-haoyu/Multi-AI-Workflow`](https://github.com/haoyu-haoyu/Multi-AI-Workflow) | Multi-AI orchestration framework for Claude Code |
| [`zetbrush/multiagents`](https://github.com/zetbrush/multiagents) | 三大 agent 编排 |
| [`njbrake/agent-of-empires`](https://github.com/njbrake/agent-of-empires) | "agent of empires" 创意命名，看是否真有图样 |

> 这一组都是小项目，建议先扫 README，找到与本 spec **节点协议**相近的 1-2 个深 clone。

### C-5. Sim Studio / Agentok（React Flow showcase 引用）

- 来自 [React Flow Showcase](https://reactflow.dev/showcase)
- 都是 React Flow 上的 agent 平台
- 偷什么：React Flow 的高级用法（性能、自定义节点、edge 动画）

---

## D. Coding agent dashboard / monitor

### D-1. [`stravu/crystal`](https://github.com/stravu/crystal) ⭐⭐⭐

- **定位**：并行 Claude Code session + worktree 的桌面 dashboard
- **关联品牌**：Nimbalyst（[博客](https://nimbalyst.com/blog/best-tools-for-running-parallel-ai-coding-agents/)，作者写过多篇并行 agent 工具横评）
- **偷什么**：
  - 多 session 同时运行的 desktop UI 布局
  - worktree 自动 cleanup 策略
  - "session manager" 形态（对照 Nimbalyst [session manager 横评](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)）

### D-2. [`nimbalyst/nimbalyst`](https://github.com/nimbalyst/nimbalyst)

- **定位**：组织 Crystal 的核心仓
- **偷什么**：dashboard 设计语言

### D-3. OpenAI Codex App（官方）

- **介绍文**：[Verdent Guide - What Is Codex App?](https://www.verdent.ai/guides/what-is-codex-app)
- **不是开源**，但作为"OpenAI 官方做的 parallel coding agents command center" 形态参考

---

## E. Worktree + agent 调度（无看板）

> 上一轮 `future_task.md` §2.2 已列 15 个，本节只补**新发现**的。

| 项目 | 看什么 |
|---|---|
| [`max-sixty/worktrunk`](https://github.com/max-sixty/worktrunk) | 端口分配 hash_port 算法可参考（避免并行 dev server 冲突） |
| [`raine/workmux`](https://github.com/raine/workmux) | tmux + worktree 组合 |
| [`nekocode/agent-worktree`](https://github.com/nekocode/agent-worktree) | per-agent worktree 模型（不是 per-task） |
| [`coplane/par`](https://github.com/coplane/par) | "CLI for Parallel Worktree & Session Manager" |

**官方权威信号**：
- Claude Code CLI 已内建 `--worktree` + `/batch` skill（[boris_cherny Threads 2026-02](https://www.threads.com/@boris_cherny/post/DWfjtLTFBhu/use-git-worktrees-claude-code-ships-with-deep-support-for-git-worktrees)） — 这意味着**底层 worktree 调度可能被官方覆盖**，本仓库差异化重心要往"画布编辑 + 评审"上移
- Google Cloud 出 [《Run multiple coding agents safely with git worktrees》](https://medium.com/google-cloud/run-multiple-coding-agents-safely-with-git-worktrees-c2d237dbd6b2)

---

## F. 通用工作流引擎 / 自动化（UX 参考）

### F-1. n8n（B-6 已列）—— 节点 + 边 + 触发器的工业级范式

### F-2. ComfyUI（B-9 已列）—— 节点编辑器 UX 王者

### F-3. Make.com / Zapier（闭源）—— trigger 范式参考

- 不能 clone，但 trigger 抽象（webhook / cron / event / kanban_state_change）的命名借它们的

### F-4. Activepieces（B-8 已列）

---

## G. AI Arena / parallel head-to-head 评测平台

> 与本仓库 Arena v1/v2 直接相关。

### G-1. [`johannesjo/parallel-code`](https://github.com/johannesjo/parallel-code) ⭐ 528

- 已在 `future_task.md` §2.1 列出
- 偷什么：N 栏并排 diff 的 UX 截图（本 Arena v1 已实现，但还可继续优化）

### G-2. [`xlang-ai/computer-agent-arena`](https://github.com/xlang-ai/computer-agent-arena)

- **定位**：computer use agent 的对抗评测平台
- **偷什么**：Arena 的"评测 / 评分"系统形态（虽然本 spec 决定不做自动评分，但参考其 UX 防止未来需要时绕远路）

### G-3. [`Software-Engineering-Arena/SWE-Model-Arena`](https://github.com/Software-Engineering-Arena/SWE-Model-Arena)

- **定位**：SWE-bench 风格的多模型对决平台
- **偷什么**：题库 / leaderboard 形态

### G-4. [`agentclash/agentclash`](https://github.com/agentclash/agentclash)（A-9 已列）

---

## H. 横评 / 综述长文（非项目，但必读）

| 文章 | 价值 |
|---|---|
| [9 Open-Source Agent Orchestrators for AI Coding (2026) — augmentcode](https://www.augmentcode.com/tools/open-source-agent-orchestrators) | 直接对标本仓库的横评，必读 |
| [Best Tools for Parallel AI Coding Agents (2026) — Nimbalyst](https://nimbalyst.com/blog/best-tools-for-running-parallel-ai-coding-agents/) | 并行调度工具横评 |
| [Best Claude Code & Codex Session Managers (2026) — Nimbalyst](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/) | session manager 形态 |
| [Multi-agent orchestration for Claude Code in 2026 — Shipyard](https://shipyard.build/blog/claude-code-multi-agent/) | 编排策略 |
| [Open Source AI Agent Platform Comparison: n8n/Dify/LangGraph/Coze/RAGFlow — Jimmy Song](https://jimmysong.io/blog/open-source-ai-agent-workflow-comparison/) | 平台横评 |
| [Best AI Agent Framework (2026) — 40+ Compared — xpay](https://www.xpay.sh/resources/agentic-frameworks/) | 40+ framework 横评 |
| [Top AI GitHub Repositories in 2026 — ByteByteGo](https://blog.bytebytego.com/p/top-ai-github-repositories-in-2026) | 整体格局 |
| [Flowise vs Dify vs n8n — Jahanzaib](https://www.jahanzaib.ai/blog/flowise-vs-dify-vs-n8n-ai-agents) | 三者对比，节点 UX 差异讲得最透 |
| [The 7 Best Low-Code/No-Code AI Builders in 2026 — Stack-AI](https://www.stack-ai.com/blog/best-no-code-ai-builders) | 低代码总览 |
| [How to Run Parallel AI Coding Agents With Git Worktrees — MindStudio](https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees/) | 并行调度技术细节 |

---

## I. React Flow 学习资源（做画布必读）

| 资源 | 用途 |
|---|---|
| [xyflow.com](https://xyflow.com/) | 官网（React + Svelte 双版） |
| [reactflow.dev](https://reactflow.dev/) | React 版主站 |
| [reactflow.dev/showcase](https://reactflow.dev/showcase) | 看 Agentok / Sim Studio / FlowiseAI 等怎么用 |
| [reactflow.dev/ui/templates/ai-workflow-editor](https://reactflow.dev/ui/templates/ai-workflow-editor) | Pro 模板：AI Workflow Editor（Next.js + AI SDK + Zustand）— 直接对标 |
| [reactflow.dev/ui/templates/workflow-editor](https://reactflow.dev/ui/templates/workflow-editor) | Pro 模板：通用 Workflow Editor |
| [Drag and Drop example](https://reactflow.dev/examples/interaction/drag-and-drop) | 节点拖拽入画的最小示例 |
| [Synergy Codes — React Flow Everything You Need](https://www.synergycodes.com/blog/react-flow-everything-you-need-to-know) | 入门到进阶 |
| [xyflow blog: LLMs.txt + Agent Skills](https://xyflow.com/blog/llms-txt-agent-skills-ai-development) | 官方对 AI 用例的指南 |
| [DeepWiki: Flowise Canvas & Node Rendering](https://deepwiki.com/FlowiseAI/Flowise/9.2-canvas-and-node-rendering) | 看真实项目怎么用 React Flow |

---

## J. clone 后的"逐项学习问题清单"

每 clone 一个项目，统一回答以下 8 个问题（这样所有项目可以横向对比）：

1. **节点协议**：节点的 schema 长什么样？输入输出怎么声明？
2. **数据流契约**：节点之间传什么类型的数据？是文本、JSON、还是 typed schema？
3. **变量引用**：下游节点怎么引用上游输出？语法 / 自动补全实现？
4. **执行调度**：DAG runner 在哪里？怎么处理并行 / 失败 / 重试？
5. **实时反馈**：节点状态怎么推到前端？SSE / WebSocket / 轮询？
6. **持久化**：图（template）和运行（run）分别怎么存？
7. **节点扩展**：用户怎么添加自定义节点？
8. **特色亮点**：这个项目最值得偷的 1 个独有功能是什么？

回答全部沉淀到 `docs/future/ai-workflow/learnings/<project-name>.md`。

---

## K. 调研缺口（暂时未答）

以下问题本轮搜索未找到决定性答案，需要 clone 后亲眼看：

- **LangGraph Studio** 是否真支持本地（非 cloud）模式 + worktree 隔离？
- **circuit** 的执行单元是 subprocess 还是 API 调用？支不支持本地 Claude Code CLI？
- **AionUi** 的中文 README 是否有 workflow / 节点编辑器特性？还是单纯 chat GUI？
- **n8n 的 ai-builder 评估框架**（mock execution）是不是可以为本仓库 §10.2 #7「回放」复用？
- ComfyUI 的"键盘搜索建节点"在 React Flow 上有现成实现吗？还是要自己写？

---

## 修订历史

| 日期 | 修订点 | 来源 |
|---|---|---|
| 2026-05-08 初稿 | 三通道两轮搜索后沉淀 | super-search-skill (Exa+Tavily+Grok) |
