# Vibe Kanban Agent Runtime 目标架构

> 状态：Draft · 仅沉淀规划，不代表已批准实施

本文沉淀运行时语义、职责边界和设计取舍，不预先锁死 Rust trait、数据库表、文件目录或完整事件枚举。文中的接口、字段、状态和目录布局都是帮助实现者思考的参考形态。

## 1. 设计原则

### 先适配，再统一

Provider 原生输入和输出先由对应 adapter/transport 忠实管理，再解析为平台统一事件。统一事件不是原生协议的替代品。

输出转换采用显式三段链路：`NativeFrame → ProviderEvent → Canonical AgentEvent`。`NativeFrame` 保存 transport 收到的原始事实；`ProviderEvent` 表达已经解码、但仍属于特定 Provider 的语义；`Canonical AgentEvent` 才是平台公共事件或带命名空间的扩展。

### 双轨审计

Native Audit Store 保存完整原始交互；Canonical Event Store 保存面向 UI、状态和业务的规范化事件。两者通过稳定身份和引用关联，但职责、存储边界和读取入口分开。

### 原生工具归 Agent 所有

真实 Agent CLI/SDK 继续直接使用文件、命令和 MCP 工具，操作 VK 按协作模式准备的真实 workspace/worktree。VK 首期观察并记录工具调用，不重新实现所有工具。

### 运行对象分层

```text
Session
  └── Managed AgentRun (一个完整 Agent 任务)
        └── Turn (V1 为 1:1 发起输入)
              └── RunAttempt (1..N 次真实执行)
                    ├── ProviderStep / ModelCall
                    ├── Control Events
                    ├── Transport Process
                    ├── Native Input/Output
                    └── Canonical Events
```

- `Session`：长期逻辑会话，可跨进程恢复。
- `Managed AgentRun`：交给一个 Agent 的一个完整任务，是 VK 可独立调度、寻址、取消和观察的单位。
- `Turn`：该任务的发起输入；V1 与 AgentRun 一对一。后续新要求创建新的 Turn 和 AgentRun，但可以复用原 Session。
- `RunAttempt`：这个 AgentRun 的一次实际 process/transport 执行；崩溃、重试或恢复会产生新的 attempt。
- `ProviderStep`：RunAttempt 内可观察的细粒度 provider 步骤，例如一次模型调用、工具调用、工具结果、审批请求或协议阶段。

这种分层能准确表达“同一个用户请求第一次失败，第二次恢复执行”，避免将多次进程运行混成一条消息流。

一次 RunAttempt 可以包含多个模型调用和工具循环。RunAttempt 与 ModelCall/ProviderStep 保持不同语义：

```text
Turn: "实现登录功能"
  └── RunAttempt 1
        ├── ProviderStep: model_call
        ├── ProviderStep: tool_call (read_file)
        ├── ProviderStep: tool_result
        ├── ProviderStep: model_call
        ├── ProviderStep: tool_call (apply_patch)
        └── ProviderStep: model_call / completed
```

如果 Agent 协议没有显式暴露模型调用边界，可以记录为未知步骤，也可以通过 adapter 推断。推断结果适合标记为 derived/inferred，原始 frame 则作为更接近 Provider 的事实来源。

## 2. 设计层级与参考边界

### 设计关注点

以下内容是未来实现应持续关注的方向，而不是需要逐字实现的硬契约：

1. **保留原生事实**：尽量在有损归一化前保存 provider 原生输入和输出。
2. **保持可追溯性**：让 canonical event/state 能关联 native record，或标明它来自平台生成/推导。
3. **隔离 Provider 变化**：把私有协议的编码、解码和版本兼容收敛在 adapter/decoder 附近。
4. **区分运行语义**：保持 Session、Turn、RunAttempt、ProviderStep 和 Control Event 的概念差异。
5. **表达终态和乱序**：为重复、迟到、冲突和不完整事件留下表达空间。
6. **以能力为依据**：resume、steer、approval、images、MCP、usage 等行为由 capability 驱动，并区分 `native`、`emulated`、`unsupported` 和 `unknown`，禁止静默降级。
7. **保留原生工具空间**：V1 以观察和统一展示为主，不把工具接管作为前提。
8. **未发布项目直接替换**：V1 直接建立新事实源和调用链，不建设旧数据回填、双写、兼容投影或运行时双轨回退；契约和审计格式仍独立版本化。
9. **知识库与 Runtime 解耦**：V1 不实现 RAG、向量索引或长期记忆服务；已有知识源可以作为 Agent 原生 MCP/外部工具存在，不进入 Runtime Core。
10. **编排纳入 V1**：Runtime V1 同时覆盖多 Agent/task orchestration；平台级跨 Runtime 子运行与 Provider native subagents 分开建模，但共用审计、canonical event、能力、取消和终态语义。

### 模块参考来源

四个项目可以分别为不同模块提供参考，不需要整套照搬：

| 目标模块 | 主要参考 | 可借鉴内容 |
|---|---|---|
| Session 生命周期、恢复和进程回收 | AionUI | ACP session 能力、重连、空闲释放、Agent process registry |
| Backend、Runtime Profile、真实 CLI 执行 | MultiCA | `Backend → Session → Messages + Result`、custom runtime profile、版本检测 |
| Adapter、Transport、Registry | Happy | `AgentBackend / TransportHandler / AgentRegistry` 分层和 Provider heuristic 隔离 |
| Turn 输入、Run/Tape/Task、回放 | QM | rich turn input、运行记录、tape fold、replay、子任务状态 |
| Native/Canonical 双轨 | QM Tape + VK raw logs | 原始事实留存、状态投影和回放之间的关联方式 |

### 实现自由度

实现者可以自行决定：

- Rust 类型、trait 名称、方法签名和 crate 归属。
- Session、Turn、RunAttempt 的物理表名、字段分组和 crate 归属；它们必须直接构成新事实源。
- Native Audit writer 的缓冲、校验和索引实现；外部布局仍固定为版本化 `manifest.json + frames.jsonl`。
- Canonical event 使用 enum、tagged union、注册表还是其他类型表达。
- ProviderStep 是否持久化为独立实体，还是先由事件流和 projection 表达。
- 并发模型、channel 类型、任务调度器和 process supervisor 的内部实现。
- 四个目标 Runtime 工作流的内部实现顺序；这不改变 Gemini、Codex、Claude Code 和 Oh My Pi 同批交付的产品门槛。

