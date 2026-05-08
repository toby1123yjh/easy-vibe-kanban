# AI Workflow — 对标项目分析（Findings）

> 状态：First Pass Done · 创建于 2026-05-08 · 配套：[`../benchmarks.md`](../benchmarks.md)
>
> **方法**：clone 后扫 README + CLAUDE.md/AGENTS.md + 关键源文件路径，每项目按 8 问回答（基于一手代码 + 二手 README，不靠想象）。
>
> **完成度**：第一遍是"骨架级"答案——能让你 1) 知道哪个项目最该深 clone 看 2) 知道每个项目的核心抽象长什么样。第二遍（按需）才会逐文件阅读 executor 实现。

---

## 0. clone 状态总表（11/11 完成）

| # | 项目 | 路径 | 大小 | 备注 |
|---|---|---|---|---|
| 1 | smogili1/circuit | `circuit/` | 3.7M | ⭐ 最匹配本 spec |
| 2 | nodetool-ai/nodetool | `nodetool/` | 234M | desktop + cloud 双形态 |
| 3 | langchain-ai/langgraph | `langgraph/` | ~80M | 替代 langgraph-studio（已不可访问） |
| 4 | VelarIQ/langgraph-studio2 | `langgraph-studio2/` | ~10M | LangGraph Studio fork（社区） |
| 5 | stravu/crystal | `crystal/` | 17M | ⚠️ **2026-02 已 deprecated → Nimbalyst** |
| 6 | iOfficeAI/AionUi | `AionUi/` | 430M | Electron，多 agent，**有 cron + 远程访问** |
| 7 | FlowiseAI/Flowise | `Flowise/` | 71M | agentflow 节点 16 个，工业级 |
| 8 | langgenius/dify | `dify/` | 154M | 三模式分离 |
| 9 | comfyanonymous/ComfyUI | `ComfyUI/` | 52M | 节点 UX 王者 |
| 10 | firecrawl/open-agent-builder | `open-agent-builder/` | 5.3M | Next.js + Convex + Playwright e2e |
| 11 | johannesjo/parallel-code | `parallel-code/` | 107M | Electron + SolidJS |

> **重大变更**：`langchain-ai/langgraph-studio` 仓库已删除/迁移；本表用 `langgraph` 主仓 + `VelarIQ/langgraph-studio2` fork 替代。

---

## 1. ⭐⭐⭐ smogili1/circuit （最匹配本 spec，99% 撞型）

> 阅读建议：**这是必读**。circuit 几乎实现了本 spec 1.0 想要的全部功能；后续设计冲突时可直接参考其方案。

- **stack**：Node.js + Express + Socket.io（后端）/ React + Vite + Tailwind + React Flow + Zustand（前端）
- **入口**：
  - 引擎：`circuit/backend/src/orchestrator/engine.ts` → `class DAGExecutionEngine extends EventEmitter`
  - 引用：`circuit/backend/src/orchestrator/references.ts`
  - 节点 schema：`circuit/backend/src/schemas/nodes/`
  - 节点执行：`circuit/backend/src/orchestrator/executors/`
  - 类型：`circuit/backend/src/workflows/types.ts`
  - 前端 store：`circuit/frontend/src/stores/workflowStore.ts`
  - 前端 socket：`circuit/frontend/src/hooks/useSocket.ts`

#### Q1 节点协议
schema-first 设计。每个节点用 `defineSchema({ meta, properties })` 定义：
- `meta`：type / displayName / description / icon / color / borderColor / category（'agents' | 'flow'）
- `properties`：每个字段是个 PropertyDef，有 type（string/number/boolean/select/multiselect/textarea/code/reference/inputSelector/**mcp-server-selector**/schemaBuilder/group/array/conditionRules）+ default + showWhen 条件渲染
- 已实现节点：`input` `output` `claude-agent` `codex-agent` `condition` `merge` `javascript` `approval` `bash`

→ **比本 spec §4 多了**：`merge` 显式合并节点、`bash` 任意 shell 命令节点

