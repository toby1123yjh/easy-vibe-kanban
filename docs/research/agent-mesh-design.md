# Agent Mesh：「自由拉起任意智能体」方案对比与推荐设计

> 日期：2026-06-12
> 前置调研：[oss-products-wrapping-claude-code-codex.md](./oss-products-wrapping-claude-code-codex.md)（15+ 开源产品适配机制实证）
> 适用对象：easy-vibe-kanban（Rust workspace + React，已有 10 家 executor、工作流画布、共享 worktree、MCP crate）

---

## 0. 先盘点现状：你已经赢在起跑线

调研完 15 个产品回头看本仓库，事实是：**业界验证过的最优架构（分层混合），你已经实现了 70%**——

| 层 | 现状 | 位置 |
|----|------|------|
| Claude 原生轨 | stream-json 双向流 + `--resume` / `--resume-session-at` | `crates/executors/src/executors/claude.rs` |
| Codex 原生轨 | app-server JSON-RPC + `thread_fork`（官方协议 crate） | `crates/executors/src/executors/codex.rs` |
| **ACP 通用轨** | **自研 ACP harness 已在生产**，gemini（`--experimental-acp`）、qwen、copilot 三家已跑在上面 | `crates/executors/src/executors/acp/{client,harness,session,normalize_logs}.rs` |
| 编排层 | 工作流画布 + planner/runner + 共享 worktree + Workflow Agent Envelope | `crates/workflow/` |
| 暴露层 | MCP server crate | `crates/mcp/` |

所以本设计不是"从零选型"，而是回答两个问题：
1. 如何把"接一家新 agent"的成本从**写一个 Rust 模块**降到**注册表加一行**；
2. 在这个运行时之上，做什么别人没有的东西（噱头 + 真价值）。

---

## 1. 五种实施方案对比

| 方案 | 代表产品 | 功能上限 | 接入成本/家 | 维护风险 | 判定 |
|------|----------|----------|------------|----------|------|
| A. 逐家原生适配 | vibe-kanban、Happy | ★★★★★ 全功能 | 高（一个模块 + 持续跟协议） | 协议 churn（codex 0.137→0.138 亲历） | 只给头部 2-3 家 |
| B. 官方 SDK 拼装 | claudecodeui | Claude 满 / Codex 残 | 中 | 绑 Node 技术栈 | ❌ 否 |
| C. 纯 ACP 统一 | AionUi | ★★★ 能力交集 | 极低 | adapter 是额外故障面 | 不做唯一通道 |
| D. PTY 终端包装 | omnara 旧版（已死） | 看似全实则碎 | 低 | 官方认证不可维护 | ❌ 否决 |
| E. **分层混合** | **MindFS、OpenClaw、本仓库现状** | 头部满 + 长尾交集 | 低 | 可控 | ✅ **推荐** |

### 取舍依据（全部来自调研实证，不是推演）

- **B 被否**：`@openai/codex-sdk` 只封装 `codex exec`，无交互审批、无双向通信。Happy 源码注释原话："It has NO support for app-server, interactive approvals, or bidirectional JSON-RPC"。工作流场景必须有审批回路（review gate、人审节点），fire-and-forget 不可接受。
- **D 被否**：omnara 官方弃用声明："built as a wrapper around the Claude Code CLI, which became unfeasible to maintain with Claude Code's constant updates"。PTY 解析屏幕输出 = 给每次 CLI 改版陪葬。
- **C 不做唯一通道**：ACP 是能力交集 —— Codex 的 `thread_fork`（本仓库 follow-up 依赖它）、Claude 的 hooks / `--resume-session-at` 都不在标准里。把头部 agent 降级到 ACP 等于自废武功。MindFS 和 OpenClaw 都对 Claude/Codex 保留原生轨、ACP 只接长尾，这是两家独立得出的相同结论。
- **A 不全面铺开**：接 17 家 agent = 17 份协议跟进。本仓库 codex 协议适配的维护记录就是成本证明。
- **E 的正确性**：MindFS（原生 claude + 原生 codex + 通用 ACP 接 15 家）、OpenClaw（原生 codex app-server + acpx 接长尾）、以及 OpenAI 官方插件选 app-server —— 三方互相独立验证。