评审重点是设计意图是否被保留、Provider 差异是否有合适落点、故障和恢复是否可观察，而不是实现是否逐字复制本文示例。

## 3. 目标组件图

```text
                    Vibe Kanban Runtime

[Run Request]
      │
      ├── canonical input audit
      ▼
[Agent Router / Runtime Profile]
      │
      ▼
[Provider Adapter]
      │  build command / encode request / resume / steer / approve
      ▼
[Process Supervisor]
      │  spawn / attach / observe / terminate / reconcile
      ▼
[Transport]
      │  stdio_cli / stdio_rpc / ACP / App Server JSON-RPC
      │  HTTP sidecar / in_process
      ├──────────────► [Native Input Journal]
      ▼
[Real Agent CLI / SDK / ACP / App Server / Sidecar]
      │
      ├──────────────► [Native Output Journal]
      ▼
[NativeFrame]
      │
      ▼
[Provider Decoder]
      │
      ▼
[ProviderEvent]
      │
      ▼
[Canonical Mapper]
      │
      ▼
[Canonical Event Envelope]
      ├──────────────► [Canonical Event Store: append-only]
      ├──────────────► [Run State Reducer → Snapshot]
      ├──────────────► [UI / WebSocket / Metrics]
      └──────────────► [Replay / Projection]
```

AgentRun Runtime Core 负责单个 Managed AgentRun 的身份、能力校验、平台状态机、控制命令和唯一终态；Process Supervisor 负责真实执行句柄、进程树、退出观察和重启对账。Orchestration Runtime 通过 AgentRunPort 组合多个 AgentRun。Adapter/Decoder 负责 provider 差异；Transport 只负责协议通道与 frame 收发；Store 和 UI 不直接依赖具体 CLI。组件可以在代码中合并实现，但职责和依赖方向必须保持清晰。

### Platform Orchestration 与 AgentRun 的组合边界

业务层使用顶层包含关系，但代码层通过端口组合，不把编排状态机嵌入单 Agent Runtime Core：

```text
Platform Product (Chat / Workflow / Arena)
  ├── Direct Managed AgentRun
  └── OrchestrationRun
        └── OrchestrationNodeExecution
              └── Managed AgentRun(s)

Managed AgentRun
  ├── Session / Turn / RunAttempt references
  └── Provider-native Agent Topology
```

| 层级 | 所有者 | 负责 | 不负责 |
|---|---|---|---|
| Platform Product | Workflow/Arena 等产品模块 | 流程图、工作区、Human Gate、候选方案、winner 选择 | Provider 协议和进程管理 |
| OrchestrationRun | Orchestration Runtime | 父子 identity、依赖、fan-out/join、取消传播、失败策略、恢复、结果聚合 | Workflow/Arena 的产品规则 |
| Managed AgentRun | AgentRun Runtime | 一个可独立启动、寻址、取消和观察的真实 Agent 执行 | 跨 Agent 产品编排 |
| Provider-native Agent Topology | Gemini/Codex/Claude Code/Oh My Pi | Provider 自己的 team/subagent 行为 | 默认不接受 VK 的独立调度假设 |

代码依赖保持单向：

```text
Workflow / Arena ──► OrchestrationService
                           │
                           ▼
                     AgentRunPort
                           │
                           ▼
                     AgentRunService
                           │
                           ▼
                 Adapter / Transport / Provider
```

