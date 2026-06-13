# 开源产品如何适配 Claude Code 与 Codex —— 调研报告

> 调研日期：2026-06-12
> 调研方法：GitHub API 核实仓库元数据（license / stars / 活跃度），逐仓库阅读 README 与关键源码文件确认实际适配机制；本仓库（easy-vibe-kanban）的实现直接读取本地代码。
> 搜索渠道：Exa + Tavily + Grok（grok-4.3-high）三渠道交叉检索。

---

## 一、结论速览

把 Claude Code / Codex 包进自己产品的开源项目，底层适配机制只有 **4 种**，且生态正在快速收敛到前 3 种：

| 机制 | Claude Code 侧 | Codex 侧 | 特点 |
|------|----------------|----------|------|
| **A. 官方 SDK 进程内集成** | `@anthropic-ai/claude-agent-sdk`（TS/Python） | `@openai/codex-sdk`（仅封装 `codex exec`） | 最稳定、随官方升级；Codex SDK 功能受限（无交互审批） |
| **B. 官方协议驱动子进程** | `claude -p --output-format=stream-json --input-format=stream-json`（NDJSON 流） | `codex app-server`（双向 JSON-RPC over stdio） | 全功能；Codex 侧是目前唯一支持交互审批/线程管理的程序化通道 |
| **C. ACP（Agent Client Protocol）标准层** | `@agentclientprotocol/claude-agent-acp` 适配器（内部用 Claude Agent SDK） | `@zed-industries/codex-acp` 适配器（内部直接链接 codex-core Rust crate） | 一套客户端代码接全部 agent；Zed 发起，已成事实标准 |
| **D. PTY / 终端包装** | 伪终端里跑 `claude`，解析屏幕输出 + 监听 `~/.claude/projects` JSONL | 同理跑 `codex` | 兜底方案，极脆弱；omnara 已用血泪证明不可维护 |

### 重要前提：每个 agent 原生支持的程序化接口不一样

上表的机制不是任选的 —— 取决于 agent 本身暴露了什么接口。**app-server 是 Codex 专属协议，Claude Code 没有也不支持 app-server**；Claude Code 的"全功能程序化通道"是另一套东西（stream-json 双向流），官方 Agent SDK 就是它的封装。两家 CLI 的实际能力对照（本机 `--help` 实测）：

| 程序化接口 | Claude Code | Codex |
|------------|-------------|-------|
| headless 单次执行 | `claude -p`（`--output-format json`） | `codex exec --json` |
| **全功能双向流/服务协议** | `-p --output-format=stream-json --input-format=stream-json`（NDJSON 双向流 + 控制消息） | `codex app-server`（JSON-RPC over stdio） |
| 官方 SDK | **Claude Agent SDK**（TS/Python，封装上面的 stream-json 通道，含 hooks/审批回调） | `@openai/codex-sdk`（仅封装 `codex exec`，无审批、无双向） |
| 自身作为 MCP server | `claude mcp serve` | `codex mcp-server` |
| ACP | 无原生支持，靠 `claude-agent-acp` 适配器（内部用 Agent SDK） | 无原生支持，靠 `codex-acp` 适配器（内部链接 codex-core） |
| 会话续接 | `--resume <session_id>` | app-server 的 `thread_fork` / `codex exec resume` |

所以**没有任何产品"对 Claude Code 用 app-server"** —— 做不到。所有同时支持两家的产品（本项目、Happy、CloudCLI、OpenClaw）全部是**双轨实现**：Claude 走 SDK 或 stream-json，Codex 走 app-server，两套适配层并行维护。这也是 ACP 适配器存在的意义：把两套异构协议在外面再统一一层。

**关键教训（omnara 官方原话）**：

> "This version was built as a wrapper around the Claude Code CLI, which became unfeasible to maintain with Claude Code's constant updates. We've migrated to a new platform built using the Claude Agent SDK."

---

## 二、开源产品清单