#### Q2 数据流契约
**字符串 + 结构化输出双轨**：
- 默认节点输出是 string（`agent` 节点的最后一条 message）
- 但有 `AgentOutputFormat = 'text' | 'json'`，agent 可以输出 schema-validated JSON
- `ExecutionContext` 同时维护 `nodeOutputs`（节点输出）和 `variables`（共享变量）

→ 本 spec 决定 V1 纯文本，与 circuit 的"text 默认 + json 可选"一致；V2 加 JSON 时可直接抄 schema 校验

#### Q3 变量引用
**`{{NodeName.field.path}}` 语法 + 数组访问 `items[0]`**：
- `parseReference()` 用正则 `^\{\{([^.]+)\.(.+)\}\}$` 解析
- `findReferences()` 全文扫所有 `{{...}}`
- `interpolateReferences()` 在 prompt 渲染前替换
- 嵌套对象 + 数组下标都支持
- 节点 properties 加 `supportsReferences: true` 标志位告诉 UI 启用 `{{}}` 高亮 + 自动补全

→ **比本 spec §3.1 强**：本 spec 只有 `{{nodes.x.output}}`，circuit 有任意 JSON 路径

#### Q4 执行调度
**拓扑 + 并行分支 + 事件驱动**：
- `DAGExecutionEngine extends EventEmitter`
- 每个 running node 有自己的 `AbortController`，存在 `runningNodeAbortControllers: Map`，可单节点取消
- 节点状态：`pending | running | complete | error | skipped | waiting`
- input 节点是特殊路径（不走 executor registry）
- 其他节点都通过 `executorRegistry`（注册表模式 = node type → executor handler）
- **失败语义**：单节点失败抛 `ExecutionError`，但其他并行分支可以继续（看它们是否依赖失败节点）

→ 本 spec §8.2 的"调度循环"基本就是 circuit 的实现

#### Q5 实时反馈
**Socket.io WebSocket**：
- 后端 `engine.emit('event', { type: 'execution-start' | ... })` → 前端 `useSocket()` hook 订阅
- 事件类型：`execution-start` / `node-status` / `node-output` / `agent-token` / `execution-complete` 等

→ 本 spec §6.2 的 SSE 事件设计可直接照搬，把 SSE 换 WS（或保持 SSE）即可

#### Q6 持久化
**YAML 文件**：
- `workflows/storage.ts` 用 YAML 存模板
- 单文件 = 一个 workflow，便于"vibe code workflows"（即用 git 管理 workflow）
- 执行历史落到 `.workflow-outputs/<executionId>/`

→ 本 spec §5 用 SQLite 表 + graph_json 列；circuit 是文件，更适合 git，但本仓库已有 SQLite 设施所以表结构方案更顺

#### Q7 节点扩展
**executor registry**：
- 每个节点类型 = 一个 schema + 一个 executor handler
- 注册到 `executorRegistry.register('claude-agent', ClaudeAgentExecutor)`
- 用户加新节点 = 加一对（schema + executor），无修改核心引擎

→ 本 spec 应直接抄这个模式，否则后期加节点会改到 runner

#### Q8 一句话亮点 ⭐
**checkpoint + replay**：`CheckpointState` + `executeFromCheckpoint(input, checkpoint, replayNodeIds, inactiveNodeIds)`，可以**从任意节点重启执行**，前置节点的输出从 checkpoint 恢复，被标记为 inactive 的节点跳过。`REPLAY_FEATURE_IMPLEMENTATION.md` 文件名暗示这是后期重大功能。

→ 本 spec §10.2 #7「运行视图回放形态」直接有答案：用 checkpoint state，跑完保留所有 node_executions，重启时恢复

#### 额外彩蛋

- **conditions 数组 + AND/OR joiner + 11 个 operator**（equals / not_equals / contains / not_contains / greater_than / less_than / >= / <= / is_empty / is_not_empty / regex）—— 比本 spec §4.2 单 expression 强
- **rejection handler config**：approval 节点可配 `{ enabled, continueSession, feedbackTemplate, maxRetries, onMaxRetries: 'fail'|'skip'|'approve-anyway' }` —— 本 spec §4.2 Human Gate 简化太多
- **edge type**：`'default' | 'approval' | 'rejection'` —— 把分支语义编码到边上
- **conversation mode**：`'fresh' | 'persist'` —— agent 多次调用是否保留上下文，本 spec 漏了
- **MCP server 选择器**作为 property type 内置 —— 本仓库 T0-2 MCP 面板可与此打通