- Orchestration Runtime 与 AgentRun Runtime 可以由同一个平台 package/crate 集合交付，但各自拥有状态机和 reducer。
- 单 Agent 产品入口直接调用 AgentRunService，不需要创建只有一个节点的空 OrchestrationRun。
- Workflow/Arena 的可编辑定义在启动时编译并冻结为不可变 `OrchestrationPlan Snapshot`；快照包含本次执行所需的拓扑、节点配置和策略。运行中编辑只影响后续 OrchestrationRun。
- Orchestration Runtime 是 Plan Snapshot 执行状态的唯一权威；崩溃恢复和重放继续使用原快照，不重新读取最新产品 graph 改写运行中拓扑。
- Plan Snapshot 可按节点或 fan-out group 固化失败策略。普通 Workflow 默认 `fail_fast`：必要子运行失败后当前步骤失败并取消不再需要的兄弟运行；Arena 默认 `allow_partial`：保留成功候选，只在全部候选失败时失败。
- Plan Snapshot 为 fan-in/join 节点独立固化 `all`、`any` 或 `each`。`all` 等全部适用上游终态确定后启动一次，`any` 在首个满足条件的成功结果到达后启动一次，`each` 为每个满足条件的成功结果分别启动一次；普通汇总默认 `all`，现有 Workflow 的逐上游触发语义映射为 `each`。
- Join reducer 持久化已消费的上游 execution identity 与创建出的下游 execution identity。重复事件、重放或重启不得重复启动下游；`any` 已触发后的迟到结果仍被记录，但不会再次触发同一 join execution。
- 下游交接正文使用最小 `UpstreamHandoff`：只投影每个被消费上游 AgentRun 的首条 canonical input message 和最终 canonical Agent output message，按消息边界取值，不按自然语言标点裁剪。完整 transcript、diff、文件列表、workspace 路径、ProviderEvent 和 Native Audit 不自动进入下游 prompt。
- `all` 按 Plan Snapshot 的稳定顺序投影全部上游 input/output 对，`any` 只投影实际触发者，`each` 的每个下游 execution 只投影本次触发者。source AgentRun identity 与 terminal status 仍作为内部 envelope metadata 支持关联、排序和去重，但不进入 handoff 正文。
- `allow_partial` 下，失败/取消上游计入 terminal upstream，但不属于 consumable handoff：`all` 等所有上游终态后只投影成功结果，`any` 跳过失败直到首个成功，`each` 只为成功结果创建下游 execution；全部失败产生聚合失败。缺少最终 Agent output 时保持 absent，不用 error、stderr 或状态文字伪造 `terminal_output`。
- `fail_fast` 在必要上游失败/取消后不创建下游 execution，并根据 Plan Snapshot 取消不再需要的兄弟 AgentRun；失败事实只保留在 Orchestration event/state 和审计链路中。
- `any` 另行固化 `remaining_upstreams = continue | cancel_remaining`，默认 `continue`。前者让尚未完成的上游继续；后者在首次成功触发后向活跃兄弟发送幂等、可审计的尽力取消命令。该策略不改变 join/failure policy。
- `cancel_remaining` 不回滚 workspace/worktree 修改。取消竞态中的迟到成功仍保留真实 AgentRun 终态和审计事实，但已持久化 trigger identity 的 `any` join 不得再次启动下游。
- 平台自动重试默认关闭；节点可在 Plan Snapshot 中显式固化最大 RunAttempt 数、backoff、retryable terminal kinds 和 `resume|restart` mode。每次平台 retry 在同一 AgentRun/Turn 下新增 RunAttempt，复用真实 workspace/worktree 且不回滚既有修改。
- `resume`/`restart` 必须经过 capability snapshot 校验，不支持或未知时显式拒绝。retry decision、到期时间和 attempt command identity 通过 event/outbox 持久化并幂等恢复，重启不得重复创建 attempt。
- Provider 在同一 process/transport 内执行的 API 限流重试、瞬时网络 backoff 或协议 reconnect 仍属于当前 RunAttempt，以 ProviderEvent/ProviderStep 记录，不消耗平台 retry 次数。
- V1 不设置 AgentRun/OrchestrationRun wall-clock timeout、idle timeout 或 deadline。`running`、`awaiting_approval` 和 `awaiting_input` 可以无限期持续；无输出、lease 过期或服务重启不得导致主动取消、失败或替换 process。
- 人工取消和 Plan Snapshot 的显式取消传播仍有效。Provider、OS 或外部执行环境报告的 timeout/termination 作为外部事实记录；VK 本身不启动计时器触发这些终态。
- Dispatcher/reconciler lease 只协调处理所有权，过期后执行状态查询和接管，不改变 AgentRun 生命周期。
- `each` 节点独立固化 `downstream_execution = parallel | serial`，默认 `parallel`。并行模式为每个成功上游事件立即写出幂等下游 create command；串行模式按上游成功 canonical sequence 写入持久队列，当前下游终态后再出队。
- V1 不设置全局 Runtime concurrency cap。串行队首可以无限期运行且不会超时跳过；并行共享 workspace 沿用无锁、无仲裁、无回滚语义。队列项、source identity 和 command id 保证重启后不遗漏、不重复。
- `awaiting_input|awaiting_approval` 只阻塞对应 node execution 及其依赖分支；其他 ready/running 分支继续调度。当没有可运行分支且仍有等待节点时，OrchestrationRun projection 聚合为非终态 `waiting_for_input|waiting_for_approval`，并可无限期持续。
- Input/approval response 通过 durable、幂等 control command 定向到原 AgentRun/RunAttempt。它继续原执行，不创建新 Plan Snapshot，也不允许当前产品 graph 的编辑渗入已冻结运行。
- 失败策略判定和兄弟取消写入 Orchestration canonical event；编排聚合终态不覆盖各 AgentRun 已经确定的独立终态。
- Plan Snapshot 同时固化 worktree 协作模式。`shared_workspace` 允许多个 AgentRun 在同一真实目录串行或并行执行，使代码、文件和中间产物直接互通；`isolated_worktree` 为每个 AgentRun 提供独立目录，由 Workflow/Arena 等产品层处理比较、diff apply 或 winner promotion。
- Worktree 是产品可选的协作策略，不是 Runtime 强制隔离边界。每个 AgentRun 固化实际 workspace/worktree reference，审计和 canonical event 记录其操作目录；Runtime 不得将显式共享目录静默替换成隔离副本。
- `shared_workspace` 并行模式不引入 Runtime 文件锁、目录锁或自动写入仲裁。Agent/Workflow 通过角色和任务边界自行协调；冲突、覆盖和部分修改作为真实执行结果保留，取消或失败不自动回滚 worktree。
- Orchestration Runtime 依赖窄 `AgentRunPort`；AgentRun Runtime 不引用 Orchestration 类型，也不判断自己是否处于工作流中。
- Orchestration node 逻辑上包含 AgentRun，存储上只引用稳定 `agent_run_id`、correlation 和聚合状态，不嵌入完整 Session、事件日志或进程对象。
- AgentRun canonical event 自下而上驱动编排状态；显式取消和策略命令自上而下传播。两层分别维持唯一确定终态。
- Provider 只暴露子任务事件时，将其记录为 ProviderStep/extension；暴露稳定子 Agent identity 时，保留 provider-native child topology。只有 VK 实际启动并能独立控制的执行才提升为 Managed AgentRun。
- 混合拓扑是合法的：一个 OrchestrationRun 可以同时调度 Claude Code、Codex 和 Oh My Pi，而每个 Managed AgentRun 内仍可保留该 Provider 的原生 team/subagent 树。

### 可靠调度与重启恢复

Orchestration Runtime 拥有独立于 AgentRun stream 的 append-only event log、reducer 和 projection。AgentRun canonical event 是编排输入事实，两层通过稳定 identity 关联，但不共享同一个状态机。

```text
Orchestration decision + outbox command (atomic persist)
                 ↓ at-least-once
            AgentRunPort
                 ↓ canonical events
        inbox + reducer cursor (atomic consume)
                 ↓
        Orchestration event/projection
```

- AgentRun create/cancel/resume 命令携带稳定 `command_id` 和 idempotency key。相同 key 必须解析为同一逻辑 AgentRun 或同一控制结果。
- 发送成功但 ACK 丢失时，dispatcher 先按 idempotency key 查询已有 AgentRun；不得直接启动第二个真实 process。
- AgentRun event 通过持久化 inbox（或等价边界）至少一次送达，消费者按 `event_id`/stream sequence 去重，并原子提交 Orchestration event、reducer cursor 与后续 outbox 命令。
- Lease 仅协调 dispatcher/reconciler 的处理权。lease 过期允许其他 worker 接管，但必须重新查询 AgentRun 的持久化状态。
- 服务启动时 reconciliation 扫描未确认 outbox、处理中 inbox、活跃 OrchestrationRun 和关联 AgentRun，补发幂等命令、补消费事件并重建 projection。