| 产品 | 仓库 | License | Stars | 状态 | Claude Code 适配 | Codex 适配 |
|------|------|---------|-------|------|------------------|------------|
| **OpenClaw** | [openclaw/openclaw](https://github.com/openclaw/openclaw) | 自定义 | 378k | 活跃 | ACP harness（`acpx`） | 原生 app-server 插件（核心 runtime） |
| **LobeHub**（原 Lobe Chat） | [lobehub/lobehub](https://github.com/lobehub/lobehub) | LobeHub Community License（Apache-2.0 + 商用附加条款） | 79k | 活跃 | stream-json CLI 子进程（heterogeneous-agents 适配器） | CLI 子进程（适配器规划中，spawn 层已支持） |
| **AionUi** | [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) | Apache-2.0 | 28k | 活跃 | 打包分发 `claude-agent-acp` | 打包分发 `codex-acp` |
| **Vibe Kanban** | [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)（本项目上游） | Apache-2.0 | 27k | 原项目停更，本 fork 持续 | stream-json CLI 子进程 | app-server JSON-RPC |
| **Happy** | [slopus/happy](https://github.com/slopus/happy) | MIT | 22k | 活跃 | Claude Agent SDK | 手写 app-server 客户端 |
| **opcode** | [winfunc/opcode](https://github.com/winfunc/opcode) | AGPL-3.0 | 22k | 半停滞（2025-10 起未更新） | stream-json CLI 子进程 | 不支持 |
| **codex-plugin-cc**（OpenAI 官方） | [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) | Apache-2.0 | 21k | 活跃 | 本身是 Claude Code 插件 | app-server（broker 单例） |
| **CloudCLI / claudecodeui** | [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) | AGPL-3.0 | 12k | 活跃 | Claude Agent SDK（进程内） | `@openai/codex-sdk` |
| **Crystal**（已弃用→Nimbalyst） | [stravu/crystal](https://github.com/stravu/crystal) | MIT | 3k | 2026-02 弃用 | stream-json CLI 子进程 | CLI 子进程 |
| **omnara**（已归档） | [omnara-ai/omnara](https://github.com/omnara-ai/omnara) | Apache-2.0 | 2.6k | 已归档 | **PTY 包装**（弃用原因） | PTY 包装 |
| **MindFS** | [a9gent/mindfs](https://github.com/a9gent/mindfs) | AGPL-3.0 | 1.1k | 活跃 | Go 版 Agent SDK（`claude-agent-sdk-go`） | Go 版 app-server SDK（`codex-go-sdk`） |
| **claude-agent-acp**（适配器本体） | [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) | Apache-2.0 | 2k | 活跃 | Claude Agent SDK → ACP | — |
| **codex-acp**（适配器本体，Zed） | [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp) | Apache-2.0 | 841 | 活跃 | — | 内嵌 codex-core crate → ACP |
| **FleetCode** | [built-by-as/FleetCode](https://github.com/built-by-as/FleetCode) | ⚠️ 无 License | 416 | 低活跃 | PTY 终端 + `--session-id/--resume` | PTY 终端 |
| **openclaw-codex-app-server**（社区插件） | [pwrdrvr/openclaw-codex-app-server](https://github.com/pwrdrvr/openclaw-codex-app-server) | MIT | 261 | 活跃 | — | app-server（绑定既有线程） |
| **claude-agent-ui** | [ninehills/claude-agent-ui](https://github.com/ninehills/claude-agent-ui) | 未声明 | 55 | 低活跃 | Claude Agent SDK + Bun SSE | — |
| **codex-web-local** | [pavel-voronin/codex-web-local](https://github.com/pavel-voronin/codex-web-local) | MIT | 17 | 已归档 | — | app-server |

闭源但属于同一生态的：Conductor（conductor.build）、Omnara 新版（omnara.com，基于 Claude Agent SDK）、Vibecode、Nimbalyst（Crystal 续作）、Hermes Agent。

> ⚠️ **License 提示**：claudecodeui 和 opcode 都是 **AGPL-3.0**，二次开发做 SaaS 需要开源自己的修改；FleetCode 没有 License 文件，严格来说不可商用复用。

---

## 三、逐产品适配机制详解

### 3.1 本项目（easy-vibe-kanban / vibe-kanban）—— 双协议子进程

**Claude Code**（`crates/executors/src/executors/claude.rs`）：

- 启动：`claude -p --verbose --output-format=stream-json --input-format=stream-json`，stdin 写入 prompt，stdout 读 NDJSON 事件流
- 续聊：`--resume <session_id>`，可加 `--resume-session-at <uuid>` 截断历史到指定消息
- 可选 `--dangerously-skip-permissions`；支持把 base command 换成 CCR（claude-code-router）
- session_id 从首条流事件中捕获并持久化，实现"稳定 agent 会话"

**Codex**（`crates/executors/src/executors/codex.rs`）：

- 启动：`codex app-server` 子进程，stdio 上跑双向 JSON-RPC（直接依赖 openai/codex 的 `codex-app-server-protocol` 官方 crate 做类型）
- 流程：`initialize` → `thread_start`（新会话）或 `thread_fork`（续聊：fork 旧线程拿新 thread_id）→ `turn_start`（带 collaboration mode）
- 审批请求（exec/patch）通过 JSON-RPC 回传，由产品层决策
- Codex 协议升级会 break 这里（本分支最近的 `adapt codex 0.138 protocol changes` 提交就是在跟进）

### 3.2 OpenClaw —— 一个产品用齐三种机制（378k stars）

OpenClaw 是多通道（Telegram/Discord/WhatsApp…）个人 AI 网关，它与 coding agent 的关系最复杂也最有参考价值：

1. **原生 Codex app-server 插件**：`/codex bind` 等命令直接绑定 Codex 线程，且 `openai/gpt-*` 模型的 agent turn 默认就跑在内嵌的 Codex app-server runtime 上 —— Codex harness 成了它的"执行引擎"
2. **ACP agents**（`@openclaw/acpx` 插件）：`/acp spawn` 把 Claude Code、Cursor、Gemini CLI、OpenCode 等作为**外部 ACP harness** 启动，会话绑定到聊天频道，作为后台任务跟踪
3. **反向 ACP 桥**（`openclaw acp`）：把 OpenClaw 自己暴露成 ACP server，让 Zed 等 IDE 反过来连它
4. **MCP 入口**（`openclaw mcp serve`）：让 Codex/Claude Code 作为 MCP 客户端直连 OpenClaw 的频道会话
5. 社区插件 `pwrdrvr/openclaw-codex-app-server`：通过 app-server 协议把 Telegram/Discord 对话绑定到 **Codex Desktop/TUI 的既有线程**（共享本地登录态，消息直通线程）

文档参考：`docs/tools/acp-agents.md`、`docs/cli/acp.md`、`docs/cli/mcp.md`。

### 3.3 AionUi —— "ACP 适配器分发商"路线（28k stars）

- 不自己写适配，直接**打包官方 ACP 适配器**：构建脚本 `scripts/prepare-managed-acp-tools.sh` 把 `codex-acp`（Zed 版，0.14.0）和 `claude-agent-acp`（0.39.0）打成 6 平台二进制，经自家 CDN 分发（"managed ACP tools"）
- 对话层是统一的 ACP 平台（`packages/desktop/src/renderer/pages/conversation/platforms/acp/`），权限弹窗、工具调用、slash 命令都走 ACP 消息
- 扩展机制 `acp-adapters.json`：第三方可以注册任意 ACP agent 进 AionUi
- 自动探测本机已安装的 18+ CLI agent；MCP 配置一处管理、同步到所有 agent

这是「想同时接所有 agent 的 GUI 产品」目前最省力的架构。

### 3.4 Happy —— 双协议自研客户端 + 端到端加密中继（22k stars）

`happy` 命令替代 `claude` / `codex` 启动，本机 CLI 与手机 App 之间经 E2E 加密 relay 同步：

- **Claude 侧**（`packages/happy-cli/src/claude/`）：基于官方 `@anthropic-ai/claude-agent-sdk` 的 `query()` 封装（`sdk/query.ts`），外加：hooks 配置注入（`generateHookSettings.ts`）、权限处理器（手机上点审批）、`~/.claude` 会话 JSONL 解析与 fork（`claudeSessionFork.ts`）、本地/远程双模式 launcher（按键即切回本地终端）
- **Codex 侧**（`packages/happy-cli/src/codex/codexAppServerClient.ts`）：**手写 app-server JSON-RPC 客户端**。源码注释明确解释了为什么不用官方 SDK：
  > "@openai/codex-sdk exists but only wraps `codex exec` (non-interactive, fire-and-forget). It has NO support for app-server, interactive approvals, or bidirectional JSON-RPC. We need app-server for mobile approval routing."
- 另有 `src/agent/acp/` 会话层用于 Gemini 等其它 agent —— 同样落在 ACP 上

### 3.5 CloudCLI（claudecodeui）—— 双官方 SDK 路线（12k stars，AGPL）

- **Claude 侧**（`server/claude-sdk.js`）：`@anthropic-ai/claude-agent-sdk` **进程内**集成（"Direct SDK integration without child processes"），工具审批通过 WebSocket 桥到前端（`AskUserQuestion` / `ExitPlanMode` 单独处理，55s 超时）。早期版本是 spawn CLI（`claude-cli.js`），后迁移到 SDK —— 又一个从"包 CLI"转向 SDK 的案例
- **Codex 侧**（`server/openai-codex.js`）：官方 `@openai/codex-sdk` 的 Thread API（`codex.startThread()` / `resumeThread()`），接受 SDK 局限（非交互）
- Cursor CLI、Gemini CLI 则各有 provider 模块（统一 provider 抽象：auth/models/mcp/sessions/skills 六件套，`server/modules/providers/list/`）

### 3.6 opcode —— 经典 stream-json GUI（22k stars，AGPL，半停滞）

- Tauri (Rust) 直接 spawn `claude` 二进制：`--output-format stream-json`、`--resume`（`src-tauri/src/commands/claude.rs`）
- 浏览 `~/.claude/projects/` 下的项目与会话 JSONL；自带 checkpoint（会话回滚）、MCP server 管理、自定义 agent
- 只支持 Claude Code，未跟进 Codex；2025 年 10 月后无提交

### 3.7 codex-plugin-cc —— OpenAI 官方"在 Claude Code 里跑 Codex"（21k stars）

适配方向反过来：它是一个 **Claude Code 插件**（marketplace + slash commands + hooks + skills），让 Claude Code 调 Codex：

- `/codex:review`、`/codex:adversarial-review`、`/codex:rescue`（委派任务）等命令
- 底层 `scripts/lib/app-server.mjs`：spawn 单例 `codex app-server` **broker**（endpoint 写入 `CODEX_COMPANION_APP_SERVER_ENDPOINT`，多命令复用同一进程），JSON-RPC 客户端，主动 opt-out delta 类通知降噪
- 配合 Stop hook 做 review gate（`stop-review-gate-hook.mjs`），输出走 JSON Schema 校验
- 连 OpenAI 自己做集成都选 app-server 而不是 `codex exec` —— 进一步验证 app-server 是 Codex 程序化集成的正道

### 3.8 两个 ACP 适配器本体（其它产品的地基）

- **claude-agent-acp**（原 zed-industries/claude-code-acp，现归 agentclientprotocol 组织）：用 **Claude Agent SDK** 实现 ACP agent，支持 @-mention、图片、审批、编辑评审、TODO、终端、slash commands、客户端 MCP。npm：`@agentclientprotocol/claude-agent-acp`
- **codex-acp**（Zed）：Rust 实现，**不是 spawn 子进程，而是直接以库形式链接 openai/codex 的 crates**（`codex-core`、`codex-protocol` 等，Cargo.toml 锁定 `rust-v0.137.0` tag），把 harness 内嵌后对外暴露 ACP。支持 ChatGPT 订阅或 API key 登录

任何 ACP 客户端（Zed、neovim、Emacs、JetBrains、Vercel AI SDK 的 ACP provider、AionUi、OpenClaw acpx…）拿这两个二进制就同时获得了 Claude Code 和 Codex。

### 3.9 omnara —— PTY 路线的墓碑（已归档）

- 旧实现 `src/integrations/cli_wrappers/claude_code/claude_wrapper_v3.py`：Python `pty` + `termios` 包住 claude 进程，同时 tail `~/.claude/projects/` 的 JSONL 推到自家 dashboard，双向注入用户输入
- README 官方宣布弃用："wrapper around the Claude Code CLI … unfeasible to maintain with Claude Code's constant updates"，新版（闭源）改用 **Claude Agent SDK**
- 仓库里还 vendor 了 claude-code-action 用于 GitHub Actions 集成，思路可参考

### 3.10 LobeHub（原 Lobe Chat）—— Chat 产品转型 Agent 平台的样本（79k stars）

Lobe Chat 已整体改名 **LobeHub**，定位从"LLM 聊天 UI"转向"Chief Agent Operator"（管理你的 AI 团队）。它把 Claude Code / Codex 等称为 **heterogeneous agents（异构 agent）**，作为与 API 模型并列的一类执行后端：

- 集成层在 `packages/heterogeneous-agents/`，架构注释写得很直白：

  ```
  Claude Code stream-json ──→ ClaudeCodeAdapter ──→ HeterogeneousAgentEvent[]   （已实现）
  Codex CLI output        ──→ CodexAdapter      ──→ HeterogeneousAgentEvent[]   （future）
  ACP JSON-RPC            ──→ ACPAdapter        ──→ HeterogeneousAgentEvent[]   （future）
  ```

- **Claude 侧**：Node `child_process.spawn('claude', ...)`，固定 flags 含 `stream-json` 输入输出 + `--include-partial-messages`，续聊 `--resume <session_id>`；CLI 原生事件统一映射成 LobeHub 内部的 `AgentStreamEvent`，与 API 模型共用同一渲染管线
- **Codex 侧**：spawn 层已支持 `'codex'` 类型（有 `resolveCodexInitialModel`、`--image` 入参构造），事件适配器标注 future；另有 `packages/builtin-tools/src/codex/` 一组工具渲染组件（FileChange/WebSearch/McpTool）
- 用户文档 `docs/usage/agent/claude-code.mdx`、`codex.mdx`：桌面端直接驱动本机已登录的 CLI
- ⚠️ License 是 **LobeHub Community License**（Apache-2.0 基础上附加商用条款），二次分发需读条款

这是「通用 chat 产品 → 把 CLI coding agent 纳入后端」最典型的演化路径，对话型产品想接 Claude Code 可直接参考它的 adapter/事件映射设计。

### 3.11 MindFS —— 三协议并用的 Go 单二进制网关（1.1k stars，AGPL）

a9gent/mindfs 是"AI Agent 远程访问网关"：单个 <10MB 静态二进制（Go 后端 + 内嵌 Web），自动探测本机 17 家 CLI agent，手机/浏览器远程操控，会话与 agent CLI **双向导入/续接**。它的适配架构是调研里最教科书式的三层组合：

- **Claude 原生适配**（`server/internal/agent/claude/`）：用社区 Go 移植版 Agent SDK —— `github.com/roasbeef/claude-agent-sdk-go`（WithResume/WithModel/WithEffort，处理 AskUserQuestion、Todo 等控制事件）
- **Codex 原生适配**（`server/internal/agent/codex/`）：用社区 Go SDK —— `github.com/fanwenlin/codex-go-sdk`，`StartThread/ResumeThread/RunStreamed`，底层即 **app-server**（`AppServerPathOverride`/`AppServerArgs` 可配）
- **其余 15 家走通用 ACP 适配器**（`server/internal/agent/acp/`）：基于 `github.com/coder/acp-go-sdk`，源码注释明确支持 "claude (via claude-code-acp wrapper)、gemini (via --experimental-acp)、codex (via codex-acp wrapper)" —— 即 Claude/Codex 也可降级走 ACP
- `agents.json` 注册表声明每家 agent 的 `protocol`（acp/native）与启动命令，配合 `discovery.go` 自动探测
- 双向同步靠 importer：解析 `~/.claude` / Codex 的会话文件导入，MindFS 会话也能回到 CLI 里 `--resume`

**额外信号**：MindFS 证明了**第三方语言 SDK 生态已成型** —— Claude Agent SDK 的 Go 移植、Codex app-server 的 Go 客户端、Coder 维护的 ACP Go SDK 都已可生产使用，非 Node 技术栈不再需要自己手写协议。

### 3.12 其它

- **FleetCode**：Electron + 终端（PTY）原样跑 `claude` / `codex`，新会话 `--session-id <uuid>`、重开 `--resume <uuid>`，每会话一个 git worktree。无 license
- **Crystal**（→ Nimbalyst）：同类 PTY/CLI 多会话管理器，2026-02 弃用，续作闭源
- **codex-web-local**：复刻 Codex Desktop UI 的本地 Web 壳，直接连 `codex app-server`（已归档，但代码是学习 app-server 协议的好样本）
- **claude-agent-ui**：Bun HTTP/SSE + Claude Agent SDK 的最小 Web Chat，适合当脚手架读

---

## 四、横向对比与趋势

### 适配方式分布

```
Claude Code 侧                          Codex 侧
─────────────────                       ─────────────────
Agent SDK:    happy, claudecodeui,      app-server:  vibe-kanban, happy,
              claude-agent-acp,                      codex-plugin-cc(官方),
              omnara新版, claude-agent-ui,           openclaw, codex-web-local,
              mindfs(Go移植版)                       openclaw-codex-app-server,
                                                     mindfs(Go SDK)
stream-json:  vibe-kanban, opcode,      codex-sdk:   claudecodeui
              crystal(弃), lobehub       (exec 封装)
ACP 复用:     AionUi, openclaw(acpx),   ACP 复用:    AionUi, openclaw(acpx), Zed
              Zed, mindfs(可选),                     mindfs(可选)
              lobehub(规划中)
                                        库内嵌:      codex-acp (codex-core crate)
PTY:          omnara旧版(弃), FleetCode  PTY:        FleetCode
```

### 三条明确趋势

1. **Claude 侧向 Agent SDK 收敛**：omnara（PTY→SDK）、claudecodeui（CLI spawn→SDK）都完成了迁移；仍用 stream-json 的（本项目、opcode）是因为需要进程级隔离或历史架构。stream-json 本身也是官方稳定接口，但 hooks/权限桥接要自己搭
2. **Codex 侧 app-server 是唯一全功能通道**：交互审批、线程 fork/resume、MCP 注入都只有它支持；`@openai/codex-sdk` 只适合 fire-and-forget 的 review 类场景。代价是协议随版本演进需要持续跟进（happy、本项目都专门维护协议适配层）
3. **ACP 正在成为"接所有 agent"的标准答案**：新一代 GUI（AionUi）干脆不写适配、直接分发官方 adapter 二进制；OpenClaw 用 acpx 一次性获得 6+ harness；MindFS 用一个通用 ACP 适配器覆盖 15 家长尾 agent。代价是 ACP 的能力交集小于各家原生协议（例如 Codex 的 thread fork、Claude 的 hooks 不在 ACP 标准里）——所以 MindFS、OpenClaw 都对 Claude/Codex 保留了原生适配，ACP 只接长尾
4. **第三方语言 SDK 生态已成型**：非 Node 技术栈不再需要手写协议 —— Go 有 `roasbeef/claude-agent-sdk-go`（Agent SDK 移植）、`fanwenlin/codex-go-sdk`（app-server 客户端）、`coder/acp-go-sdk`（ACP），MindFS 全部生产在用；Rust 有 openai/codex 官方协议 crates（本项目在用）和 Zed 的 ACP crate

### 对本项目的启示

- 本项目当前的"Claude stream-json + Codex app-server"组合与 happy 一致，是**全功能优先**的正确选型；维护成本集中在 Codex 协议跟进上（已有先例：0.137→0.138 适配）
- 若未来想低成本扩充 agent 支持面（如 Cursor、Goose、Kiro），可考虑增加一个 **ACP executor**：spawn 任意 ACP adapter 二进制即可接入，无需逐家写 executor
- Claude 侧若要做更深的权限/工具桥接（如移动端审批），happy 的 hooks 注入 + permission handler 模式是现成参考

---

## 五、关键源码索引

| 想看什么 | 去哪里 |
|----------|--------|
| Claude Agent SDK 进程内集成 + WebSocket 审批桥 | claudecodeui `server/claude-sdk.js` |
| Claude SDK 封装 + hooks 注入 + 会话 fork | happy `packages/happy-cli/src/claude/` |
| 手写 codex app-server JSON-RPC 客户端（含为何不用官方 SDK 的注释） | happy `packages/happy-cli/src/codex/codexAppServerClient.ts` |
| app-server broker 单例模式（多命令复用一个进程） | codex-plugin-cc `plugins/codex/scripts/lib/app-server.mjs` |
| Rust 侧 app-server 集成（官方协议 crate） | 本仓库 `crates/executors/src/executors/codex.rs` |
| Rust 侧 stream-json 集成 | 本仓库 `crates/executors/src/executors/claude.rs`、opcode `src-tauri/src/commands/claude.rs` |
| ACP adapter 实现（SDK→ACP / crate内嵌→ACP） | claude-agent-acp、codex-acp（`src/codex_agent.rs`） |
| ACP adapter 打包分发 | AionUi `scripts/prepare-managed-acp-tools.sh` |
| PTY 包装反面教材 | omnara `src/integrations/cli_wrappers/claude_code/claude_wrapper_v3.py` |
| Chat 产品接入 CLI agent 的事件映射层 | LobeHub `packages/heterogeneous-agents/src/`（types.ts 架构注释 + spawnAgent.ts） |
| Go 技术栈三协议组合（原生 claude/codex + 通用 ACP） | MindFS `server/internal/agent/`（claude/、codex/、acp/ 三个子包 + agents.json 注册表） |
| 协议/产品关系全景（一个产品四种机制并存） | OpenClaw `docs/tools/acp-agents.md`、`docs/cli/acp.md` |

## 六、参考链接

- OpenAI 官方博客：[Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness)
- [Claude Agent SDK 文档](https://code.claude.com/docs/en/agent-sdk/overview)
- [Agent Client Protocol](https://agentclientprotocol.com/)（[已接入的 Agents 列表](https://agentclientprotocol.com/get-started/agents)）
- [Zed External Agents 文档](https://zed.dev/docs/ai/external-agents)
- [Vercel AI SDK 的 ACP provider](https://ai-sdk.dev/providers/community-providers/acp)
