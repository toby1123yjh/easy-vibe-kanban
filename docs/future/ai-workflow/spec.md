# AI Workflow — 功能规格（Spec）

> 状态：Draft · 创建于 2026-05-08 · 上层路线图见 [`docs/future/future_task.md`](../future_task.md) §T1-1 进化版

---

## 1. 一句话目标

> 让用户在**可视化画布**上把多个 AI agent 接成有向图（DAG），画布上节点逐步流转、边动态高亮、节点内实时流式输出 agent 文本，每个节点的执行复用现有 worktree/session 设施；最小可用版仅支持**节点之间传纯文本**，外部触发器只保留接口扩展点不实现。

**为什么命名 "AI Workflow"**：与已有 `ai-arena` 同级、含义直白；产品名称在 UI 文案上可叫 "Studio" / "Canvas"，待 P1 文案 review 决定。

**与 AI Arena 的关系**：Arena 是「同一阶段并行 N agent 用户挑 1」；Workflow 是「跨阶段串联多 agent」。Arena 在 Workflow 中作为一种特殊**子图节点**重新出现（见 §4.2 节点类型 C-2）。

---

## 2. 用户故事

### 主路径

```
作为 用 vibe-kanban 调度多 agent 的工程师
我想 把"plan(claude opus) → impl(codex) → review(gemini)"这种多阶段套路画成一张图保存为模板
为了 一张卡片一键跑完整链路，不用每次手动开 N 个 workspace 串接
```

### 支线场景

| ID | 场景 |
|---|---|
| US-1 | 在 Project 设置里打开 "Workflows" 页 → 新建 → 拖出节点 + 连边 → 保存 |
| US-2 | 在 Issue 详情页选 "Run as workflow" → 选模板 → 一键启动；画布弹出运行视图 |
| US-3 | 运行视图里实时看节点状态色变（idle→running→done/failed）+ 边"流光"动画 + 节点内 token streaming |
| US-4 | 某节点跑到一半失败 → 该节点橙色高亮 + 错误悬浮 → 用户可单节点 retry，不重跑前置 |
| US-5 | 节点链中插入一个 **Human Gate** 节点 → 工作流暂停 → 用户在画布上点 "approve" 才推进 |
| US-6 | 节点链中插入一个 **Arena** 节点 → 工作流到此 fan-out 成 v2 Arena → 用户 promote 一个后工作流继续 |
| US-7 | 模板可导出为 YAML / 从 YAML 导入；后续支持模板分享市场 |
| US-8 | 一个工作流 run 完成后，运行视图保留为"回放"，可以重看每个节点的输入输出文本 |

### 非目标（Out of Scope，V1 不做）

- ❌ 节点之间传**结构化 JSON**（仅传 string；JSONPath / 字段映射推迟到 V2）
- ❌ **外部触发器**实际实现（webhook / PR comment / schedule）；仅在 API 层保留 `trigger_source` 字段与 placeholder 端点
- ❌ 跨 project 模板分享市场（V2）
- ❌ 模板版本控制 / 历史 diff（V2）
- ❌ 多人实时协作编辑（Yjs/CRDT，V3）
- ❌ 工作流嵌套工作流（仅支持 Arena 子图节点，不做"workflow as node"递归）
- ❌ 自定义 Rust/Python 节点插件（V2 用 JS sandbox 即可）

---

## 3. 核心设计决策（已锁定）

### 3.1 数据流契约：纯文本

- 每条 edge 在运行时承载一个 `String` payload，**不解析结构**
- 多入度节点：所有上游 output 按"上游节点显示名 + 输出"格式拼接喂入下游
  ```
  <plan node="Plan">
  ...上游 plan 节点输出...
  </plan>
  <critique node="Critique">
  ...上游 critique 节点输出...
  </critique>
  ```
- 节点的 prompt_template 使用 **`{{# ... #}}` 语法**（dify 风格，避免与 LLM prompt 中字面 `{{ }}` Jinja 模板冲突 —— 来自对标项目 findings §13 #12）：
  - `{{#nodes.plan.output#}}` —— 取指定上游节点的 output
  - `{{#nodes.plan.output.field[0]#}}` —— 嵌套对象 + 数组下标（参考 circuit `{{NodeName.field.path}}`，支持任意 JSON 路径）
  - `{{#prev#}}` —— 单上游时的语法糖
  - `{{#run.input#}}` —— 整个 run 的初始输入（issue title + description）
- **Why 纯文本**：① 符合 LLM 自然交互模型；② 避免 V1 就被"如何描述 schema"吞掉工程量；③ V2 加 JSON 路径时是**叠加**而非破坏（保留 string 通道作为 fallback）

### 3.2 触发器：接口先行，实现后做

- DB 层：`workflow_runs.trigger_source TEXT NOT NULL DEFAULT 'manual'`，未来值会包括 `webhook` / `pr_comment` / `cron` / `kanban_state_change` / `im_telegram` / `im_wechat` / `im_lark`（IM 触发参考 AionUi —— findings §13 #14）
- API 层：`POST /api/local/v1/workflows/{id}/trigger` 接受 `{ trigger_source: "manual", input_text, issue_id? }`
- V1 仅 UI 调用，`trigger_source` 永远写 `manual`；V2 加新源时**只新增分发器**，DB / API 不动

### 3.3 执行单元：每个 Agent 节点 = 一个 session