### 父子取消语义

取消是一个持久化、幂等的控制流程，不是立即改写整棵运行树状态的数据库操作：

- 显式取消 `OrchestrationRun` 后，父运行先进入非终态 `cancelling`，停止创建新的 node execution，并通过 outbox 向所有仍活跃且受管理的子 AgentRun 发送取消命令。
- 尚未 dispatch 的 node execution 直接进入 `cancelled`；新 schema、API 和 UI 必须表达该状态，不能复用 `skipped` 模糊取消事实。
- 父运行只有在所有活跃受管理子运行都确认终态后才进入 `cancelled`。进程仍存活、取消 ACK 不确定或 transport 暂时不可达时，父运行保持 `cancelling` 并由 reconciler 继续确认，不能提前宣称取消完成。
- 单独取消一个子 AgentRun 默认不取消父 OrchestrationRun。`fail_fast` 将必要子运行的取消视为该分支聚合失败并阻止下游；`allow_partial` 可以继续使用其他成功结果。只有显式父级取消才产生 OrchestrationRun 的 `cancelled` 终态。
- 重复取消请求解析为同一个 control command/result。取消请求后到达的真实子事件继续追加到审计和 AgentRun event stream，但不得重新打开已经确定终态的父运行，也不得重复触发 join。
- 显式取消可以先发送 Provider 原生 graceful cancel，再由 Supervisor 按取消策略结束进程树。这里的终止等待属于取消协议的一部分，不是 AgentRun timeout、idle timeout 或 deadline。

## 4. 组件职责

### AgentRun Runtime Core

负责一个 Managed AgentRun 的 Session/Turn/RunAttempt 关联、capability snapshot、canonical request/event、控制命令、事件顺序和唯一平台终态。它根据 Supervisor 和 Transport 上报的事实归约状态，但不持有 PID/进程组、子进程句柄或 provider 私有协议，也不依赖 Orchestration Runtime。

### Orchestration Runtime

接收产品层编译的不可变 OrchestrationPlan Snapshot，通过 `AgentRunPort` 创建、取消、恢复和观察 Managed AgentRun；维护 OrchestrationRun/node 的依赖、并发、`all|any|each` fan-in/join、失败传播和聚合终态。它只消费 canonical AgentRun 事件，不解析 ProviderEvent 或 NativeFrame，也不接管 Workflow/Arena 的可编辑产品模型。

### Agent Router

负责根据用户选择、项目配置和可用 runtime profile 选择 adapter。它不启动进程，也不解析 provider 输出。

### Runtime Profile

描述一个可启动的 Agent runtime。以下字段只是帮助讨论的参考集合，不要求原样实现：

```text
id
display_name
executable
protocol_family
fixed_args
custom_args
environment
capabilities
version_detector
```

`protocol_family` 首期使用可区分实际通道语义的值：`stdio_cli`、`stdio_rpc`、`acp`、`app_server_jsonrpc`、`http_sidecar` 或 `in_process`。Oh My Pi 明确使用 `stdio_rpc`，不能与一次性命令行输出混为普通 `stdio_cli`。Profile 不承担 Session 或业务状态。

#### Capability 解析语义

capability 不是简单的“支持/不支持”布尔值，而是带来源和执行约束的声明：

| 状态 | 含义 | 运行时行为 |
|---|---|---|
| `native` | Provider 当前版本直接支持该能力 | Adapter 只负责协议适配，按原生语义执行 |
| `emulated` | VK Adapter 使用兼容策略模拟该能力 | 仅在 profile/run policy 明确允许时执行，并记录模拟策略、限制和审计引用 |
| `unsupported` | 已确认当前 Provider/版本不支持 | 在启动或控制请求发送前显式拒绝 |
| `unknown` | 尚未确认，或版本/探测结果不足 | 可安全探测时先探测；仍未知则拒绝依赖该能力的操作 |

Runtime Profile 提供静态基线，Adapter 可以结合 executable/protocol 版本与 capability probe 解析实际能力。Runtime Core 在 RunAttempt 启动前校验请求所需能力，并将最终解析结果连同来源、版本和探测信息固化为本次执行的 capability snapshot，避免同一次运行中语义漂移。

禁止将 `native` 请求静默切换为 `emulated`、创建新 Session 或直接忽略。例如原生 resume 失败时，不能自动改用 transcript backfill；只有请求策略已明确允许对应 emulation 时才能走模拟路径，并产生可观察的 canonical control/event 与 native audit 记录。Provider 版本变化会使旧探测缓存失效，需要重新解析能力。

### Provider Adapter

#### Provider-owned CommandAdapter

The command surface is intentionally split by provider. Gemini, Codex, Claude
Code, and Oh My Pi each own a `CommandAdapter` next to their executor. The
adapter owns the provider's launch arguments, native command discovery/catalog,
initial/follow-up/resume shape, and native control encoding. The runtime only
routes the provider, gates capabilities, supervises the process, and persists
canonical/native audit records.

There is no central `ProviderCommandManager`, unified command CRUD model, or
cross-provider command inventory. Shared code is limited to low-level command
parsing/overrides, the provider-neutral `DirectControl` request vocabulary,
and newline-delimited JSON serialization. Provider slash-command parsers and
discovery helpers remain in their provider directory.

负责 provider-specific 行为。以下方法名只表达职责，不是预定的 trait：

```text
build_launch()
encode_native_input()
encode_follow_up()
encode_cancel_or_steer()
extract_provider_session_ref()
```

Provider 协议升级应限制在对应 adapter/decoder 和 fixture 中，不影响 Session、Run、UI 或统一存储。

### Process Supervisor

负责一次 RunAttempt 的真实执行句柄和 OS 级生命周期：

```text
spawn_or_attach
register_process_or_sidecar
observe_liveness_and_exit
request_graceful_cancel
force_terminate_after_explicit_cancel
cleanup_process_tree
reconcile_after_restart
```