---

## 2. ⭐⭐⭐ langgenius/dify

> 阅读建议：扫架构文档，看"workflow vs chatbot vs agent"三模式如何在产品上分离。

- **stack**：Python（FastAPI）后端 + Next.js 前端
- **关键目录**：
  - `dify/web/app/(commonLayout)/workflow/` 前端 workflow 编辑器
  - `dify/api/core/workflow/` 后端 workflow 引擎
  - `dify/api/core/agent/` agent 实现

#### Q1–Q8 简版

- **Q1 节点**：节点 schema 在 `core/workflow/nodes/`，每个 NodeType 有 `node.py` + `entities.py`，节点很多（LLM / Code / HTTP Request / Knowledge Retrieval / IF/ELSE / Iteration / Variable Aggregator / Document Extractor / List Operator / ...）
- **Q2 数据流**：**结构化变量**（NamedSchema），节点之间传 typed dict；string 是 typed 之一
- **Q3 引用**：`{{#node_id.field#}}` 语法（用 `#` 包裹更不易碰撞）
- **Q4 调度**：图引擎在 `core/workflow/graph_engine/`，用 NetworkX 风格的 graph 模型 + 拓扑跑
- **Q5 实时**：SSE stream（`/console/api/workflows/.../sse`）
- **Q6 持久化**：PostgreSQL，workflow_runs / workflow_node_executions 表
- **Q7 扩展**：插件系统（python module + manifest）
- **Q8 亮点**：**Variable Aggregator 节点** —— 显式合并多入度的 typed 变量；**Iteration 节点**（for-each over list）—— 比 circuit 的 merge 更结构化

→ **本 spec 应该参考其变量命名规则**（`{{#nodeId.field#}}`），避免普通 mustache 与 prompt 内容字面 `{{ }}` 冲突

---

## 3. ⭐⭐⭐ FlowiseAI/Flowise

> 阅读建议：扫 `packages/components/nodes/agentflow/` 了解 16 个节点的分类法。

- **stack**：React Flow（前端）+ Express + LangChain（后端）+ Sqlite/Postgres
- **agentflow 节点（重点看）**：
  - **核心**：`Start` / `Agent` / `LLM` / `Tool` / `Retriever` / `HTTP` / `CustomFunction` / `DirectReply`
  - **流程控制**：`Condition` / `ConditionAgent` / `Iteration` / `Loop`
  - **协作**：`HumanInput` / `ExecuteFlow`（嵌入子 flow）
  - **辅助**：`StickyNote`（画布注释）

#### Q1–Q8 简版

- **Q1 节点**：`INode` 接口 with `inputs: INodeParams[]`, `outputs: INodeOutputsValue[]`
- **Q2 数据流**：基于 LangChain，传 `IMessage[]` / typed objects
- **Q3 引用**：`$flow.NodeID.fieldName` 语法
- **Q4 调度**：基于图遍历 + LangChain runnable 链
- **Q5 实时**：SSE（`IServerSideEventStreamer`）
- **Q6 持久化**：DB（typeorm）+ JSON `flowData` 列
- **Q7 扩展**：Custom Tool / Custom Function 节点 + nodes 目录加文件即可
- **Q8 亮点 ⭐**：**ConditionAgent 节点 = LLM 驱动的条件分支**！见 `ConditionAgent/matchScenario.ts`：让 LLM 看上游输出 + scenarios 列表，自然语言匹配场景；fallback 链：精确匹配 → 前缀匹配 → 子串匹配 → 兜底走最后一个 scenario

→ **这是本 spec 漏的一个超关键节点类型**：`ConditionAgent`（让 LLM 决定走哪条分支）。比 JS 表达式更适合"agent 输出是否满足某个语义条件"

→ 另外 `StickyNote` 是个被低估的 UX：让用户在画布上写说明 / TODO，画布即文档

---