- 不发明新的执行原语；Workflow runner 调用现有 `crates/server/src/routes/workspaces/execution.rs` 流程
- **共享 worktree** vs **每节点独立 worktree** 的选择：
  - V1 默认整个 run **共用一个 workspace + 一个 worktree**（节点串行/拓扑化跑在同一份代码上）
  - 这样每个 Agent 节点之间真正的"代码改动"通过 git 自然累积
  - 例外：**Arena 节点**内部各 attempt 各自独立 worktree（沿用 v2 行为）
- **Why 共享 worktree**：① 模拟人类工程师"接力开发"；② 避免 N 节点 = N worktree 的磁盘炸；③ 与现有 v1/v2 Arena 的"阶段内并行"形成清晰对比

---

## 4. 节点类型（V1 必备）

每种节点都遵循 "string in → string out" 契约。

### 4.1 类别概览

| 类别 | 节点 | V1 必须 | 说明 |
|---|---|---|---|
| A | **Start** | ✅ | run 入口，输出 = `run.input_text` |
| A | **End** | ✅ | run 出口，收集最终输出，标记完成 |
| B | **Agent** | ✅ | 跑一个 executor，最常用 |
| C-1 | **Condition** | ✅ | 规则数组 + AND/OR 判断走哪条边（参考 circuit） |
| C-2 | **Arena** | ⚠️ V1 占位，P3 实装 | 嵌入 v2 Arena 子图 |
| C-3 | **ConditionAgent** | ⚠️ V2 新增 | LLM 驱动语义分支（参考 Flowise） |
| D | **Loop** | ⚠️ V1 占位，P3 实装 | until / for-each |
| E | **Human Gate** | ✅ | 暂停等用户点确认；V2 加 rejection 边 + handler |
| F | **Transform** | ✅ | 纯 JS 文本处理（regex / slice / 拼接） |
| G-1 | **StickyNote** | ✅ | 画布注释，零执行（参考 Flowise） |

### 4.2 节点详细规格

#### A · Start

- 入度 0，出度 ≥ 1
- 配置：无（输出 = 整个 run 的 `input_text`）
- 输出：string

#### A · End

- 入度 ≥ 1，出度 0
- 多入度时按 §3.1 拼接为最终 run output
- 配置：可选 `final_message_template`（默认是上游纯输出）

#### B · Agent

- 入度 ≥ 0（≥1 则 prompt 可引用 `{{#prev#}}`），出度 ≥ 1
- 配置：
  ```yaml
  executor: claude-code | codex | gemini-cli | ...   # 复用 BaseCodingAgent enum
  variant: opus-4.6 | gpt-5-codex | ...              # 同 Arena attempts
  prompt_template: "Implement based on plan: {{#nodes.plan.output#}}"
  output_capture: last_message | all_messages | final_diff_summary
  conversation_mode: fresh | persist                  # V2 字段，默认 fresh；persist 时同 executor 跨节点保留上下文（参考 circuit）
  mcp_servers: [server_id_1, server_id_2]            # V2 字段，引用 project 级 MCP 配置；与 T0-2 MCP 面板打通（参考 circuit）
  search_aliases: [implement, build, write code]     # 编辑器键盘搜索建节点时的别名（参考 ComfyUI SEARCH_ALIASES）
  tooltip: "Run a coding agent on the current worktree"
  output_tooltips: ["The agent's final message text"]
  ```
- 运行：在该 run 的共享 workspace 上启动一个新 session，等其完成，把 session 的最终消息文本作为 output
- 输出：string（默认 = agent 的最后一条 message）

#### C-1 · Condition

- 入度 ≥ 1，出度 ≥ 2（每条出边带一个 label）
- 配置（**采用 circuit 风格的规则数组 + AND/OR**，比单 JS 表达式可读、可视化编辑友好、且无需沙箱）：
  ```yaml
  conditions:
    - { input_reference: "{{#prev#}}", operator: contains, compare_value: "LGTM" }
    - { input_reference: "{{#prev#}}", operator: not_contains, compare_value: "FAIL", joiner: and }
  branches:
    - { label: "yes", target: node_id_a }     # 所有 conditions 满足时走
    - { label: "no",  target: node_id_b }     # 不满足时走
    - { label: "default", target: node_id_c } # conditions 解析异常时兜底
  search_aliases: [if, branch, switch, route]
  ```
- 支持 11 个 operator（参考 circuit）：`equals` / `not_equals` / `contains` / `not_contains` / `greater_than` / `less_than` / `greater_than_or_equals` / `less_than_or_equals` / `is_empty` / `is_not_empty` / `regex`
- joiner：`and`（默认）/ `or`，组合规则
- 运行：按规则数组求值（**不再用 JS 沙箱**，§8.3 也相应简化），结果走对应 branch
- 输出：string（直接透传 input）
- **何时还需要 JS**：复杂判断走 §4.2 F-Transform 节点先把上游输出转成 yes/no/数字再喂给 Condition；或用 §4.2 C-3 ConditionAgent 让 LLM 来判断

#### C-2 · Arena 子图（占位 V1，实装 P3）

- 入度 ≥ 1，出度 ≥ 1
- 配置：
  ```yaml
  attempts:
    - { executor: claude-code, variant: opus-4.6 }
    - { executor: codex,       variant: gpt-5-codex }
    - { executor: gemini-cli,  variant: 2.5-pro }
  promote_strategy: manual    # V1 仅 manual；V2 可选 first_done / human_judge_node
  ```
- 运行：在该节点处创建一个 v2 Arena group（每 attempt 独立 worktree），暂停工作流；用户在 Arena 视图 promote 一个后，把 promoted attempt 的最终输出作为本节点 output 注入下游，并把代码 cherry-pick / merge 回 run 的共享 worktree
- 输出：string（promoted attempt 最后一条 message）