---

## 2. 推荐架构：Agent Mesh

```
┌────────────────────────────────────────────────────────────┐
│ 产品层    Kanban │ Workflow 画布 │ 会话 Chat │ Agent Garage(新) │
├────────────────────────────────────────────────────────────┤
│ 编排层    planner / runner / 共享 worktree / Envelope（已有）   │
│           + HandoffCapsule 跨 agent 接力（新，噱头核心）         │
├────────────────────────────────────────────────────────────┤
│ 运行时层  AgentRuntime                                       │
│   ├ 原生轨: claude(stream-json) / codex(app-server) ←不动     │
│   ├ ACP 轨: AcpAgentHarness（已有）                           │
│   │         → 注册表驱动 UniversalAcpExecutor（新）            │
│   └ 能力矩阵 + 审批/日志归一（normalize_logs 已有）              │
├────────────────────────────────────────────────────────────┤
│ 发现层    agent registry + PATH/版本/登录态探测（新）            │
└────────────────────────────────────────────────────────────┘
```

### P0 — 注册表驱动的 UniversalAcpExecutor（基建，≈1-2 周）

现状是 gemini/qwen/copilot 各有一个薄壳 Rust 文件包着同一个 `AcpAgentHarness`。把"薄壳"参数化：

- executor 枚举增加 `CustomAcp`，所有差异收进配置（沿用现有 agent-configurations / profile 机制）：

```jsonc
// agent profile 示例 —— 接入一家新 agent 只需要这一段
{
  "GOOSE":   { "kind": "acp", "command": "goose", "args": ["acp"] },
  "KIMI":    { "kind": "acp", "command": "kimi", "args": ["--acp"] },
  "CLAUDE_VIA_ACP": { "kind": "acp", "command": "npx",
                      "args": ["@agentclientprotocol/claude-agent-acp"] },
  "CODEX_VIA_ACP":  { "kind": "acp", "command": "codex-acp" }
}
```

- adapter 三个来源：① CLI 原生 ACP flag（gemini/qwen 已是）；② 官方 adapter 二进制（`codex-acp` 有 release，`claude-agent-acp` 走 npm）；③ 社区 adapter（ACP 官网列表 20+ 家）
- ACP 侧权限请求 → 复用现有审批 UI；事件流 → 复用 `normalize_logs`
- 收益立竿见影：Goose、Kimi CLI、Cline、Junie、Kiro、OpenCode、Factory Droid… 全部变成配置项

### P1 — Agent Garage（第一层噱头：打开页面，机器上所有智能体一键拉起）

- 发现服务：PATH 扫描 + `--version` + 登录态 probe（MindFS `discovery.go` 同款思路），产出每家 agent 的 安装/版本/认证/协议轨 状态
- 前端 Garage 面板：一排 agent 卡片，绿灯=可拉起；点击即开会话或填进工作流节点
- 工作流画布的 executor 下拉从注册表动态生成（含健康状态），不再硬编码
- 能力矩阵驱动 UI 降级：不支持 resume 的 agent，follow-up 按钮置灰并提示原因

| 能力 | claude 原生 | codex 原生 | ACP 轨 |
|------|------------|------------|--------|
| 会话续接 | ✅ `--resume` | ✅ `thread_fork` | ⚠️ 视 agent（`session/load` unstable） |
| 历史截断重放 | ✅ `--resume-session-at` | ❌ | ❌ |
| 交互审批 | ✅ | ✅ | ✅（ACP 标准内） |
| Hooks 注入 | ✅ | ❌ | ❌ |
| 图片输入 | ✅ | ✅ | ✅ |
| MCP 透传 | ✅ | ✅ | ✅（client MCP） |