## 4. ⭐⭐⭐ comfyanonymous/ComfyUI

> 阅读建议：看一个节点定义足够。它的 UX 设计影响了整个节点编辑器界。

- **stack**：Python 后端 + 自研 LiteGraph 前端
- **入口**：根目录 `nodes.py`（核心节点都在这）

#### 节点示例（`CLIPTextEncode`）

```python
class CLIPTextEncode(ComfyNodeABC):
    @classmethod
    def INPUT_TYPES(s) -> InputTypeDict:
        return {
            "required": {
                "text": (IO.STRING, {"multiline": True, "dynamicPrompts": True, "tooltip": "..."}),
                "clip": (IO.CLIP, {"tooltip": "..."})
            }
        }
    RETURN_TYPES = (IO.CONDITIONING,)
    OUTPUT_TOOLTIPS = ("...",)
    FUNCTION = "encode"
    CATEGORY = "conditioning"
    DESCRIPTION = "..."
    SEARCH_ALIASES = ["text", "prompt", "text prompt", "positive prompt", ...]

    def encode(self, clip, text):
        ...
```

#### Q8 一句话亮点 ⭐⭐⭐

- **`SEARCH_ALIASES = [...]`** —— 节点的多个搜索关键词，画布上按 `n` 弹搜索框时用这个匹配。这是本 spec §10.2 #10「键盘搜索建节点」的现成方案，**直接抄过来作为我们 Node schema 的一个字段**
- **typed I/O**（`IO.STRING / IO.CLIP / IO.CONDITIONING`）—— 节点的 socket 颜色按类型区分；连线时类型不匹配自动拒绝
- **`OUTPUT_TOOLTIPS` + `DESCRIPTION`** —— 鼠标悬停立刻看说明，0 学习成本

→ **本 spec 应抄**：`search_aliases`、`tooltip`、`output_tooltips` 三个字段加进 node schema

---

## 5. ⭐⭐ nodetool-ai/nodetool

> 阅读建议：看 `ARCHITECTURE.md` 了解 desktop + cloud 双形态如何共享代码。

- **stack**：Python 引擎 + Electron + 跨平台
- **License**：AGPL v3 ⚠️（不能直接抄代码，但思路可借鉴）
- **关键目录**：`nodetool/electron/` 桌面端、`nodetool/chat_app/` web 端、`nodetool/docs/`

#### Q8 一句话亮点

- **同一份 workflow 在 desktop 跑本地模型 / 在 cloud 跑 BYOK 云模型** —— 工作流可移植
- **20+ Discord 用户社区** —— 节点市场（custom nodes）已成型
- **CHANGELOG.md** 详尽，可以学怎么演进节点协议而不破坏老 workflow

→ 本仓库本地优先 + Win 优先，与 nodetool 的 "Studio" 形态对齐；可以参考其打包方案

---

## 6. ⭐⭐ firecrawl/open-agent-builder

> 阅读建议：`scripts/test-workflow.js` + 8 个 `test:*` 模板（simple-scraper / web-search / price-tracker / content-research / data-extractor / pagination-scraper / approval-workflow / agent-with-tools）= 8 份「真实工作流模板」可以直接学

- **stack**：Next.js + Convex（实时 DB）+ Playwright e2e + AI SDK
- **License**：MIT

#### Q8 一句话亮点

- **Playwright 端到端测试覆盖每个工作流模板** —— `tests/comprehensive-workflow-tests.spec.ts` + `tests/template-verification.spec.ts` + `tests/streaming-tests.sh`，是本 spec §9 验收标准的实现参考
- **8 个开箱即用模板** —— scraping / search / approval / agent-with-tools，本仓库 V1 也应该出 3-5 个模板让用户开箱即跑

→ 本 spec §10.2 #6「系统内置模板 vs 用户自建」答案明确：**两者都做，先内置 5 个跑通**

---

## 7. ⭐⭐ iOfficeAI/AionUi （定位转向：不是 workflow，但有意外发现）

> 阅读建议：扫 README，看其多 agent 集成 + 远程访问方案。

