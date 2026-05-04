# Future Tasks — easy-vibe-kanban 差异化路线图

> 本文档沉淀对 `easy-vibe-kanban`（BloopAI/vibe-kanban 的 Windows 本地化 fork）下一阶段差异化能力的调研结论与落地建议。
>
> **调研基础**：2026-05 通过 super-search-skill（Exa + Tavily + Grok）对 GitHub 上同类「AI Coding Agent + Kanban + Worktree」开源项目做了 46 条结果的横向扫描；并对照本仓库 `crates/db/migrations/`、`crates/server/`、`crates/executors/` 的现状确认了上游已有 / 缺失能力。
>
> **写作目标**：让任意接手者 / 协作 Agent 不必重做调研，直接按 ROI 分级挑选执行项。

---

## 1. 定位与原则

`easy-vibe-kanban` 在赛道中的天然护城河：

- **Windows 优先**（同类几乎全是 macOS/Linux 优先）
- **纯本地 SQLite + 免登录**（数据 100% 在 `%APPDATA%\bloop\vibe-kanban\data`）
- **`npx easy-vibe-kanban` 一行启动**（不依赖远程服务器、不依赖 Docker）

**所有差异化能力必须强化以上三条主线，不去抢以下方向**：

| 不做的方向 | 谁在做 | 不适合的原因 |
|---|---|---|
| Agent 加密身份（Ed25519 JWT） | `bonaysoft/agent-kanban` (192⭐) | 单机本地场景 ROI 极低 |
| 服务端架构 / 手机访问 | `kdlbs/kandev` (51⭐) | 与 "npx 一行 + 本机" 叙事冲突 |
| Docker / 远程 runtime（sprites.dev 类） | `kdlbs/kandev` / `automagik-dev/forge` | 给 Windows 个人用户负担过重 |
| ACP 协议适配层 | `kdlbs/kandev` | 工程量巨大，现有 executor 抽象已够用 |
| 纯 TUI 路线 | `untra/operator` / `TechDufus/openkanban` / `fynnfluegge/agtx` | 已有 Web UI，不分叉 |

---

## 2. 同类竞品速查（截至 2026-05）

### 2.1 直接同类（AI Agent Kanban + Workspace）

| 项目 | Stars | 形态 | 关键差异点 |
|---|---|---|---|
| `BloopAI/vibe-kanban` | (上游) | Rust + React + Tauri | 已 sunset；本 fork 的母体 |
| `kdlbs/kandev` | 51 | Go + TS 服务端 | 多 provider via ACP；本地 / Docker / 远程三种 runtime |
| `bonaysoft/agent-kanban` | 192 | TS + Cloudflare Pages | Agent-first；Ed25519 身份；Leader/Worker/Daemon 四角色 |
| `johannesjo/parallel-code` | 528 | Electron + SolidJS 桌面 | **AI Arena**：多 agent 同题对打 |
| `stravu/crystal`（Nimbalyst） | — | desktop | 多 Codex/Claude Code 并行 session + worktree |
| `automagik-dev/forge` | — | TS | "Vibe Coding++™"；multi-agent kanban + MCP |
| `superset-sh/superset` | — | TS | "an army of Claude Code, Codex" |
| `DanWahlin/ai-agent-board` | — | — | drag-and-drop + 多 agent + worktree 隔离 |
| `untra/operator` | — | TUI（tmux/cmux/Zellij） | ticket-first 绑 Jira/GitHub |
| `TechDufus/openkanban` | — | Go TUI | 每卡片 worktree + 内嵌终端 |
| `fynnfluegge/agtx` | — | TUI | Orchestrator agent 自主推进 spec-driven workflow |
| `workstream-labs/workstreams` | — | TS | "IDE for parallel AI coding agents" |
| `alltuner/factoryfloor` | — | Swift | 原生 macOS app |
| Multica（评测引用） | — | — | 自动检测 PATH 上 CLI；Docker Compose / K8s |

> 索引：`andyrewlee/awesome-agent-orchestrators`

### 2.2 Worktree 管理工具（无 Kanban，更轻）

`timesky/worktrunk` · `notdp/worktree.sh` (54⭐) · `coderabbitai/git-worktree-runner` · `satococoa/wtp` · `chmouel/lazyworktree` · `andyrewlee/amux` · `d-kuro/gwq` · `k1LoW/git-wt` · `nicksenap/grove` · `rohansx/workz` · `sidequery/ghostree` · `kdcokenny/opencode-worktree` · `sahithvibudhi/vibe-tree` · `raine/workmux` · `jackiotyu/git-worktree-manager`（VSCode 扩展）· `alexiszamanidis/vscode-git-worktrees`（VSCode 扩展）

### 2.3 通用 Self-hosted Kanban（参考对照，不针对 AI agent）

| 项目 | Stars | 备注 |
|---|---|---|
| `makeplane/plane` | 48,287 | Jira/Linear 替代；深度 GitHub 双向同步 |
| `usekaneo/kaneo` | 3,447 | 轻量 Jira 替代 |
| `mattermost-community/focalboard` | — | Trello 替代 |
| `kanboard/kanboard` | — | PHP 老牌（maintenance mode），有 GitHub webhook 插件 |
| `plankanban/planka` | — | 实时协作 Trello 替代 |
| `wekan/wekan` | — | MIT，Meteor |
| `kan.bn` | — | 较新 |