#### D · Loop（占位 V1，实装 P3）

- 入度 1，出度 1（外加一条 "loop back" 自反边）
- 配置：
  ```yaml
  mode: until | for_each
  until_expression: "input.includes('PASS')"   # mode=until 必填
  max_iterations: 5
  ```
- 输出：最后一次迭代的 output

#### E · Human Gate

- 入度 ≥ 1，出度 1（V2 启用 rejection_handler 后可加一条 `rejection` 边连到 retry 节点）
- V1 配置（最小集）：
  ```yaml
  prompt_to_human: "Review the plan above. Approve to continue?"
  required_action: approve | approve_or_reject     # reject 时 run 终止
  timeout_seconds: 86400                           # 默认 24h（避免无限期挂着 worktree）；超时按 timeout_action
  timeout_action: reject | approve | skip          # 默认 reject
  search_aliases: [pause, approve, gate, review]
  ```
- V2 高级配置（参考 circuit `rejection_handler`，让"被拒"成为流转一部分）：
  ```yaml
  input_selections: ["{{#nodes.plan.output#}}", "{{#nodes.impl.output#}}"]   # 显式指定要展示的上游片段
  feedback_prompt: "What should be changed?"
  rejection_handler:
    enabled: true                                  # 拒绝时是否走特殊 rejection 边
    continue_session: true                         # 把 feedback 喂回最近一个 agent 节点继续修
    feedback_template: "User says: {{#feedback#}}"
    max_retries: 3
    on_max_retries: fail | skip | approve_anyway
  ```
- 运行：节点变 `awaiting_human` → UI 弹审批 → approve 走默认边 / reject 走 `rejection` 边（如启用）/ V1 直接终止 run
- 输出：string（approve 时 = 上游 input + 用户评论；reject 时 = 用户 feedback）

#### F · Transform

- 入度 ≥ 1，出度 1
- 配置：
  ```yaml
  script: "return input.split('\\n').slice(0, 10).join('\\n')"   # 沙箱 JS
  ```
- 运行：沙箱跑 script，硬超时 1s，输入只有 `input` 字符串，输出 = return value
- **设计意图**：纯文本流水中偶尔需要"截断 / 抽取 / 模板包装"，避免为这类琐事单独起一个 LLM 节点烧 token

#### C-3 · ConditionAgent（V2 新增，LLM 驱动语义分支）

> 参考 Flowise `ConditionAgent_Agentflow`：让 LLM 看上游输出 + scenarios 列表，自然语言匹配走哪条边。findings §13 #9。

- 入度 ≥ 1，出度 ≥ 2（每条出边对应一个 scenario）
- 配置：
  ```yaml
  classifier_executor: claude-haiku-4.5 | gpt-5-mini | ...   # 用便宜的小模型分类即可
  scenarios:
    - { name: "needs_more_research", target: research_node }
    - { name: "ready_to_implement",  target: impl_node }
    - { name: "blocked",             target: human_gate_node }   # 兜底
  classifier_prompt_template: |
    Given upstream output:
    {{#prev#}}
    Pick the best scenario name from: needs_more_research, ready_to_implement, blocked
  search_aliases: [llm-if, ai-router, semantic-branch]
  ```
- 运行：调 classifier_executor → 输出文本与 scenarios 名做模糊匹配链（精确 → 前缀 → 子串 → fallback 到最后一个 scenario）
- 输出：string（透传 input）
- **Why 这个节点而不是 Condition + Transform**：当判断条件是"agent 输出是否表达了 X 意图"时，规则匹配很难写；让 LLM 来分类自然得多

#### G-1 · StickyNote（画布注释，零执行）

> 参考 Flowise StickyNote。让画布即文档，零运行成本。findings §13 #10。

- 入度 0，出度 0（**不参与执行**）
- 配置：
  ```yaml
  text: "TODO: 这一段还要测一下空输入"
  color: yellow | blue | pink | green
  search_aliases: [note, comment, todo, doc]
  ```
- 运行：调度器忽略；不会出现在 `node_executions` 表
- 用途：画布上写 TODO / 设计说明 / 协作 review 留言

---

## 5. 数据模型变更

### 5.1 新增表