- **stack**：Electron（`electron.vite.config.ts`）+ Bun + 自研 agent 引擎（aionrs，Rust）
- **License**：Apache 2.0
- **形态**：**Cowork chat 应用**，不是 DAG / 节点编辑器 ❌

#### 但有几个对本仓库非常重要的"意外发现"

1. **多 agent 自动检测**：自动识别 PATH 上的 Claude Code / Codex / Qwen Code / Goose AI / OpenClaw / Augment Code / CodeBuddy / Kimi CLI / OpenCode / Factory Droid / Copilot / Qoder CLI / Mistral Vibe / Nanobot / Snow CLI / Kiro / Hermes Agent / Cursor Agent —— 共 20+。本仓库 executors 目前固定列表，可学其 PATH 探测 + 统一接入策略
2. **Cron 调度**：内建 cron 跑 24/7 unattended —— 本 spec §3.2 V2 trigger 计划里 `cron` 来源的现成参考
3. **远程访问**：WebUI + Telegram / Lark / DingTalk / WeChat / WeCom 五种 IM 触发 —— 这是本 spec **完全没考虑**的角度，但对 "去中心化触发" 是重要补充。可考虑作为 `trigger_source` 的扩展
4. **20 个内建 assistant**（Cowork / PPT / Word / Excel / Academic Paper Writer / Financial Model / Pitch Deck / Dashboard / ...） —— **垂直化模板**思路

→ AionUi 不是 workflow 编辑器，但其**触发器丰富度**和 **agent 适配广度**是本仓库可学的

---

## 8. ⭐ langchain-ai/langgraph + VelarIQ/langgraph-studio2

> 阅读建议：langgraph 是底层，langgraph-studio 是 UI（已并入 LangSmith Web 版）。

- **langgraph stack**：Python 库；`StateGraph` API；以"state 流转"而非"节点连边"为中心
- **langgraph-studio2 现状**：macOS only desktop，依赖 Docker；官方推荐切换到 LangGraph Web Studio + 本地 langgraph server
- **关键模型**：**State 是中心** —— 节点是函数 `(state) -> partial_state`，框架自动 merge

#### Q8 一句话亮点

- **State-centric 模型**（vs Node-centric）：所有节点共享一个 typed state，每个节点返回 state 的 patch
- **Time travel 调试**：可以回溯任何 state checkpoint
- **Streaming 多种模式**：`values` / `updates` / `messages` / `debug`

→ 本 spec V1 是 node-centric（每节点 1 string in 1 string out）；如果 V2 要加结构化数据，可参考 langgraph 的 state-centric 范式

---

## 9. ⭐ stravu/crystal （已 deprecated）

⚠️ **2026-02 deprecated 改名 Nimbalyst**。原 Crystal 仓库只剩迁移指引。

- **新址**：https://github.com/Nimbalyst/nimbalyst（公开 / 下载）
- **关注点**：Nimbalyst 是 Crystal 的商业延续，不一定开源；要 clone 看 Nimbalyst 是否开源

→ **行动项**：本调研 Top-10 的 Crystal 应该替换成 `Nimbalyst/nimbalyst`，下次 clone 时换

---

## 10. ⭐ johannesjo/parallel-code

> AI Arena 概念发明者；本仓库 v1 Arena 已参考。

- **stack**：Electron + SolidJS + TypeScript
- **README slogan**：`Ten agents. Ten branches. One afternoon.`

#### Q8 一句话亮点

- **N 栏并排 diff 的实际 UX 实现** —— 本仓库 Arena v1 已经参考，但其细节（栏头信息密度、状态指示）可以再深读
- 与 vibe-kanban Arena v1 / v2 的区别：parallel-code 没有 kanban 上下文，更像独立工具

---

## 11. 可偷功能汇总矩阵（横向对比）

> 每行 = 一个功能维度；每列 = 一个项目；单元格 = 该项目的具体做法 / 是否独有