### 2.4 行业共识

- **"Kanban 是 multi-agent 系统的默认 UI"** —— 已被 Vibe Kanban / Veritas Kanban / Mission Control / GitHub Agent HQ / Multica 等共同验证。
- **典型架构模板**：卡片 → 创建 git 分支 → 创建 worktree → 注入 prompt 启 agent → WebSocket 流式日志 → diff 评审 → 一键 PR/merge。

---

## 3. 上游 vibe-kanban 已有能力（避免重复造轮）

通过 `crates/db/migrations/` 时间线确认：

- **核心实体**：`projects` → `repos` → `tasks` → `task_attempts`（已重命名为 `workspaces` + `sessions`）→ `execution_processes`
- **Worktree 隔离**：每个 session 一个 worktree，自动 cleanup
- **多 executor**：Claude Code / Codex / Gemini CLI / Copilot / Amp / Cursor / OpenCode / Droid / CCR / Qwen
- **Diff + inline comments**：评审时直接给 agent 反馈
- **Browser preview**：内置 devtools / inspect / device emulation
- **PR 创建 + AI 描述**：`tracked_prs` 表
- **Tags / Templates**：原 task templates 已迁移到 tags
- **MCP 二进制**：`vibe-kanban-mcp` 但**没有项目级共享 MCP 面板**
- **Parallel setup script**：项目级并行初始化脚本（`add_parallel_setup_script_to_projects`）

**确认上游缺失（即可做差异化的方向）**：

- ❌ 同题多 attempt 并行 + 头对头 diff 对比（AI Arena）
- ❌ MCP 服务器在 project 层统一管理 + 自动注入到各 agent
- ❌ 多 agent pipeline / 卡片状态自动派发
- ❌ Spec-driven 卡片
- ❌ Token / 时长 / 成功率 dashboard
- ❌ 本地 RAG / 知识库
- ❌ Windows 原生集成（任务栏 / 通知 / WSL 桥）
- ❌ 本地附件（你 `git-build.md` 已点名待办）

---

## 4. 差异化能力建议（按 ROI 分级）

### ⭐ T0 — 高 ROI / 真差异化（建议优先）

#### T0-1. AI Arena（同题多 agent 头对头对比）

- **价值**：截图就能解释；是 vibe-kanban "Attempt" 概念的自然进化；`johannesjo/parallel-code` 528⭐ 已经验证市场。
- **做法**：
  - 卡片 UI 增加 "Race Mode"：勾选 N 个 executor + N 个 worktree，一键并行启动。
  - 完成后 N 栏并排 diff（左：A 方案，中：B 方案，右：基线），每栏底部 "Promote to merge"。
  - 数据层只需在 `workspaces`/`sessions` 上加 `arena_group_id` 列 + `arena_groups` 表。
  - 调度复用现有并行 spawn。
- **预估工时**：1–2 周。
- **关键文件**：
  - `crates/db/migrations/` 新增迁移
  - `crates/server/src/routes/workspaces/execution.rs`
  - `crates/services/src/services/container.rs`
  - 前端：`packages/local-web/src/` 卡片详情页 + diff 对比组件

#### T0-2. MCP 服务器统一面板（项目级共享配置）

- **价值**：每个 Claude Code / Codex / Gemini 用户都被「同一个 MCP 要在 N 处配置」烦过。同类项目无人在做。
- **做法**：
  - Project Settings 新增 "MCP Servers" tab：列出本项目共享的 MCP（name / transport / command / env / scopes）。
  - 启 agent 时，由 vibe-kanban 把这套 MCP 映射到对应 agent 的配置文件 / 启动参数（每个 executor 已有 launcher，加一层 inject 即可）。
- **数据层**：`project_mcp_servers` 表 + 启动时合并到 `executor_action`。
- **预估工时**：3–5 天。
- **关键文件**：
  - `crates/db/migrations/` 新增迁移
  - `crates/executors/src/executors/` 各 executor 启动器
  - `crates/server/src/routes/projects/`
  - 前端：项目设置页

#### T0-3. Windows 原生集成（独占赛道）

- **价值**：同类几乎都是 macOS/Linux 优先，是本 fork 的命名义务。
- **做法**（按粒度，可逐步上）：
  - **任务栏徽标 + 系统托盘**：实时显示运行中 session 数。
  - **Toast 通知**：session 完成 / 失败 / 等待 review 时本机弹 Win 通知，可点跳。
  - **WSL2 桥**：用户开了 WSL2 时，允许 worktree 落到 WSL 文件系统（性能 5–10×）；agent 通过 `wsl.exe -e` 启动。
  - **PowerShell launcher**：`Start-VibeKanban -Project xxx`。
- **预估工时**：每项 2–4 天。
- **关键文件**：
  - `crates/tauri-app/` Tauri 端做托盘 / 通知
  - `npx-cli/` 检测 WSL2 + PowerShell module
  - `crates/worktree-manager/` 对 WSL 路径的支持