```sql
-- 工作流模板（图本身）
CREATE TABLE workflows (
    id              BLOB PRIMARY KEY,
    project_id      BLOB NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    graph_json      TEXT NOT NULL,        -- React Flow 序列化的 nodes + edges
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_workflows_project_id ON workflows(project_id);

-- 一次工作流运行
CREATE TABLE workflow_runs (
    id              BLOB PRIMARY KEY,
    workflow_id     BLOB NOT NULL,
    issue_id        BLOB,                 -- 关联 kanban 卡（可空：从模板页直接跑）
    workspace_id    BLOB,                 -- 共享 workspace（启动后填入）
    trigger_source  TEXT NOT NULL DEFAULT 'manual',   -- 见 §3.2
    input_text      TEXT NOT NULL,
    output_text     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','awaiting_human','succeeded','failed','canceled')),
    started_at      TEXT,
    finished_at     TEXT,
    error_text      TEXT,
    FOREIGN KEY (workflow_id)  REFERENCES workflows(id)    ON DELETE CASCADE,
    FOREIGN KEY (issue_id)     REFERENCES local_issues(id) ON DELETE SET NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)   ON DELETE SET NULL
);

CREATE INDEX idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_issue_id    ON workflow_runs(issue_id);
CREATE INDEX idx_workflow_runs_status      ON workflow_runs(status);

-- 单节点的执行记录
CREATE TABLE node_executions (
    id              BLOB PRIMARY KEY,
    run_id          BLOB NOT NULL,
    node_id         TEXT NOT NULL,         -- React Flow 节点 id（字符串，不是 UUID）
    node_type       TEXT NOT NULL,         -- start | end | agent | condition | arena | loop | human_gate | transform
    iteration       INTEGER NOT NULL DEFAULT 0,   -- Loop 节点每次迭代独立一行
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','awaiting_human','succeeded','failed','skipped')),
    input_text      TEXT,
    output_text     TEXT,
    session_id      BLOB,                  -- Agent 节点指向 sessions(id)
    arena_group_id  BLOB,                  -- Arena 节点指向 arena_groups(id)
    started_at      TEXT,
    finished_at     TEXT,
    error_text      TEXT,
    tokens_used     INTEGER,                  -- agent 节点累计 token 消耗（dashboard §7.6 用）
    cost_estimate   REAL,                     -- 按当前模型 pricing 估算的美元（V2 启用，V1 留空）
    FOREIGN KEY (run_id)         REFERENCES workflow_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id)     REFERENCES sessions(id)      ON DELETE SET NULL,
    FOREIGN KEY (arena_group_id) REFERENCES arena_groups(id)  ON DELETE SET NULL
);

CREATE INDEX idx_node_executions_run_id ON node_executions(run_id);
CREATE INDEX idx_node_executions_status ON node_executions(status);
CREATE UNIQUE INDEX idx_node_executions_run_node_iter
    ON node_executions(run_id, node_id, iteration);
```

### 5.2 `graph_json` 形态（约束 schema，不是自由 JSON）

```jsonc
{
  "version": 1,
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "position": { "x": 0, "y": 0 },
      "data": {}
    },
    {
      "id": "plan",
      "type": "agent",
      "position": { "x": 200, "y": 0 },
      "data": {
        "executor": "claude-code",
        "variant": "opus-4.6",
        "prompt_template": "Plan: {{prev}}",
        "output_capture": "last_message"
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "plan", "edge_type": "default" }
  ]
}
```

- 后端持久化前用 JSON Schema 校验（`crates/utils/` 下加 schema 模块）
- 前端 React Flow 序列化结果直接是这个形状，无需中间映射
- **edge_type**（参考 circuit）：`default` / `approval` / `rejection` 三类。`default` 普通连接；`approval` / `rejection` 专门连 Human Gate 节点的两个出口。前端按 edge_type 渲染颜色 / 标签 / 流光样式（findings §13 #3）

### 5.3 ts-rs 类型同步

- 在 `crates/server/src/bin/generate_types.rs` 注册：
  - `Workflow` / `WorkflowRun` / `NodeExecution` 三个表的 row struct
  - `RunStatus` / `NodeStatus` / `NodeType` 三个 enum
  - `WorkflowGraph` / `WorkflowNode` / `WorkflowEdge` 三个 graph_json 子类型（手写 struct 让前端共享 schema）
- 通过 `pnpm run generate-types` 重新生成 `shared/types.ts`，**禁止手改**

### 5.4 迁移脚本路径

`crates/db/migrations/<YYYYMMDDHHMMSS>_add_ai_workflow.sql`

---

## 6. 后端 API

### 6.1 端点

| Method | Path | 说明 |
|---|---|---|
| GET    | `/api/local/v1/projects/{project_id}/workflows` | 列出该 project 的所有工作流模板 |
| POST   | `/api/local/v1/projects/{project_id}/workflows` | 新建工作流模板 |
| GET    | `/api/local/v1/workflows/{id}` | 取模板（含 graph_json） |
| PUT    | `/api/local/v1/workflows/{id}` | 更新模板（替换 graph_json） |
| DELETE | `/api/local/v1/workflows/{id}` | 删除模板（级联删 runs） |
| POST   | `/api/local/v1/workflows/{id}/trigger` | 触发一次运行；body: `{ trigger_source, input_text, issue_id? }` |
| GET    | `/api/local/v1/workflow_runs/{id}` | 取运行详情（run + 所有 node_executions） |
| POST   | `/api/local/v1/workflow_runs/{id}/cancel` | 取消运行（标 canceled，杀正在跑的 sessions） |
| POST   | `/api/local/v1/workflow_runs/{id}/nodes/{node_id}/retry` | 单节点 retry（仅 failed / canceled 节点） |
| POST   | `/api/local/v1/workflow_runs/{id}/nodes/{node_id}/approve` | Human Gate 节点放行 |
| POST   | `/api/local/v1/workflow_runs/{id}/nodes/{node_id}/reject` | Human Gate 节点拒绝（终止 run） |
| POST   | `/api/local/v1/workflow_runs/{id}/replay` | **从指定节点重启**（参考 circuit `executeFromCheckpoint`）；body: `{ from_node_id, inactive_node_ids?: [] }` —— 前置节点输出从 checkpoint 恢复，inactive 节点跳过执行 |
| GET    | `/api/local/v1/workflow_runs/{id}/events` | SSE 流：run / node 状态变更 + agent token streaming |
| GET    | `/api/local/v1/workflow_runs/{id}/agent_breakdown` | dashboard §7.6 用：返回 `[{executor, steps, total_duration_ms, total_tokens}]` 聚合（join sessions） |

### 6.2 SSE 事件 schema（关键）

