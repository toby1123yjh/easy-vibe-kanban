# Agent Runtime 竞品模型对比

> 状态：Draft · 基于 daily-radar 本地缓存快照

## 比较方法

统一从以下七个维度观察四个项目：

1. Agent 选择和注册如何完成。
2. Runtime、Transport、Session、Turn/Run 的边界在哪里。
3. 原生输入和原生输出是否被保留。
4. 统一事件如何表达消息、工具、审批、状态和错误。
5. Session 恢复、取消、重试和进程清理如何处理。
6. Agent 原生工具与平台工具的所有权如何划分。
7. 方案对 Vibe Kanban 本地 worktree 场景的可迁移性。

## AionUI：以会话和 ACP 连接为中心

参考文件：

- `iOfficeAI__AionUi/docs/prds/conversations/acp/session.md`
- `iOfficeAI__AionUi/docs/prds/conversations/acp/messaging.md`
- `iOfficeAI__AionUi/packages/desktop/src/common/types/platform/acpTypes.ts`
- `iOfficeAI__AionUi/packages/web-host/src/agent-process-registry.ts`

### 模型

```text
Conversation / Session
  ├── Agent backend / agent_type
  ├── ACP connection
  ├── model / mode / config options
  ├── MCP tools
  ├── queued messages
  └── reconnect / idle release / reset / migration
```

ACP 是主要的标准化接入边界。ACP 类型层覆盖 initialize capability、prompt capability、MCP capability、session capability、tool call、plan update 和 config option。

AionUI 还通过进程注册表记录 PID、进程组、conversation id 和 agent type，启动时执行异常进程回收。

### 优势

- Session 生命周期最完整，覆盖创建、连接、重连、停止、空闲释放、恢复、重置和删除。
- ACP capability negotiation 能动态发现 Agent 是否支持 resume、fork、MCP、图片和配置项。
- 消息队列、隐藏消息、静默消息、文件引用、首条消息注入等产品体验较成熟。
- 适合桌面端、多后端和长生命周期会话。

### 局限

- 抽象中心是用户可见的 Conversation，和 UI 消息、连接状态耦合较深。
- ACP 与历史 Agent backend 之间存在兼容分支，纯 Runtime 使用时会显得偏重。
- 在查看范围内没有发现明确独立的 native audit store 与 canonical event store 双轨模型。

### 对 VK 的启发

借鉴连接生命周期、能力协商、配置恢复和进程回收；不直接复制其 Conversation/UI 中心的组织方式。

## MultiCA：以统一 Backend 和真实 CLI 执行为中心

参考文件：

- `multica-ai__multica/server/pkg/agent/agent.go`
- `multica-ai__multica/server/pkg/agent/claude.go`
- `multica-ai__multica/docs/custom-runtimes.md`
- `multica-ai__multica/server/pkg/db/queries/task_message.sql`

### 模型

```go
type Backend interface {
    Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

```text
Session
  ├── Messages <-chan Message
  └── Result   <-chan Result
```

`ExecOptions` 集中表达 cwd、model、system prompt、timeout、resume session id、MCP、thinking level 和额外 CLI 参数。Backend 通常使用 `exec.Command` 启动真实 Agent CLI。

统一消息包括 `text`、`thinking`、`tool-use`、`tool-result`、`status`、`error` 和 `log`；Result 表达 completed、failed、aborted、timeout、cancelled 等终态。

Custom runtime profile 则把 command name、fixed args、custom args、绝对路径和版本检测纳入注册模型。

### 优势

- `Backend → Session → Messages + Result` 简洁直观，最容易落地。
- 真实 CLI 优先，贴近 VK 的本地编码工作流。
- Custom runtime profile 很适合接入异构 CLI。
- 运行时注册、任务状态、session resume 和重试结合得较好。

### 局限

- Message 偏扁平，字段常是字符串或 `map[string]any`，完整协议语义容易丢失。
- Session、Turn、RunAttempt 没有被明确分层。
- Provider-specific 解析逻辑较多地由 Backend 自己承担。
- 没有明确的原生协议审计与统一事件审计双轨。
- 任务队列和云端 Issue/Workspace 业务绑定较重，不适合整体搬到 VK。

### 对 VK 的启发

借鉴 Backend 接口、Session 流、Result 终态、Runtime Profile 和真实进程优先；把 Message 扩展为带 envelope、sequence 和 native reference 的事件模型。

## Happy：以 Backend、Transport 和消息同步为中心

参考文件：

- `slopus__happy/packages/happy-cli/src/agent/core/AgentBackend.ts`
- `slopus__happy/packages/happy-cli/src/agent/core/AgentMessage.ts`
- `slopus__happy/packages/happy-cli/src/agent/core/AgentRegistry.ts`
- `slopus__happy/packages/happy-cli/src/agent/transport/TransportHandler.ts`

### 模型

```text
AgentRegistry
  └── AgentBackend
        └── TransportHandler
              ├── stdout/stderr
              ├── tool detection
              ├── timeout / idle
              └── provider quirks