### P2 — HandoffCapsule 跨 agent 接力（噱头核心，难度最高，真价值所在）

**卖点一句话：「热插拔大脑」—— Claude 限额打满，Codex 无缝接管，上下文不丢。**

场景：
1. **Failover 策略**：工作流节点配置 fallback 链（`CLAUDE_CODE → CODEX → GEMINI`），agent 失败/限流时自动用下一家重试同一节点
2. **会话中途换脑**：`/switch codex` —— 同一个任务会话，下一轮换 agent 执行
3. **画布混编已有**，接力让它从"静态分工"升级为"动态调度"

实现原理（诚实版）：**会话语义不可移植**（claude session ≠ codex thread），所以不伪造会话，靠两样东西接力——这正是本项目 "context flows through code" 哲学的延伸：

- **共享 worktree**（已有）：代码状态天然延续
- **HandoffCapsule**（新）：结构化交接包，注入新 agent 的首条 prompt
  - 上一 agent 的输出捕获（`output_capture: LastMessage` 已有）
  - 节点任务 + 上游 Envelope（已有，直接复用）
  - `git diff --stat` 文件变更清单 + 未完成事项（从上一会话尾部提取）
- 难点（这就是"有难度有挑战"的部分）：
  - capsule 摘要质量决定接力成败 → 需要一个轻量"交接摘要"生成步骤（可用被切换 agent 自己生成临终总结）
  - 权限模式差异（claude 的 permission mode vs codex 的 approval policy vs ACP permission）要做语义映射表
  - 限流/失败信号的可靠识别（exit code、stderr 模式、协议错误码三轨不同）

### P3 — 反向暴露 + 独立 crate（远期，生态噱头）

1. **MCP 工具化**（`crates/mcp/` 已有底子）：暴露 `spawn_agent` / `run_workflow` 工具 → 在 Claude Code 里一句话拉起一个 Codex 子任务、或触发整条工作流（OpenClaw `sessions_spawn` 的同款体验，但带画布）
2. **抽独立 crate 开源**：把 `executors` + `acp` 运行时抽成 `agent-mesh` crate。Rust 生态目前**没有** universal coding-agent runtime（MindFS 是 Go，AionUi 是 Electron）——这是真空位，独立发布自带传播性，easy-vibe-kanban 作为旗舰消费者

---

## 3. 为什么这个组合「有噱头、有难度、有价值」

- **噱头**：①「画布上混编任意智能体」—— AionUi 有多 agent 无 DAG 工作流，上游 vibe-kanban 已停更，OSS 里没有第二家"工作流画布 × 全 agent 生态"；②「热插拔大脑/自动 failover」—— 调研里只有 MindFS 做了"中途换 agent"，但没人做工作流级 failover 链
- **难度**：HandoffCapsule 的语义映射（三轨审批模型、失败信号、摘要质量）是真正的硬问题；ACP unstable 版本跟进（`agent-client-protocol` crate 0.14.x churn）需要工程纪律
- **价值**：接新 agent 边际成本 → 一行配置；agent 限流不再阻塞交付（failover）；Garage 把"我装了哪些 agent、哪些能用"从黑盒变仪表盘。每一条都是日常痛点，不是 demo 价值

## 4. 明确不做的事（反模式清单）

1. ❌ 不把 Claude/Codex 降级到 ACP 轨（丢 `thread_fork`、hooks、`--resume-session-at`，follow-up 机制会塌）
2. ❌ 不碰 PTY/终端解析（omnara 墓碑）
3. ❌ 不自研跨 agent 协议（ACP 已是事实标准，自研=生态孤岛）
4. ❌ 不伪造跨 agent 会话恢复（做不到且脆弱，capsule + worktree 是诚实且够用的答案）
5. ❌ 不一次性铺开全部 P0-P3：P0→P1→P2 逐级验证，P0 两周内可见效