Supervisor 接收 Adapter 生成的 launch specification，并向 Transport 提供可通信的句柄。它可以管理 CLI 进程、进程组和本地 sidecar；对于 `in_process` 或外部服务，它管理等价的 execution handle 和观察租约。Supervisor 只上报 `spawned`、`attached`、`exit_observed`、`unreachable`、`termination_requested` 等事实，不决定 AgentRun 应当重试、失败还是切换恢复模式。

服务启动时必须读取持久化 registry 和 RunAttempt 状态做 reconciliation。仍存活的 Agent 应重新关联或进入只读观察路径；确认已经退出时才上报外部终态。启动、lease 过期或 watcher 丢失都不能默认清理仍存活的 Agent。只有显式用户取消、编排取消、审计 fail-closed 清理或平台关闭策略明确要求时，Supervisor 才进入终止流程。

### Transport

负责协议连接、frame 边界和双向收发。以下方法名只表达能力边界：

```text
connect
send_frame
receive_frame
send_control_frame
close
```

Transport 处理 `stdio_cli`、`stdio_rpc`、ACP、App Server JSON-RPC、HTTP sidecar 或 `in_process` 通道，但不创建平台 identity，不决定消息如何展示或是否重试，也不拥有进程清理策略。Provider 的 graceful cancel 若表现为协议消息，由 Adapter 编码、Transport 发送；未响应时是否强制结束真实执行，由显式控制命令驱动 Supervisor 处理。

### Decoder / ProviderEvent / Canonical Mapper / State Reducer

- Decoder 只负责把 `NativeFrame` 解码为带类型的 `ProviderEvent`，不直接修改平台状态。
- `ProviderEvent` 保留 Provider 的语义和字段，例如 Codex exec approval、ACP plan update 或某个 CLI 的特殊 tool result；它不是普通 UI 的消费协议。
- Canonical Mapper 将 `ProviderEvent` 映射成公共 canonical event，或映射为带 provider namespace 的 extension。
- State Reducer 只根据 canonical event 计算当前 run state，并处理终态、顺序、重复和迟到消息。

三段链路允许分别测试：原生 fixture 能否正确解码、Provider 语义是否完整保留、平台投影是否符合公共契约。协议升级通常只影响 Decoder/ProviderEvent；平台语义变化通常只影响 Canonical Mapper 和 Reducer。

## 5. 输入模型

平台侧请求需要先形成可审计的 canonical input，再由 Adapter 生成 provider 原生输入。Canonical input 分成稳定任务意图和每次真实执行的解析结果，避免重试时覆盖原始需求：

```text
AgentRunRequestEnvelope
  ├── schema_version / request_id / idempotency_key
  ├── session_id / agent_run_id / turn_id
  ├── initiating_messages / system_prompt / attachments
  ├── workspace_ref / workspace_mode / cwd
  ├── requested_profile / model / reasoning / approval mode
  ├── required_capabilities / allowed_emulations
  └── optional orchestration_ref / trace_context

RunAttemptRequest
  ├── run_attempt_id / attempt_no / operation(initial|resume|restart)
  ├── resolved Runtime Profile and capability snapshot
  ├── provider_session_ref used by this attempt
  ├── adapter / runtime / protocol / mapper versions
  └── immutable reference to AgentRunRequestEnvelope
```

需要独立记录两份输入：

1. `canonical input`：VK 认为本次运行要执行的请求。
2. `native input`：Provider 实际收到的 argv、stdin frame、JSON-RPC request、ACP request 或 SDK 参数。

两份输入建议分别保留：原生输入回答“Provider 实际看到了什么”，统一输入回答“VK 计划执行什么”。

## 6. Canonical Event Envelope

建议统一事件使用 envelope，而不是建立一个不断扩张的扁平消息 union。字段名称和类型可以调整，设计时可以优先保留身份、顺序、来源、内容和 native reference 这些语义：

```text
AgentEventEnvelope
  ├── schema_version
  ├── event_id
  ├── session_id
  ├── agent_run_id
  ├── turn_id
  ├── run_attempt_id
  ├── sequence
  ├── timestamp
  ├── provider_id
  ├── transport
  ├── kind
  ├── common_payload
  ├── native_refs
  └── extension
        ├── provider_namespace
        ├── provider_event
        └── payload
```

公共事件主干可以包括以下类别；列表用于说明覆盖面，不是封闭枚举：

```text
run.started
turn.started
model.delta
model.completed
reasoning.delta
tool.started
tool.input
tool.completed
permission.requested
permission.resolved
file.changed
terminal.output
usage.updated
session.updated
run.completed
run.failed
run.cancelled
```

为了保持足够细的可观测性，事件还应区分三种层次：

```text
run.*       → 一次 RunAttempt 的生命周期和终态
step.*      → RunAttempt 内的 ProviderStep / ModelCall / tool loop
control.*   → approval、steer、cancel、resume 等控制输入
session.*   → provider session 建立、恢复、重置和失效
```

细粒度事件可以按下面的方式表达；实现者可以合并、拆分或增加事件，只要不同语义不会被错误混为一类：

```text
step.started
step.model_call.started
step.model_call.completed
step.tool_call.started
step.tool_call.input_delta
step.tool_call.completed
step.tool_result.received
step.permission.requested
step.permission.resolved
step.protocol_frame.received
control.approval.sent
control.steer.sent
control.cancel.sent
control.resume.started
```

Provider 独有事件可以通过 `extension` 保留，例如 ACP plan update、Codex exec approval request 或某个 CLI 的特殊 tool result。Extension 的定位是便于统一层消费，不取代 native audit。

每一条统一事件至少能定位到：

```text
run_id
session_id
provider_id
adapter_version
protocol_version
provider_session_ref
sequence
correlation_id
timestamp
native_ref
```

### 契约与版本策略

Request、Event 和 State 使用三个独立版本，不能用一个应用版本号代替持久化契约版本：

| 契约 | 版本字段 | 兼容规则 |
|---|---|---|
| `AgentRunRequestEnvelope` / `RunAttemptRequest` | `schema_version` | 当前 writer 只创建当前主版本；reader 可通过显式 upcaster 读取受支持旧版本 |
| `AgentEventEnvelope` | `schema_version`，事件 payload 可带 `payload_version` | 已落盘事件不原地改写；新增可选字段和新事件种类保持向后读取，删除、改义或改变必填字段时升级主版本 |
| `RunState` | `state_schema_version` + `reducer_version` | State 只是投影；任一版本变化都从 canonical event log 重算，不迁改历史事件来迎合新快照 |