| 功能维度 | circuit | dify | Flowise | ComfyUI | nodetool | langgraph | open-agent-builder | AionUi | parallel-code |
|---|---|---|---|---|---|---|---|---|---|
| 节点 schema | ⭐ defineSchema + 14 PropertyType | typed entities | INode interface | INPUT_TYPES classmethod + RETURN_TYPES | python class | python function | TS interface | n/a | n/a |
| 变量引用 | `{{Name.field.path}}` 数组 [0] | `{{#id.field#}}` | `$flow.id.f` | typed socket | n/a | typed state | `{{lastOutput.x}}` | n/a | n/a |
| 实时 streaming | ⭐ Socket.io + EventEmitter | SSE | SSE | WebSocket | WS | streaming modes | SSE | n/a | IPC |
| 持久化 | ⭐ YAML 文件 | PG 表 | DB+JSON 列 | JSON workflow | DB | py code | Convex | local DB | local DB |
| 节点扩展 | ⭐ executor registry | plugin | nodes/ 目录 | custom_nodes/ ⭐⭐ | extension | python module | n/a | n/a | n/a |
| 错误处理 | ⭐⭐ rejection handler with maxRetries+onMaxRetries | retry policy | retry/fallback | n/a | n/a | exception handler | n/a | n/a | n/a |
| 调试能力 | ⭐⭐ checkpoint + replay | run history + node trace | run logs | queue history | run history | ⭐⭐⭐ time travel | preview panel | n/a | session log |
| 模板分享 | YAML 文件 | marketplace | community templates | ⭐⭐⭐ workflow.json 社区生态 | cloud import | n/a | 8 内建模板 | 20 内建 assistant | n/a |
| 键盘搜索建节点 | ❌ | ❌ | ❌ | ⭐⭐⭐ SEARCH_ALIASES | ❌ | ❌ | ❌ | n/a | n/a |
| LLM 驱动条件分支 | ❌ | ❌ | ⭐⭐⭐ ConditionAgent | ❌ | ❌ | ❌ | ❌ | n/a | n/a |
| Cron 触发 | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ⭐⭐⭐ 24/7 | n/a |
| IM 远程触发 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⭐⭐⭐ 5 IM 平台 | n/a |
| typed I/O 自动校验 | ❌ | ✅ | ✅ | ⭐⭐⭐ socket color | ✅ | ✅ | ❌ | n/a | n/a |
| 子流程节点（subflow） | ❌ | ✅ Iteration | ⭐ ExecuteFlow | ❌ | ✅ | n/a (StateGraph 嵌套) | ❌ | n/a | n/a |
| StickyNote 画布注释 | ❌ | ✅ | ⭐⭐ | ❌ | ✅ | n/a | ❌ | n/a | n/a |
| MCP server 节点级配置 | ⭐⭐⭐ mcp-server-selector property | ❌ | ✅ Tool 节点 | ❌ | ❌ | ❌ | ✅ | ✅ | n/a |
| Workflow 内嵌测试 | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ⭐⭐⭐ Playwright e2e per template | ❌ | n/a |

---

## 12. 给本 spec 的回填清单（来自调研）

更新到 [`../spec.md` §10.2](../spec.md)：

- [x] **#1 React Flow vs 替代方案**：xyflow/react v12 直接用，Flowise / circuit / open-agent-builder / Sim Studio / Agentok 全部用它，验证过的选型
- [x] **#2 JS 沙箱选型**：circuit 用了 `javascript` 节点（暗示有沙箱），需进一步看其 `executors/javascript.ts`；可初步选 boa_engine（纯 Rust）
- [ ] **#3 节点 token streaming 性能**：所有项目都用 WS/SSE，未见性能瓶颈报告，初步可信本 spec 的 50ms 节流策略
- [ ] **#4 共享 worktree 并行边界**：circuit 没遇到（每节点独立调用），需自己测；建议 V1 文档警告 + V2 加锁
- [ ] **#5 Arena 节点 promote 回填**：调研未覆盖，本仓库自己设计（`git cherry-pick` 方案 A 仍是首选）
- [x] **#6 系统模板 vs 用户自建**：**两者都做**，open-agent-builder 8 模板 / AionUi 20 assistant / Flowise marketplace 都是"内置 + 用户自建"双轨
- [x] **#7 运行视图回放**：circuit 的 **checkpoint + replay** 模式 → 直接抄
- [ ] **#8 失败重试 token 计费**：调研未覆盖
- [ ] **#9 Loop 节点 output 语义**：dify Iteration 节点 + Flowise Loop 节点都有方案，clone 看具体实现
- [x] **#10 ComfyUI 风格键盘搜索建节点**：✅ 直接抄 ComfyUI 的 `SEARCH_ALIASES` 字段
- [x] **#11 多上游拼接 schema**：circuit 的 `inputSelector` property 让用户挑要拼哪些上游 + Flowise StickyNote 思路 → 默认拼接 + 用户可选