```jsonc
// 节点状态变更
{ "type": "node_status",  "node_id": "plan", "status": "running" }
// agent token 流式输出（Agent 节点专用，前端拼到节点卡片内）
{ "type": "node_token",   "node_id": "plan", "token": "I will..." }
// 节点完成 + output 摘要
{ "type": "node_done",    "node_id": "plan", "output_preview": "..." }
// run 整体状态
{ "type": "run_status",   "status": "succeeded" }
```

- 复用现有 `streams.rs` 的 SSE 基础设施；Workflow 是一个新 channel kind
- 前端 React Flow 监听 `node_token` 把 token 拼到对应节点的 "agent output" 块

### 6.3 Electric local fallback

- 与 Arena 同一处理：`crates/server/src/routes/local_remote.rs::router()` 末尾追加
  ```rust
  .route("/v1/fallback/workflows",     get(fallback_workflows))
  .route("/v1/fallback/workflow_runs", get(fallback_workflow_runs))
  .route("/v1/fallback/node_executions", get(fallback_node_executions))
  ```

---

## 7. 前端 UI

### 7.1 路由

| 路径 | 页面 | 功能 |
|---|---|---|
| `/projects/:pid/workflows` | 模板列表 | 卡片列表 + 新建 + 删除 + 导入/导出 YAML |
| `/projects/:pid/workflows/:id/edit` | 编辑器 | React Flow 画布 + 节点面板 + 检查器 |
| `/projects/:pid/workflows/:id/runs` | 历史运行 | 列表，点进去看 run |
| `/projects/:pid/workflow_runs/:run_id` | 运行视图（画布） | 画布 read-only + 实时状态叠加（详见 §7.3） |
| `/projects/:pid/workflow_runs/:run_id/dashboard` | 运行视图（dashboard） | Linear Timeline 纵向面板，与画布并列 tab（详见 §7.6） |

### 7.2 编辑器（核心）

- **左侧**：节点面板（按类别分组：Start/End | Agent | Flow Control | Human | Tools）
- **中间**：React Flow 画布
  - 拖节点入画 / 拖端点连边
  - 选中节点时右侧检查器同步
  - 自动布局按钮（dagre 横向 / 纵向）
  - Minimap + Zoom + 对齐线
- **右侧**：检查器
  - 节点配置表单（schema 驱动，按 `node_type` 渲染不同字段）
  - prompt_template 编辑器附带 `{{...}}` 自动补全（基于已有的上游节点 id）
- **顶部**：保存 / 试运行 / 导出 YAML
- **底部**：校验面板（图是否有环、所有节点是否连通、必填字段是否填）

### 7.3 运行视图（差异化亮点）

- 同一份画布 read-only
- 节点状态色：
  - `pending` — 灰
  - `running` — 蓝色脉冲边框
  - `awaiting_human` — 橙色 + 闪烁
  - `succeeded` — 绿
  - `failed` — 红
  - `skipped` — 灰虚线
- 边的"流光"：当 source 完成且 target running，边有流光动画（svg `<animate>` 或 framer-motion）
- 节点内嵌输出区：
  - Agent 节点底部最多展示 6 行 token streaming，溢出收成 "▾ expand"
  - 失败节点点开看完整 error_text
- 右侧抽屉：选中节点显示完整 input_text / output_text / session 链接（跳到现有 session 详情页）
- 顶栏：`[Cancel run] [Restart from this node]`（重启从某节点开始）

### 7.4 与 Issue / Kanban 集成

- Issue 详情页底部加按钮 `[Run as workflow ▾]` → 下拉本 project 的模板 → 选一个 → 弹 "input_text" 输入框（默认填 issue title + description）→ 创建 run → 跳到运行视图
- Kanban 列右键加 "Set workflow trigger"（占位，V1 不实装，对应 §3.2）

### 7.5 AI Arena 与 Workflow 的入口共存

- Issue 详情页同时存在两个入口：
  - `[Race mode]`（Arena v2，单层并行）
  - `[Run as workflow]`（Workflow，多层 DAG）
- 不互斥：用户可以在一个工作流里嵌入 Arena 节点

### 7.6 运行视图 · Linear Timeline Dashboard（per-issue 工作流面板）

> 与 §7.3 画布运行视图**并列的另一种视角**：画布看图形 / 拓扑，dashboard 看时序 / 数据 / 归属。两者答的是不同问题，互补不重叠。

#### 7.6.1 路由与切换

- 路径：`/projects/:pid/workflow_runs/:run_id/dashboard`
- UI：与 §7.3 画布视图**共享顶栏**，加一组 tab `[Canvas | Dashboard]`，URL 同步切换
- 默认 tab：用户首次访问 → **Dashboard**（更直观，更适合"快速判断当前在哪一步"）；偏好可记到 localStorage

#### 7.6.2 7 个区块（自顶向下）

##### ① Header

- 行 1：Issue 名 + 链接到 Issue 详情页
- 行 2：Workflow 模板名 + 版本（`v1.0`）+ 链接到模板详情页
- 行 3：Run id（短）+ trigger_source + 启动时间 + 启动者
- 右上：状态徽标（`running` / `awaiting_human` / `succeeded` / `failed` / `canceled`）

##### ② Progress

- 大字：`Step X of N · 12m 30s elapsed · ETA ~Ym`
- 进度条：`▓▓▓▓░░░░ X/N`
- 操作按钮：`[Cancel run]` / `[Pause]` / `[Open canvas →]`
- ETA 计算：`(已完成节点平均时长) × (剩余节点数)`，简单版即可，无需复杂预估

##### ③ Steps Timeline（核心）