版本使用单调整数主版本，而不是跟随 crate/npm 语义版本。`adapter_version`、`runtime_version`、`protocol_version` 和 `mapper_version` 独立固化在 RunAttempt 与事件来源信息中；它们描述“怎样得到这个事件”，不替代 canonical schema version。

Rust 类型是 canonical request/event/state 的唯一源码，放在不依赖具体 Provider 的共享 API/runtime 类型边界；TypeScript 通过 `ts-rs` 和 `pnpm run generate-types` 生成，不能直接修改 `shared/types.ts`。HTTP、WebSocket、持久化和回放使用同一个版本化 envelope。未知的可选字段允许保留或忽略；未知主版本、未知必需 capability 或会影响状态机的未知事件必须显式拒绝或把 projection 标记为 degraded，不能静默丢弃。

读取旧 canonical event 时优先使用纯函数 upcaster 转换到当前 reducer 输入。若无法无损 upcast，则使用该 RunAttempt 固化的 Adapter/Decoder/Mapper 版本从 Native Audit 生成新的 projection generation；旧 canonical stream 继续保留用于审计，不在原位置覆写。Provider extension 按 namespace 自行版本化，并始终允许回退到 native reference 获取完整事实。

### Canonical Event Log 与 RunState Projection

Canonical Event Store 使用 append-only event log。已经持久化的事件不原地覆盖；修正、补偿和迟到信息通过追加新事件表达。事件日志是平台语义层的完整历史，但仍可从对应 Native Audit 和 adapter/protocol version 重新生成。

Run State Reducer 按稳定顺序消费 canonical event，生成面向查询、UI 和 WebSocket 的 `RunState`。RunState 可以保存为快照或物化投影，但不是唯一事实来源：

```text
Native Audit
    ↓ Decoder / Mapper replay
Canonical Event Log (append-only)
    ↓ deterministic Reducer
RunState Snapshot
```

Reducer 需要可重复执行，并为重复、迟到、冲突和终态事件定义确定性规则。快照应记录 reducer/schema version 和最后应用的 event sequence；快照缺失或版本变化时，可以从 canonical event log 重算。

## 7. Native Audit Store

Native Audit Store 与 canonical event/state 使用独立存储边界。V1 沿用 `utils::assets::asset_dir()` 作为可迁移的数据根，并使用独立的版本化子目录：

```text
<asset_dir>/runtime/native-audit/v1/
  sessions/<session_prefix>/<session_id>/
    agent-runs/<agent_run_id>/
      attempts/<run_attempt_id>/
        manifest.json
        frames.jsonl
```

`frames.jsonl` 是单一有序、append-only 的原生 frame 流。每条记录至少包含 `audit_format_version`、`sequence`、时间、方向、transport channel、content type、原始 payload 的无损编码、payload hash 和 correlation identity。stdin/stdout/stderr、RPC request/response/notification 和 sidecar frame 使用同一序列保存，避免拆成 input/output 文件后丢失交错顺序。二进制或要求逐字节回放的内容使用 base64；解析后的提示信息只能作为附加元数据，不能替代原始 payload。

`manifest.json` 保存 Session/AgentRun/Turn/RunAttempt identity、Provider、workspace reference、runtime/adapter/protocol/mapper 版本、frame 数量、起止 sequence、完整性状态和最终 checksum。Frame 一旦 append 不再修改；manifest 通过原子替换从 `open` 更新为 `complete|audit_failed|recovered`。

SQLite 使用一条 `native_audit_streams` 索引记录关联一个 RunAttempt，至少保存相对路径、格式版本、Provider 与各协议版本、sequence 范围、frame count、checksum、完整性状态和 created/closed time。索引只保存定位和校验元数据，不保存高容量 provider payload；路径必须相对 `asset_dir`，保证开发与发布目录可以迁移。

导出格式与 decoder fixture 使用同一个版本化 Audit Bundle：`manifest.json + frames.jsonl` 是必需文件；需要做回归夹具时可附加 `expected-provider-events.jsonl` 和 `expected-agent-events.jsonl`。导出不脱敏、不改写 payload，并在 manifest 明确标记内容按本地可信模型原样保存。Fixture runner 必须校验 audit/runtime/adapter/protocol/mapper 版本和 checksum，不允许用不匹配的 decoder 悄悄回放。

首期偏好：

- 按原文保存。
- 不做脱敏。
- 不做周期清理。
- 不引入用户、管理员或 RBAC。
- 提供程序化读取、定位、导出和 fixture 回放能力。
- 普通对话 UI 不直接读取 native journal。

### 写入顺序与失败策略

Native Audit 是不可替代的 Provider 事实层，采用 write-ahead/fail-closed 语义：

1. canonical input 持久化成功后，Adapter 才能生成和发送原生输入。
2. native input 持久化成功后，Transport 才能把内容发送给 Agent。
3. native output frame 持久化成功后，Decoder 才能生成 ProviderEvent 和 canonical event。
4. canonical input、native input 或 native output 写入失败时，当前 RunAttempt 不继续产生未审计操作；尚未启动的 Agent 不启动，已经运行的 Agent进入取消/清理流程，并记录 `audit_failed` 终态或错误原因。
5. canonical event/state 写入失败时，可以让 Agent 继续运行，但 RunAttempt 标记为 `projection_degraded`；后续根据 Native Audit 使用对应 adapter/protocol version 重放并重建 canonical projection。

fail-closed 只阻止后续未审计操作，不承诺回滚 Agent 已经对 worktree 产生的修改。Runtime Core 仍需按失败时点决定 RunAttempt 终态并命令 Process Supervisor 执行清理，在可用的运行元数据或 Native Audit 中记录降级原因。

## 8. 生命周期与终态

```text
created
  → starting
  → running
  → awaiting_approval / awaiting_input / resuming
  → completed
  → failed / cancelled / timed_out / crashed / protocol_error / transport_error
```

上面的状态用于说明希望区分的语义，不要求数据库使用完全相同的枚举。`timed_out` 只用于如实映射 Provider、OS 或外部执行环境报告的事实，V1 的 VK Runtime 不主动施加 timeout。Provider-specific 状态可以保留在 extension 中，平台 reducer 再映射到适合 UI 和业务的状态。