## 5. 版本策略决策记录（2026-06-12 已定）：pin & ship

讨论背景：codex app-server 标 `[experimental]`，协议随版本变（本仓库已有 6+ 次追版本提交：0.132 adapter、0.138 changes 等）。根因是**编译期钉死的协议类型（`codex-app-server-protocol` tag）对话用户机器上任意版本的二进制**。

| 决策项 | 结论 |
|--------|------|
| Codex 版本来源 | **钉死 `@openai/codex` 为 npm 依赖**，spawn 自带二进制（绝对路径），不用用户 PATH 上的；crate tag 与依赖版本同步升级、一起过 CI |
| Claude 版本来源 | 同样钉 `@anthropic-ai/claude-code`（顺手，优先级低于 codex——claude 协议本身稳），需设 `DISABLE_AUTOUPDATER=1` 防自更新破坏钉版 |
| Claude 接入协议 | **维持自研 stream-json 客户端不变**。Agent SDK 只是同一协议的 TS/Python 官方客户端，本仓库 Rust 实现已是其功能超集（stream-json 双向流 + `--permission-prompt-tool=stdio` + hooks 注入 + `--resume-session-at`）；换 SDK 需 Node sidecar 纯增复杂度，换 ACP 丢能力，都不做 |
| Codex 接入协议 | 维持 app-server 不变 |
| 状态目录 | **共享用户的 `~/.codex` / `~/.claude`，不做隔离**（不设 `CODEX_HOME` / `CLAUDE_CONFIG_DIR`）——免登录、用户 MCP/CLAUDE.md 配置直接生效，是 pin & ship 成立的前提 |
| 会话列表互见 | 已知：本产品拉起的会话会出现在用户终端 `claude --resume` 选择器中，反之亦然。**接受，不处理**（happy 的 entrypoint 标记方案留作未来可选项） |
| 高级用户出口 | 留 "use system binary" 开关；开启时探测版本，不在已验证区间则 UI 提示"未验证版本"——把兼容矩阵变成告警而非承诺 |

净效果：「用户机器版本差异」从持续工程税变为一次性架构决策；codex 协议升级变成"我们主动做的升级 + CI 验证"，而非"用户环境突然炸了"。

## 6. 升级迭代机制（如何跟着 codex / claude code 长功能）

pin & ship 解决"不被动炸"，本节解决"主动跟进新功能"。核心：**把上游新功能分三类，让前两类零成本，把第三类变成有节奏的流水线。**

### 6.1 新功能三分类

| 类别 | 例子 | 跟进成本 | 机制 |
|------|------|----------|------|
| A. 透传型 | 新模型名、用户自定义命令/prompt、技能列表 | **零代码** | 运行时动态发现（向 agent 问"你会什么"），UI 数据驱动 |
| B. 展示型 | 新事件类型（reasoning 流、web search、新工具卡片） | 可选精修 | 归一化事件 + **兜底渲染**：未知事件显示为通用折叠卡片（类型标签 + JSON），新功能"默认可见"而非"默认丢失"，再按价值决定专属渲染 |
| C. 交互型 | 带专属 RPC 的内建命令（codex /review）、新审批类型、新会话操作（fork/rollback） | 必须写代码 | 升级流水线（6.3）压缩成本 |

### 6.2 三轨的"自描述"现状与改造

| 轨 | 现状 | 改造 |
|----|------|------|
| ACP | ✅ 已完成 —— `AvailableCommandsUpdate` 已接入 normalize_logs，命令列表天生动态 | 无（这是 ACP 的设计红利） |
| Claude | 半自动：自定义命令动态发现，内建命令 `hardcoded_slash_commands()` 硬编码 | init 事件自带 `slash_commands`/tools/model 列表 → 硬编码列表降级为 fallback，优先用 init 动态列表 |
| Codex | 最贵：`CodexSlashCommand` 枚举逐个手工实现（/init 自带 prompt 模板、/skills 调 SkillsList RPC），且未用满协议的发现能力（见 6.2.1） | list 类 RPC + changed 通知全部动态化（A 类）；带专属 API 的内建命令归 C 类认账 |