---

## 13. 给本 spec 的"应抄但 spec 没写"清单（新增需求）

调研后浮现，建议追加到 spec：

| # | 项目 | 功能 | 加到 spec 哪里 |
|---|---|---|---|
| 1 | ComfyUI | `search_aliases: string[]` 节点 schema 字段 | §4 节点配置 |
| 2 | ComfyUI | `tooltip` / `output_tooltips` | §4 节点配置 |
| 3 | circuit | edge type 枚举 `default/approval/rejection` | §5.2 graph_json |
| 4 | circuit | conversation mode `fresh/persist` | §4.2 Agent 节点 |
| 5 | circuit | rejection handler with `maxRetries + onMaxRetries: fail/skip/approve-anyway` | §4.2 Human Gate 节点 |
| 6 | circuit | conditions 数组 + AND/OR + 11 operator | §4.2 Condition 节点（升级简化版） |
| 7 | circuit | **MCP server 选择作为 property type** | §4.2 Agent 节点 + 与 T0-2 MCP 面板打通 |
| 8 | circuit | **checkpoint + executeFromCheckpoint(replayNodeIds, inactiveNodeIds)** | §6.1 retry 端点 + 新增 replay 端点 |
| 9 | Flowise | **ConditionAgent 节点（LLM 驱动语义匹配 → scenario）** | §4 新增节点类型 C-3 |
| 10 | Flowise | **StickyNote 节点（画布注释，零执行）** | §4 新增节点类型 G-1 |
| 11 | Flowise / dify | **Iteration / ExecuteFlow（子流程节点）** | §4 §10.2 #6（与系统内置模板搭配） |
| 12 | dify | 引用语法用 `{{#node_id.field#}}` 而非 `{{}}`，避免与 prompt 字面 `{{ }}` 冲突 | §3.1 数据流契约 |
| 13 | open-agent-builder | **Playwright e2e per template** | §9 验收标准 + 新增「模板回归测试」 |
| 14 | AionUi | trigger 扩展：cron + IM（Telegram/微信等） | §3.2 trigger_source 扩展点 |

---

## 14. 调研期间发现的新候选项目

| 项目 | 来源 | 一句话 |
|---|---|---|
| `Nimbalyst/nimbalyst` | crystal README 迁移指引 | crystal 商业续作，需确认是否仍开源 |
| `iOfficeAI/OfficeCli` | AionUi README 引用 | PPT/Word/Excel 生成 CLI，AionUi 的 office 能力底层 |

---

## 15. 第二轮调研建议（按需展开，不必现在做）

如果想再深一层，按以下顺序：

1. **circuit 的 executors/ 全部源文件**（11 个 executor）—— 看每个节点类型怎么实现，特别是 `javascript.ts` 的沙箱、`approval.ts` 的暂停/恢复机制
2. **Flowise ConditionAgent 完整实现** —— `findBestScenarioIndex.ts` + `Condition Agent.ts` —— 学 LLM-driven branching 的 prompt + fallback 链
3. **dify 的 graph_engine** —— Python 实现的 DAG runner，与 circuit 的 TS 实现对照
4. **ComfyUI 的 custom_nodes 目录** —— 看社区贡献的节点格式，理解扩展协议
5. **langgraph 的 StateGraph + checkpointer** —— state-centric 是否值得在 V2 引入

---

## 16. 修订历史

| 日期 | 修订点 |
|---|---|
| 2026-05-08 创建 + 第一轮填写 | clone 11 项 + README/CLAUDE.md 一手扫描 + 关键文件 head 阅读 + 横向矩阵 + 14 条 spec 增量 |