Runtime Core 的评价重点可以放在：

- 可以让一个 RunAttempt 只有一个平台终态，并为迟到、重复和冲突事件预留表达方式。
- 显式取消、外部 timeout 事实和进程退出适合分别记录，避免在状态投影中互相覆盖。
- stdout、stderr、协议 frame 可以在原生 journal 中保留顺序和方向信息。
- canonical event 可以使用单调 sequence，或选择等价的排序/去重机制。
- ProviderStep 可以拥有独立的 `step_id`、开始/结束时间、状态、父步骤和 native references。
- `approval`、`steer`、`cancel` 和 `resume` 可以作为 Control Event；默认不把它们当作新的用户 Turn。
- Agent 完成后用户提交的新提示词通常创建新的 Turn；自动重试或恢复通常沿用原 Turn、创建新的 RunAttempt。
- 进程清理和 session 状态更新适合相互独立，减少单个 provider 故障的扩散。

## 9. 现有 VK 到新架构的直接替换

项目尚未正式发布，因此本节描述代码职责如何被新组件接管，而不是历史数据如何迁移。V1 不保留旧运行记录，不建立双写、兼容投影或旧执行路径回退开关；开发数据库可以在 schema 变更后重置并重建。

| 当前能力 | 新权威组件 | 直接替换规则 |
|---|---|---|
| `StandardCodingAgentExecutor` | AgentRun Runtime Core + Provider Adapter | 抽取公共运行语义后删除旧聚合入口；四个目标 Runtime 都必须直接实现新端口 |
| 各 executor 的启动参数 | Runtime Profile + Provider Adapter | 公共字段进入 profile，协议私有字段留在对应 Adapter |
| `execution_processes` 与内存 watcher | RunAttempt + persistent process registry + Supervisor | 新 RunAttempt 直接拥有进程引用和观测状态，不回填旧进程记录 |
| `coding_agent_turns` | Agent Turn + canonical event/state | canonical input、最终输出和 provider session observation 直接写新事实源 |
| provider `normalize_logs` | Provider Decoder + Canonical Mapper | 原始 frame 先写 Native Audit，再解码为 ProviderEvent 并映射 canonical event；旧 normalizer 在消费者切换后删除 |
| `MsgStore` Agent timeline | Canonical Event Store + RunState projection | UI、WebSocket、通知、统计和历史回放直接读取 canonical API |
| `AgentRuntimeEvent` | versioned Canonical Event Envelope | 用新 envelope、native references 和 provider extension 替换旧事件定义 |
| provider session id | Session provider reference | 与平台 Session、AgentRun 和 Turn 解耦存储 |
| transcript backfill | Adapter resume policy | 只允许显式声明的 `emulated` 能力；native resume 失败不得静默切换 |
| approval bridge | Runtime control plane | 保留审批能力，但不接管 Agent 的全部原生工具 |
| `workflow_runtime` Agent Step | Platform Product + Orchestration Runtime | 保留 graph、workspace 和 Human Gate 产品语义，直接通过新 `AgentRunPort` 创建和观察 AgentRun |
| Arena group/attempt | Platform Product + Orchestration Runtime | 保留候选 workspace、winner 和 diff apply，直接复用父子运行、取消、失败和聚合事件 |

### 新存储事实源

推荐的逻辑存储分组如下；实施时可以按 crate 边界调整表名，但不能改变 identity、唯一性和事实源边界：

```text
AgentRun Runtime
  sessions
  agent_provider_sessions
  agent_runs
  agent_turns
  agent_run_attempts
  agent_process_registry        # persistent process/transport observation
  agent_events                  # append-only canonical stream
  agent_run_state               # reducer projection
  native_audit_streams          # file index/integrity metadata

Orchestration Runtime
  orchestration_runs            # immutable plan snapshot + aggregate identity
  orchestration_node_executions
  orchestration_agent_run_links
  orchestration_events          # append-only orchestration stream
  orchestration_state           # reducer projection
  orchestration_outbox
  orchestration_inbox
  orchestration_consumption     # event cursor/join source consumption
  orchestration_leases
```

- `sessions` 可以保留现有逻辑 identity 和产品关系，但按新契约直接调整 schema；无需读取或转换旧行。
- `agent_provider_sessions` 独立关联 platform Session、provider/profile 和 provider session reference。
- `agent_runs`、`agent_turns` 和 `agent_run_attempts` 在启动前获得稳定 identity；进程元数据直接属于新 RunAttempt 和 persistent process registry。
- canonical event log 与 RunState projection 物理分开；Native Audit 的高容量 payload 位于版本化 JSONL 文件中，SQLite 只保存索引和完整性元数据。
- generic orchestration 表保存冻结 plan、运行 identity、node execution、AgentRun link、事件、outbox/inbox、cursor 和 lease。Workflow/Arena 产品表可以直接调整为引用新 Orchestration identity，不维护旧 API 数据形状。

### 新 AgentRunPort

`AgentRunPort` 是 Orchestration Runtime 与 AgentRun Runtime 之间的窄接口，不是旧 Executor 的桥：

1. `create` 在启动前创建或解析稳定的 `agent_run_id`、`turn_id`、`run_attempt_id` 和 command idempotency key。
2. 重复 command 或不确定 ACK 必须先查询同一逻辑对象，不得重复 spawn。
3. `query` 和 `subscribe` 只返回 canonical event/state，不从旧日志或进程表拼装事件。
4. `control` 持久化 input、approval、cancel 和 resume 命令及结果，再由 Adapter/Supervisor 执行。
5. Workflow/Arena 只依赖该端口，不直接调用 Provider Executor 或轮询进程表。

### V1 Runtime 清单

- Gemini、Codex、Claude Code 和 Oh My Pi 是唯一的一等 Runtime，四者作为同一个 V1 交付门槛。
- Oh My Pi 使用 `can1357/oh-my-pi` 的真实 `omp --mode rpc` 外部进程和 `stdio_rpc` NDJSON，不嵌入 Node SDK。
- Amp、OpenCode、Cursor Agent、Qwen Code、Copilot 和 Droid 从产品入口、Runtime registry、配置、生成契约和测试 fixture 中删除；引用清理完成后删除对应旧 Adapter/Executor。
- 删除非目标 Runtime 后不得保留不可达的 enum variant、默认配置、安装检测、图标、命令构造或 UI 选择项。