- 每行 = 一个 `node_executions` 记录，按 `started_at` 排序
- 列：状态图标 / 节点序号 / 节点 displayName / executor / duration / tokens_used / `[→ session]`
- 当前 running 节点高亮（蓝色脉冲背景）
- 失败节点红色 + 点击展开 `error_text` + 按钮 `[Retry from here]`（调 `/replay` 端点）
- Loop 节点的多次迭代折叠成单行 + 点击展开各次

##### ④ Selected Step Detail

- 默认选中"最近一次状态变更的节点"（running 时是当前节点；done 时是最后一个节点）
- 显示：`input_text`（折叠超过 6 行）/ `output_text`（如 running 则 streaming）/ `tokens_used` / agent 链接
- 失败时：`error_text` + retry 按钮
- Human Gate 时：审批控件直接嵌入（与 §7.3 行为一致）

##### ⑤ Decisions Made

- 时间序：列出本 run 中所有 Condition / ConditionAgent / Human Gate / Arena 节点的判断结果
- 每行：`节点名 · 判断结果 · 走哪条边 · 用户评论`
- 空状态："No decisions yet"

##### ⑥ Agent Contribution

- 表格：每行一个 executor + 累计步数 + 累计时间 + 累计 tokens
- 例：`Claude · 2 steps · 6m · 24k tok`
- 数据源：`/agent_breakdown` 端点（§6.1）

##### ⑦ Code Changes（如果 run 有代码改动）

- branch 名 + 短 SHA
- N files changed: +X -Y
- 链接：`[→ View full diff]`（跳到现有 diff viewer）/ `[→ PR]`（如已建）
- Run 完成后激活 `[Promote run output to PR]` 按钮（沿用 §8.4 PR 流）

#### 7.6.3 实时刷新

- 同 §7.3 走 SSE：监听 `node_status` / `node_token` / `run_status` 事件
- token streaming：**仅渲染到"selected step detail"区**，不在 Timeline 每行实时跳动（避免视觉过载）
- Timeline 仅在 `node_status` / `node_done` 时刷新该行（节流）

#### 7.6.4 后端数据需求（增量）

- `node_executions.tokens_used` + `cost_estimate`（已加到 §5.1）
- 聚合 endpoint `GET /workflow_runs/{id}/agent_breakdown`（已加到 §6.1）
- `GET /workflow_runs/{id}` 返回的 `nodes` 数组每项含 `executor`（join sessions 取，无新增字段）

#### 7.6.5 嵌入 Issue 详情页（V2 加分项）

- 当 Issue 有 active workflow run 时，issue 详情页内嵌一个**精简版 dashboard**（仅 Header + Progress + 当前节点） + `[→ Open full dashboard]` 跳转
- 完成后退化为静态摘要："Last run: succeeded, 23m, 142k tok · [→ View dashboard]"

---

## 8. 工程约束

### 8.1 资源上限

| 项 | 默认 | 可配置 |
|---|---|---|
| 单工作流节点数上限 | 30 | 50（Project Settings） |
| 单 run 同时 running 节点数 | 8 | 16 |
| 单工作流 graph_json 大小 | 256 KB | 1 MB |
| Loop 最大迭代 | 5 | 20 |
| Transform 沙箱 CPU | 1s | — |

### 8.2 调度核心（Rust）

- 新建 crate：`crates/workflow/`（与 `crates/git/` 同级）
- 核心结构：
  ```rust
  pub struct WorkflowRunner {
      run_id: Uuid,
      graph: ValidatedGraph,
      pool: SqlitePool,
      executor_factory: Arc<dyn ExecutorFactory>,
      events_tx: broadcast::Sender<WorkflowEvent>,
  }
  ```
- 调度循环：
  1. 从 DB load run + node_executions
  2. 计算"就绪集合"（所有上游 node_executions.status = succeeded 的节点）
  3. 对每个就绪节点 spawn 一个 tokio task → 调对应 NodeHandler
  4. NodeHandler 写回 status / output_text → 推 SSE → 触发就绪重算
  5. 直到无就绪节点 + 无 running 节点 → 标 run 完成
- 失败语义：默认**单节点失败 = run 失败**；V2 加 `on_error: continue | retry | fail`

### 8.3 沙箱化 JS（仅 Transform）

> §4.2 C-1 Condition 已改用规则数组，不再依赖 JS。沙箱仅服务 §4.2 F Transform。

- 候选：`boa_engine`（纯 Rust）/ `rquickjs`（绑定 QuickJS）/ `deno_core`（太重）
- V1 选 **boa_engine** —— 编译开销小、纯 Rust、Windows 友好
- API surface 只暴露 `input: string`，禁止 fetch / fs / setTimeout
- 内存上限 8 MB，CPU 上限按 §8.1

### 8.4 worktree 共用策略

- 一个 run = 一个 workspace = 一个 worktree
- Agent 节点跑完后，**不自动 commit**（沿用 Arena v2 的 design mode 默认）
- run 结束（succeeded）后用户可选 `[Promote run output to PR]` —— 把 worktree 的所有改动按现有 PR 流提交
- Arena 子图节点是例外：内部各 attempt 独立 worktree，promote 后 cherry-pick 回 run 主 worktree

### 8.5 与 Electric 同步

- workflows / workflow_runs / node_executions 三张表都走 Electric local fallback
- ts-rs 生成的类型放 `shared/types.ts`

### 8.6 分支命名

- 共享 workspace 的分支：`vk/<issue_id>-wf-<run_short_id>`
- Arena 子节点内的 attempts：`vk/<issue_id>-wf-<run_short_id>-arena-<idx>`