```

Backend 接口覆盖 `startSession`、`sendPrompt`、`cancel`、`onMessage`、permission response、等待响应完成和 `dispose`。

`AgentMessage` 覆盖 model output、status、tool call/result、permission、fs edit、terminal output、token count、exec approval 和 patch apply。公共事件与 provider-specific event 并存。

### 优势

- Backend、Message、Transport 三层拆分合理。
- Provider-specific 过滤、超时、工具名识别和 idle 判断被隔离在 Transport 层。
- AgentRegistry 适合做 Adapter/Factory 插件注册。
- 同时支持真实 CLI、ACP、MCP 和原生 Claude transport。
- 对远程同步、turn 完成、断线恢复和权限交互有较完整考虑。

### 局限

- `AgentMessage` union 会持续膨胀，部分字段使用 `unknown`，类型约束会变弱。
- ACP 与非 ACP 的权限语义不同，只能通过兼容接口表达。
- response complete 和 idle 判断包含 provider heuristic。
- 远程同步与本地 runtime 混合后，系统复杂度较高。
- 在查看范围内没有看到独立 native audit store 与 canonical event store 的清晰双轨实现。

### 对 VK 的启发

直接借鉴 Backend/Transport/Registry 的拆分，并将其扩大为 `Adapter + Transport + Decoder + Audit`，避免把远程同步职责带入本地 Runtime 核心。

## QM：以 Harness、Scope 和运行审计为中心

参考文件：

- `yc-software__qm/src/harness/harness.ts`
- `yc-software__qm/src/harness/harness-router.ts`
- `yc-software__qm/src/sessions/session-store.ts`
- `yc-software__qm/src/runs/session-state-bus.ts`
- `yc-software__qm/src/harness/tape-fold.ts`

### 模型

```text
Slack / Web / Cron
  → Orchestrator
  → Scope / policy
  → Harness Router
  → Provider Harness
  → Session / Run / Tape / Task / Memory / Audit
```

Harness 将能力拆成 turns、models 和 tools。`HarnessTurnInput` 携带 session、runId、input、history、system prompt、attachments、scope、tool context、审批门、tape callback 和 stream callback。

Provider 接入方式并不统一：Pi 使用 in-process，Codex 使用 App Server JSON-RPC，Claude 使用 Agent SDK + MCP，OpenCode 使用 HTTP sidecar + bridge。

QM 的显著取舍是通过 Tool Gateway 约束 Agent 原生工具，让 Scope、ACL、sandbox 和 credential capability 成为工具执行的主要边界。

### 优势

- Runtime、Scope、Permission 和 Audit 边界最清晰。
- Session、Run、Tape、Task 分层成熟。
- 支持 replay、tape folding、状态总线和子 Agent 任务化。
- `HarnessTurnInput` 适合复杂编排、回放和策略控制。

### 局限

- 对 VK 本地 worktree 场景过重。
- Tool Gateway 会收回 Agent 原生工具，可能损失 CLI 自身能力。
- 新增 Harness 通常需要同时实现工具桥接、事件映射、权限适配和注册。
- 更偏组织级 Agent 平台，而非本地 coding flow。

### 对 VK 的启发

借鉴 Session/Run/Tape/Task 分层、能力声明、状态折叠和回放；保留 VK 的原生工具所有权，不复制 QM 的全工具代理模式。

## 横向对照

| 维度 | AionUI | MultiCA | Happy | QM | VK 建议 |
|---|---|---|---|---|---|
| 核心抽象 | Conversation + ACP | Backend + Session | Backend + Transport | Harness + Scope | Session + Turn + RunAttempt |
| Session | 用户会话一等对象 | Agent 执行会话 | Agent session | 平台会话 | 逻辑会话与 provider session 分离 |
| Turn/Run | 连接更新隐含表达 | Task run 隐含表达 | turn start/end | Turn、Run、Task、Tape | Turn 表示意图，RunAttempt 表示执行尝试 |
| 统一输出 | ACP update | Message + Result | AgentMessage union | Event/Tape/State | Canonical envelope + provider extension |
| 原生审计 | 未见独立双轨 | 未见独立双轨 | 未见独立双轨 | Tape 较强 | Native Audit Store 独立保存 |
| 工具策略 | Agent 原生 + MCP | CLI 原生 | CLI/ACP/MCP | QM Gateway | Agent 原生，VK 观察和记录 |
| 最强项 | 生命周期 | 简洁落地 | 适配分层 | 策略与回放 | 直接替换后的清晰底座和可追溯性 |
| 主要风险 | UI/Session 耦合 | 事件过扁平 | union 膨胀 | 过度复杂、工具代理化 | 四 Runtime 与编排同时交付的实施面较大 |

## 结论

四个项目没有一个适合整体照搬。VK 最合适的组合是：

```text
AionUI  → Session 生命周期和能力协商
MultiCA → Backend / Session / Message / Result
Happy   → Adapter / Transport / Registry
QM      → Session / Turn / Run / Tape / Audit 分层
```

“统一”应该发生在事件 envelope、状态和平台控制面；不应该发生在原生协议、原生工具执行和所有 provider-specific payload 上。