### V1 验收门槛

- 四个 Adapter 的 initial、follow-up、review、cancel、approval、resume 和各自声明的 capability 路径通过测试。
- Native Audit 完整、可定位，并能使用固化的 adapter/protocol/mapper version 确定性回放。
- Canonical Reducer 回放结果确定，UI、WebSocket、通知、统计和历史回放只依赖 canonical event/state。
- Orchestration 的 outbox/inbox、幂等、fan-out/join、取消、等待、重试和跨重启恢复通过测试。
- 启动恢复能够 attach/query/reconcile 存活进程，不默认 kill、fail 或重复 spawn。
- 四个目标 Runtime 中任一未达标，V1 就未完成；不以保留旧路径作为部分交付方案。

## 10. 推荐实施阶段

### 阶段 0：冻结契约并建立新 Schema

- 固化 Session、AgentRun、Turn、RunAttempt、ProviderStep 和 Orchestration identity。
- 固化 request/event/state 独立版本、Rust/`ts-rs` 生成边界和 capability 四态。
- 直接建立新 Runtime 与 Orchestration schema；开发数据库按新 schema 重置，不编写旧数据 backfill。

### 阶段 1：建立 Native Audit 与回放基线

- 落地版本化 Native Audit 目录、SQLite 索引、checksum、导出和 Audit Bundle fixture runner。
- 实现 canonical input、native input/output 和 canonical projection 的 write-ahead/fail-closed 顺序。
- 验证 native 写失败、`projection_degraded`、回放重建和版本不匹配。

### 阶段 2：建立 Supervisor、Transport 与 Reconciliation

- 分离 Runtime Core、Process Supervisor 和 Transport 的职责。
- 建立 persistent process registry 和 attach/query/reconcile 流程。
- 替换启动时清理 registered Agent process 和 running Workflow node 直接判失败的行为。

### 阶段 3：实现四个目标 Adapter

- 同时覆盖 Gemini、Codex、Claude Code 和 Oh My Pi，不设置单一试点。
- 为每个 Runtime 实现启动、续聊、取消、审批、输出解析、capability snapshot 和 native fixture/replay。
- 每个 Adapter 直接产生 ProviderEvent 和 canonical event，不调用旧 normalizer。

### 阶段 4：建立 Platform Orchestration

- 建立 OrchestrationRun/node identity、frozen plan、event/reducer、outbox/inbox、cursor 和 lease。
- 通过新 `AgentRunPort` 实现 fan-out/join、父子取消、失败策略、等待分支、重试和混合 Runtime 拓扑。
- 将 Workflow/Arena 的 Agent 启动和状态观察改为调用 Orchestration Runtime，同时保留各自产品语义。

### 阶段 5：切换 Canonical 消费者

- UI、WebSocket、通知、统计和历史回放直接接入 canonical event/state API。
- 覆盖 initial/follow-up/review、tool/approval/input wait、取消、失败、usage、resume、迟到事件和历史重载。
- 产品消费者切换完成后删除旧 MsgStore Agent timeline 和 provider normalizer 依赖。

### 阶段 6：删除旧代码并完整验证

- 删除 Legacy bridge、双写、旧 Executor/normalizer、旧运行存储和任何运行时回退配置。
- 删除六个非目标 Agent 的产品入口、registry/config/schema 引用和 Adapter/Executor。
- 运行四 Runtime、Native Audit、Reducer、Orchestration、restart reconciliation、前端和全 workspace 验证。
- 每个阶段以独立 Git commit 作为回滚点；失败时回退代码并重新部署，必要时重置开发数据库，不恢复运行时双轨。

## 11. 重要取舍

### 为什么不只使用一个统一 Message union？

因为工具调用、审批、计划、补丁、usage 和 provider 特有控制消息的字段差异很大。扁平 union 会出现大量可选字段或 `unknown`，最终既不安全又丢语义。

### 为什么不让 QM Tool Gateway 成为首期方案？

VK 当前的价值在真实 worktree 和原生 coding CLI。首期接管所有工具会把适配范围扩大到文件系统、命令、MCP、权限和沙箱，反而推迟底座重构本身。可以保留未来 Tool Gateway 的控制面扩展点。

### 为什么原生输入也应审计？

只保存输出无法解释“VK 生成了什么请求、Adapter 如何改写了请求、Provider 实际收到了什么”。原生输入是协议升级、恢复失败和适配回归的必要证据。

### 为什么 V1 不包含知识库？

知识摄取、切片、Embedding、索引、检索策略和长期记忆具有独立的数据生命周期与质量指标，不属于异构 Agent 的进程、协议、事件和状态底座。将两者同时建设会放大首期范围。Runtime 保留 Agent 原生 MCP 和外部工具能力，因此未来知识库可以作为独立 Context/Tool 服务接入，而不需要侵入 Adapter、Transport 或 Native Audit 核心链路。

## 12. 已解决的实施边界

- 项目未发布，存储直接采用新的 Session、AgentRun、Turn、RunAttempt、process registry、canonical event/state 和 orchestration schema；不保留旧数据转换或旧表投影。
- canonical request/event/state 分别版本化，Rust 为唯一契约源码，TypeScript 通过 `ts-rs` 生成。
- Runtime Core、Process Supervisor 与 Transport 的职责已经分开；实现可以合并模块，但不能重新混淆 identity/state、OS 进程生命周期和协议通道。
- Native Audit 根目录、JSONL/manifest、SQLite 索引和 Audit Bundle 导出/fixture 格式已经固化为版本化方案。
- 多 Agent 采用 generic Orchestration Runtime，Workflow/Arena 直接引用新 Orchestration identity 并保留产品所有权。
- 长任务在服务启动时执行 reconciliation，不默认终止注册进程或把 running Workflow node 判失败。

实施阶段仍允许根据代码边界调整 trait、crate 和物理表名，但任何调整都必须保持本文的身份、审计、幂等、终态、取消和整体交付门槛。