#### T0-4. 附件本地化（git-build.md 点名待办）

- **价值**：完成"完全本地"叙事的最后一块。
- **做法**：
  - 新建 `local_attachments` 表（id, session_id, filename, mime, blob_path, sha256）。
  - 文件落盘到 `%APPDATA%\bloop\vibe-kanban\data\attachments\`，按 sha256 前两位分桶 + 内容去重。
  - 路由 `/api/local/v1/attachments/*` 拦截远程请求。
- **预估工时**：2–3 天。
- **关键文件**：
  - `crates/db/migrations/`
  - `crates/server/src/routes/` 新增 attachments 本地路由
  - 前端调用方改写到 `/api/local/v1/...`

---

### 🟡 T1 — 中差异化 / 中成本

#### T1-1. Multi-Agent Pipeline（卡片状态自动派发）

- 卡片绑定 pipeline：`plan(claude opus) → impl(codex) → review(gemini)`。
- 状态推进时自动启下一阶段，前阶段产物作为下阶段 prompt 输入。
- `kandev` 已做但走远程架构；做轻量本地版的差异点是**用户能在 SQLite 直接编辑 yaml 模板**。
- 数据层：复用 `task_templates` → `tags` 已有的 template 机制，加 `pipeline_steps` JSON 列。

#### T1-2. 任务级 Skill / Slash Command 注入

- 创建卡片时下拉选择 `~/.claude/skills/*` 中的 skill。
- 启 agent 时把 skill prompt 段拼接到 task description 前。
- 目标用户（Claude Code 重度用户）已经装了大量 skill，对此非常敏感。

#### T1-3. Spec-Driven 卡片

- 卡片可绑定 `spec.md`（功能描述 / 约束 / 验收标准），后续每次 attempt 都把 spec 注入 system prompt。
- 卡片 UI 加 spec 编辑 tab。`agtx` 提到此方向但未具体做。

#### T1-4. Token / 时长 / 成功率 Dashboard

- 后端已有 `execution_processes` 完整日志，加 "Insights" 页：
  - 各 agent 在该项目的 token 消耗 / 平均时长 / 成功率
  - 哪些卡片改了 N 次还没过
  - 月度趋势
- 同类全部空白；本地 SQLite 几条 SQL 可跑出。

---

### 🔵 T2 — 重投入 / 长期价值

#### T2-1. 本地 RAG（sqlite-vss / lancedb）

- 把项目的 README / docs / 历史 PR description embed 到本机向量库。
- 创建卡片时自动召回相关上下文片段注入 prompt。
- 是"完全本地化"叙事的下一站。

#### T2-2. 跨仓库 Workspace（grove 思路）

- 一张卡涉及多个 git 仓（前端 + 后端 + 运维仓）。
- 一键创建多个 worktree，agent 可在其中跳。
- 适合 monorepo 拆分后的团队。

#### T2-3. 自然语言看板控制台

- 顶部一个 "ask anything" 框：「把所有 stale 超过 2 天的 review 卡转给 claude 重做」。
- 后端用本地小模型或调用配置的 agent 之一做意图识别 → 转看板 API 调用。

---

## 5. 起步推荐

| 目标 | 选项 | 理由 |
|---|---|---|
| **吸引社区关注 / 营销** | T0-1 AI Arena | 截图即营销；技术上复用现有 session 调度 |
| **对老用户最实用** | T0-2 MCP 统一面板 | 解决每天都被烦的痛点 |
| **完成"全本地"叙事** | T0-4 附件本地化 | 闭环最后一块 |
| **奠定独占赛道** | T0-3 Windows 原生集成（先做托盘 + 通知） | macOS 同类全部用不上的能力 |

建议执行节奏：**T0-4（附件） → T0-2（MCP 面板） → T0-1（AI Arena） → T0-3（Windows 集成分次）**。

理由：先把"完全本地"承诺收口（T0-4），再上一个让老用户立刻爱上的高频痛点修复（T0-2），再上一个对外宣传的旗舰功能（T0-1），最后慢慢叠 Windows 体验（T0-3）。

---

## 6. 跟进调研缺口

如果未来有时间，可补做：

- 对 `kdlbs/kandev` 的 ACP 抽象层做一次源码级阅读，判断本地版是否值得吸收其抽象（即使不实现 ACP 协议本身）。
- 对 `johannesjo/parallel-code` 的 "AI Arena" 实际 UX 做一次截屏拆解，确定 N 栏并排 diff 的最佳交互。
- 跟踪 GitHub Agent HQ（GitHub 官方）的发布动态，避免被官方功能直接覆盖。
- 跟踪 Anthropic Claude Code 官方的 `--worktree` 与 `/batch` skill 演进；如果官方覆盖了"并行 agent"基础能力，本仓库的差异化重心需要从"调度"上移到"评审 + 编排 + 数据洞察"。

---

*本文件由对竞品横向调研后人工沉淀，非自动生成。落地时请创建对应的 GitHub Discussion 或 issue 以收集反馈，再进入实施。*