---

## 9. 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| AC-1 | 新建模板：拖 Start → Agent → End，连边，保存 | DB 中 `workflows.graph_json` 写入；前端刷新后图重现 |
| AC-2 | 触发线性 run（Start → Agent[claude] → Agent[codex] → End） | 两个 Agent 串行跑完；node_token SSE 流回前端；画布节点依次绿色 |
| AC-3 | 触发并行 run（Start → A 与 B 并行 → C 收集） | A B 并发跑（共享 worktree 但 session 隔离）；C 在 A B 都完成后启动；C 的 input 是 A B 拼接 |
| AC-4 | Condition 节点 `input.includes('LGTM')` true | 走 yes 边的下游执行；no 边节点状态 `skipped` |
| AC-5 | Human Gate 节点 | run 状态 `awaiting_human`；前端弹审批；点 approve 后继续 |
| AC-6 | Agent 节点失败 | 节点红色；run 标 failed；其他未启动节点 skipped；点 retry 后该节点重跑（前置不重跑） |
| AC-7 | 取消运行 | 正在跑的 session 被 kill；run 标 canceled；node_executions.status 部分变 canceled |
| AC-8 | 关闭并重启 vibe-kanban | 处于 awaiting_human 的 run 状态正确恢复；可继续 approve |
| AC-9 | 同一 issue 同时只能跑一个 run | 第二次触发返回 409 + 当前 run id |
| AC-10 | 删除模板 | 关联 runs / node_executions 级联清除 |
| AC-11 | 不创建任何 workflow → 现有 Arena / 单 workspace 行为完全一致（无 regression） | 老路径完全不动 |
| AC-12 | 内置 5 个工作流模板每个都有 Playwright e2e（参考 open-agent-builder findings §13 #13） | 模板回归测试在 CI 全绿 |
| AC-13 | Dashboard 路由：访问 `/workflow_runs/:id/dashboard` 渲染 7 个区块；与 Canvas tab 切换状态保持 | 区块渲染正确，切换无白屏 |
| AC-14 | StickyNote 节点放到画布上 + 保存 + 重新打开 | 文本与颜色保留；不出现在 `node_executions` 表 |

**P3 才需要满足的验收**：

| ID | 场景 |
|---|---|
| AC-P3-1 | Arena 节点：run 跑到此处暂停 → 用户在 Arena 视图 promote 一个 → run 继续 |
| AC-P3-2 | Loop 节点 `until input.includes('PASS')` + max_iterations=3 | 最多跑 3 次；每次迭代有独立 node_executions 行 |
| AC-P3-3 | YAML 导出 / 导入 → 图等价 |

---

## 10. 风险与未决问题（待 §11 调研环节回答）

### 10.1 已知风险

| 风险 | 缓解 |
|---|---|
| 共享 worktree 下两个 Agent 节点并行写同一文件 | V1 文档警告"并行节点应避免改同一文件"；V2 加 git lock + 冲突检测 |
| React Flow 大图（30+ 节点）画布卡顿 | 分级渲染：缩放 < 0.6 时切到节点缩略图；用 `useReactFlow().getNodes()` 虚拟化 |
| token streaming 同时 8 个节点 → SSE 通道压力 | 节流：单节点 token 50ms 合并一次推送 |
| 沙箱 JS 逃逸 | 选成熟引擎 + 严格 surface；附测试 case |
| YAML 导入恶意 graph 把 worktree 跑爆 | 导入前 schema 校验 + 节点数 / 沙箱时长校验（§8.1） |

### 10.2 未决问题（部分已经过 [`search-project/findings.md`](./search-project/findings.md) 调研回填）

> 标 ✅ 表示已答；标 ⏳ 表示仍需调研或自测。

1. ✅ **React Flow vs 替代方案**：xyflow/react v12 直接用——Flowise / circuit / open-agent-builder / Sim Studio 全部用它，MIT 许可
2. ⏳ **JS 沙箱选型**：boa_engine 在 Windows MSVC 上构建是否稳定？rquickjs 的 QuickJS 绑定在 NPX 一行启动场景下是否能 vendor 进 binary？（V1 沙箱仅 Transform 用，影响范围已变小）
3. ⏳ **节点内 token streaming 性能**：8 节点 × 每秒 50 token × 多 client 订阅的 SSE 风扇通量基线？（findings 调研所有项目都用 WS/SSE 未见瓶颈，初步可信 50ms 节流）
4. ⏳ **共享 worktree 的节点并行边界**：所有并行节点都要串行化文件写入？还是约定告知用户"并行节点应是 read-mostly"？建议 V1 文档警告 + V2 加 git lock + 冲突检测
5. ⏳ **Arena 节点的 promote 回填**：方案 A=`git cherry-pick` / B=`git diff | git apply` / C=直接切分支。需 clone circuit `executors/codex-agent.ts` 看其有无类似处理
6. ✅ **Workflow 模板命名空间**：**系统内置 + 用户自建双轨**——open-agent-builder 8 模板 / AionUi 20 assistant / Flowise marketplace 都是双轨；V1 内置 5 个跑通
7. ✅ **运行视图回放**：用 circuit 的 **checkpoint + replay** 模式（已在 §6.1 加 `/replay` 端点）；DB 仅保 `node_executions.input_text/output_text`，不存 token 流水
8. ⏳ **失败重试 token 计费**：与未来 Insights Dashboard（T1-4）字段对齐；V1 `tokens_used` 列允许 NULL，重试后累加
9. ⏳ **Loop 节点 output 语义**：最后一次迭代的 output / 所有迭代的拼接 / 用户可选？建议 V1 默认"最后一次"，V2 加配置项
10. ✅ **键盘搜索建节点**：抄 ComfyUI 的 `SEARCH_ALIASES`——已加到所有节点的 schema（§4.2 各节点配置末尾）
11. ✅ **多上游节点拼接 schema**：默认按 §3.1 `<plan node="...">` 包裹，用户可在节点 properties 加 `input_selections: [...references...]`（参考 circuit）显式选择