#### 6.2.1 app-server 自描述能力的边界（0.138 协议 crate 源码实测）

直接枚举本仓库依赖的 `codex-app-server-protocol`（tag rust-v0.138.0）全部 RPC 方法后的结论：**app-server 是"半自描述"——有局部发现，无通用透传。**

**有（A 类动态化的原料，当前实现未用满）**：

- 列表 RPC：`model/list`、`collaborationMode/list`、`skills/list`、`hooks/list`、`plugin/list`、`app/list`、`experimentalFeature/list`、`mcpServerStatus/list`、`config/read`
- 变更感知通知：`skills/changed`、`account/updated`、`model/rerouted`、`fs/changed` —— 不止能"问"，还能被"推"
- 版本/环境感知：`initialize` 响应含 `user_agent`（带 codex 版本号）、`codex_home`、平台信息；客户端侧可声明 capabilities（`experimentalApi` 开关、通知 opt-out）→ 运行时版本校验告警不需要额外探测进程

**没有（C 类的根源）**：

- 没有 ACP 式的通用命令发现（`availableCommands`）与"按名字执行命令"的透传通道
- 斜杠命令是 TUI 层概念，app-server 把每个内建命令暴露成**专属强类型 RPC**：/review = `review/start`、compact = `thread/compacted`、steer = `turn/steer`、回滚 = `thread/rollback`……所以"codex 新增内建命令" ≈ "协议新增 RPC"，必然要写代码跟进

**为什么这样设计**：app-server 服务的是 OpenAI 自家客户端（IDE 扩展、macOS app），客户端与 harness 同步发版、永远版本锁定，根本不需要发现机制 —— 这从协议设计层面再次印证了本文第 5 节 pin & ship 的正确性：第三方要么跟着锁版本，要么承受类型错配。

### 6.3 升级流水线

1. **标准化升级 PR**：bump `@openai/codex` npm 版本 + `codex-app-server-protocol` crate tag 必须同一提交；claude 同理
2. **golden transcript 回放测试**（本仓库已有 fixtures 文化，系统化它）：每版本录制真实会话 transcript（claude NDJSON / codex JSON-RPC），回放过 normalize_logs 做 snapshot 对比 —— **升级后的 snapshot diff 就是本次 UI 跟进清单**，新事件类型/字段一目了然
3. **兜底渲染兜住时间差**：B 类新事件在精修前以通用卡片可见，用户不哑火，跟进不紧急
4. **release 哨兵**：CI 定时任务监控 openai/codex releases 与 claude-code CHANGELOG，新版本自动开 issue 附协议类型 diff
5. **吃自己的狗粮（可作卖点）**：内置一条 "Upgrade Agent" 工作流模板：bump deps → 跑回放测试 → agent 修编译错误与 snapshot diff → 人审 —— 用本产品维护本产品
6. **节奏**：codex 月度跟进（变更快、实验期），claude 季度或按需（协议稳）

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| ACP 协议仍标 unstable，0.x 版本 churn | pin `agent-client-protocol` 版本；adapter 版本写进注册表；参考 AionUi 的 managed adapter 分发（锁版本 + 托管下载） |
| Windows 上 npm 系 adapter（claude-agent-acp）启动链脆弱 | 头部 agent 走原生轨不受影响；长尾优先选有二进制 release 的 adapter（codex-acp 模式）；npx 兜底 |
| 三轨审批语义不一致导致 UI 混乱 | P1 的能力矩阵先行，审批统一到现有 approvals 模型，差异在 executor 层吸收 |
| HandoffCapsule 摘要质量不可控 | 让被切换 agent 生成"临终总结"作为 capsule 主体；失败时降级为 Envelope + diff 清单的机械拼装 |