---

## 11. 调研结论（First Pass 完成）

> 第一轮调研已完成（2026-05-08）：super-search-skill 三通道（Exa+Tavily+Grok）+ clone 11 个对标项目 + 逐项分析。
>
> **调研产出**：
> - [`./benchmarks.md`](./benchmarks.md) —— 50+ 项目分类索引
> - [`./search-project/findings.md`](./search-project/findings.md) —— 11 项目深度对比矩阵 + 14 条增量来源 + 5 个仍未答的问题
> - 已直接回填本 spec：变量语法、Condition 规则数组、Human Gate rejection_handler、新节点类型 ConditionAgent / StickyNote、Dashboard、`/replay` 端点、search_aliases 等

### 11.1 第二轮调研建议（按需展开，不必现在做）

如果实施过程中遇到设计冲突，按以下顺序深入：

1. **circuit 的 11 个 executor 源码**（`circuit/backend/src/orchestrator/executors/`）—— 看每个节点类型的具体实现，特别是 `javascript.ts` 沙箱、`approval.ts` 暂停/恢复机制
2. **Flowise ConditionAgent 完整实现** —— `findBestScenarioIndex.ts` + `ConditionAgent.ts` —— 学 LLM-driven branching 的 prompt + fallback 链
3. **dify 的 graph_engine** —— Python DAG runner，与 circuit TS 实现对照
4. **ComfyUI 的 custom_nodes 目录** —— 看社区贡献的节点格式
5. **langgraph 的 StateGraph + checkpointer** —— state-centric 是否值得在 V2 引入

### 11.2 仍需自测 / 验证的项

- JS 沙箱选型在 Windows MSVC 上的实际编译开销（boa_engine vs rquickjs）
- React Flow 30+ 节点的实际渲染性能（低端 Windows 笔记本）
- 节点 token streaming 的 SSE 风扇通量基线（8 节点并行）
- 共享 worktree 下并行 Agent 节点的真实冲突频率

### 11.3 输出产物（已实现）

- ✅ [`./benchmarks.md`](./benchmarks.md) —— 项目索引
- ✅ [`./search-project/findings.md`](./search-project/findings.md) —— 深度对比
- ⏳ 后续如需 `decision-<日期>-<主题>.md` 记录关键抉择，直接放本目录

---

## 12. 不影响范围（Backward Compatibility）

- 所有新表 / 新列允许 NULL；不修改现有 `workspaces` / `sessions` / `arena_groups` 表
- API 端点全部新增，路径全部 `/api/local/v1/workflows/*` 或 `/api/local/v1/workflow_runs/*`
- 前端为新路由，旧 Issue 详情页 / Arena 入口零改动
- 关闭 workflow feature flag 后，整个模块对用户隐形

---

## 13. 关联文档

- 上层路线图：[`../future_task.md`](../future_task.md) §T1-1
- 对标项目清单：[`./benchmarks.md`](./benchmarks.md)（~50 项目分类索引）
- 对标项目分析：[`./search-project/findings.md`](./search-project/findings.md)（11 项目深度对比 + 14 条增量来源）
- 设施基线：AI Arena v2 spec [`../ai-arena/spec-v2.md`](../ai-arena/spec-v2.md)（节点协议复用）
- 数据库基线：`crates/db/migrations/20260504000000_add_ai_arena.sql` + `20260506000000_ai_arena_v2_design_mode.sql`
- 执行原语：`crates/server/src/routes/workspaces/execution.rs`
- ts-rs 类型生成：`crates/server/src/bin/generate_types.rs`

---

## 14. 修订历史

| 日期 | 修订点 | 来源 |
|---|---|---|
| 2026-05-08 初稿 | 创建本规格（确定纯文本契约 + 触发器接口先行） | T1-1 进化方向 + 用户对话锁定 |
| 2026-05-08 v0.2 | 14 条对标项目增量回填：变量语法改 `{{# #}}`（dify）/ Condition 改规则数组（circuit）/ Human Gate 加 rejection_handler（circuit）/ 新增 ConditionAgent 节点（Flowise）/ 新增 StickyNote 节点（Flowise）/ 节点 schema 加 search_aliases + tooltip（ComfyUI）/ edge_type 三类（circuit）/ Agent 加 conversation_mode + mcp_servers（circuit）/ trigger_source 加 IM 触发（AionUi）/ 加 `/replay` 端点（circuit checkpoint）/ AC 加 Playwright e2e（open-agent-builder）/ 简化 Condition 不再需 JS 沙箱 | [`./search-project/findings.md`](./search-project/findings.md) §13 |
| 2026-05-08 v0.3 | 新增 §7.6 Linear Timeline Dashboard：与画布并列 tab；7 个区块（Header / Progress / Timeline / Selected Step Detail / Decisions / Agent Contribution / Code Changes）；node_executions 加 tokens_used + cost_estimate 列；新增 `/agent_breakdown` 聚合端点 | 用户需求：per-issue 工作流面板 |
