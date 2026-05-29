# Vibe Coding 手机远程使用方案调研

> 状态：Draft · 创建于 2026-05-21 · 调研工具：super-search（Exa + Tavily，Grok 不可用） · 上层规格见 [`spec-draft.md`](./spec-draft.md)

---

## 1. 调研目的

回答两个问题：

1. **生态里手机远程使用 AI coding 都有哪些方案？**（用户已知二维码方案，需补全其它形态）
2. **当前项目（easy-vibe-kanban）应该走哪条路径做手机端？**

调研覆盖：搜索引擎深度查询 + 上游 BloopAI/vibe-kanban PR/Issue 盘点 + 当前 fork 结构核对。

---

## 2. 生态方案全景（按产品形态分类）

### 2.1 二维码远程控制（当下主流形态）

桌面端跑 agent，扫码把手机变成"遥控器"。本地执行 + 出站 HTTPS / E2EE。

| 工具 | 来源 | 协议特征 | 备注 |
|---|---|---|---|
| **Claude Code Remote Control** | Anthropic 官方（2026-02-25）| `/rc` / `claude remote-control` 生成 QR，出站 HTTPS + TLS，多组短期凭证 | 需 Pro/Max，v2.1.51+ |
| **OpenAI Codex Mobile** | OpenAI 官方（2026-05）| 桌面 Codex App QR → ChatGPT App 扫码，secure relay layer，状态同步而非环境复制 | iOS/Android preview，全方案可用 |
| **Cursor 移动端** | Cursor 官方（2026-01 起）| iOS 伴随 App，prompt → Mac Cursor IDE；后续接 Background Agents 云端 VM | |
| **Happy Coder** | slopus/happy（开源）| `happy codex` 起手 → 选 mobile → QR → 手机 App。E2EE + 语音 | 支持 Claude Code / Codex / Gemini CLI / OpenCode |
| **vibe-remote / Btelo Coding** | ymzuiku/vibe-remote（开源）| 原生 iPhone App + 扫码配对 | 公共 relay 或自托管 |
| **AgentsRoom** | agentsroom.dev | macOS App 跑 agent + iOS 扫码 + E2EE | 多 agent 并行 + 每 agent 独立 git worktree |
| **Termly** | termly.dev（npm CLI bridge）| 任意终端 AI 工具 → QR → iPhone/Android | 通用桥接 |
| **Pocket Agent** | 第三方 | 120Hz 流式终端 + 本地/远程混合执行 | |

**通用模式**：扫码 = 一次性配对凭证；后续走 relay / WebSocket；代码、文件系统、MCP server 留在本机。

### 2.2 文字端中转（不用专门 App）

| 工具 | 接入面 | 备注 |
|---|---|---|
| Claude-Code-Remote | Email / Discord / Telegram | 邮件指令式控制 |
| Takopi | Telegram bot | Claude Code → Telegram |
| The Vibe Companion | Web UI | 利用 Claude Code 隐藏 `-sdk-url` flag，浏览器移动编程，无需 App |

**特点**：零安装、聊天 UI 友好，但只能"发指令收文本"，无 diff/批准等结构化交互。

### 2.3 DIY 终端流（万年通用）

```
SSH/Mosh + tmux + Tailscale + Termius
```

抗弱网最强；手机打字最痛。`Mosh` 处理移动网络切换；`Tailscale` 免公网暴露；`Termius` 提供更好的手机键盘 + snippets。

附加方案：**Railway claude-code-ssh template** — 一键云容器，SSH 进入，电脑可关机。

### 2.4 云端代理（手机直接发任务，不依赖本机开机）

| 平台 | 形态 | 备注 |
|---|---|---|
| **Cursor Background Agents** | 云端 Ubuntu VM，clone repo → 跑任务 → 开 PR | GA since 2025 末，可从 IDE/Slack/Mobile 触发 |
| **GitHub Copilot Coding Agent** | 完全云端跑（GitHub Actions）| 从 GitHub Mobile 派任务，2025-06 起 |
| **Conductor.build** | 闭源 macOS 桌面 App，云端并行 worktree | $22M 融资，客户含 Linear/Vercel/Stripe/Notion |
| **Terragon Labs** | 云沙箱（曾免费 beta）| 远程 web 接入工具被官方平台逐渐"吸收" |
| **Omnara**（YC S25）| iOS 语音优先，本地 agent + 远程语音交互 | |

**信号**：DEV.to 综述指出 "remote access gets baked into every coding agent within the year" — 独立远程包装器正在被官方 web 入口吞并。

### 2.5 移动端原生 vibe coding（不"远程"，直接在手机上做 app）

不在本次重点，但属于同一搜索空间：

- **Bolt.new / v0 / Lovable / Replit**：浏览器原生，移动友好，prompt → 全栈
- **国内 IDE**：Trae（字节）/ 通义灵码（阿里）/ CodeBuddy（腾讯）/ Comate（百度）/ InsCode（华为云×CSDN）— 部分 Web 端可用
- **微信小程序 vibe coding**：codefather 等教程演示 prompt → WXML/WXSS/JS 直出

### 2.6 PWA + 响应式 Web

最朴素也最贴合协作类产品（Linear、Jira、Trello 都是这条路）：响应式布局 + Service Worker + Web Push + installable to home screen。

iOS Safari 在 16.4+ 才支持 Web Push，且需要"添加到主屏幕"；Android Chrome 全面支持。

---

## 3. 当前项目的特殊性

### 3.1 项目核心不是"手机敲代码"

| 维度 | 上游 IDE 远控产品 | Vibe Kanban |
|---|---|---|
| 主交互对象 | 单 agent 会话（CLI/IDE）| Kanban 卡片 + 多 workspace + agent 编排 |
| 主操作 | 发 prompt / 看 token 流 / 批准 tool | 看板浏览 / 触发 attempt / 看 diff / 评论 / merge |
| 沉淀物 | 终端 session | task / workspace / session / PR |
| 类比产品 | Termux / Tabby / Termius | Linear / Jira / Trello |

**结论**：硬接 Happy/vibe-remote 协议会把项目降级成它们的"后端"，丢失看板这层产品价值。手机方案应做成"看板的 mobile-first 视图"，而不是"agent CLI 的遥控器"。

### 3.2 已有的移动相关基础设施（关键发现）

调研中命中上游 BloopAI/vibe-kanban 大量移动相关工作，**当前 fork 可直接 cherry-pick**：

| 资源 | 状态 | 价值 |
|---|---|---|
| **官方 Remote Access** ([docs](https://vibekanban.com/docs/remote-access)) | 已 GA | pairing code + `cloud.vibekanban.com` 中继，从手机访问 host workspaces — **项目自带的远程方案**，已经是"H5 路径"的雏形 |
| **PR [#2947](https://github.com/BloopAI/vibe-kanban/pull/2947)** "full mobile layout for local-web and remote-web" | 已存在 | Navigation Drawer 抽屉式导航、响应式 navbar、PWA 支持、对话框间距、头像响应式尺寸 |
| **PR [#2889](https://github.com/BloopAI/vibe-kanban/pull/2889)** "mobile-friendly responsive layout with PWA support" | #2947 前身 | 原始 PWA 方案 |
| **PR [#1334](https://github.com/BloopAI/vibe-kanban/pull/1334)** Kanban 横向滚动修复 | 已 merged | 移除 `touch-pan-y` 类 |
| **Issue [#230](https://github.com/BloopAI/vibe-kanban/issues/230)** Mobile 滚动失效 | 已改进 | 模态滚动痛点清单 |
| **Issue [#1359](https://github.com/BloopAI/vibe-kanban/issues/1359)** 移动端列不全可见 | 已改进 | iPhone Chrome 只能看到 todo / in-progress |

当前 fork 包结构（`packages/local-web/` + `packages/remote-web/` + `packages/web-core/`）与上游 monorepo 一致，#2947 移植阻力极低。

### 3.3 上游已宣布 sunsetting

> "Vibe Kanban is sunsetting. The project will continue as open source and community maintained."

意味着 **cherry-pick 窗口期有限**，但社区维护期内的 PR 仍然可用。需要尽快把 mobile layout 这类成熟工作合到 fork 主干。

---

## 4. 路径对比

| 方案 | 工作量 | 留存率 | 体验 | 维护成本 | 与项目定位契合度 |
|---|---|---|---|---|---|
| **A. H5 + PWA（cherry-pick #2947）** | 低 | 浏览器零安装 | iOS Web Push 弱、文件保存差 | 低，跟上游 | ★★★★★ |
| **B. 二维码替代 pairing code** | 中-低 | 与 A 同套基础设施 | 体验跨越式提升 | 低 | ★★★★★ |
| **C. Tauri Mobile / Capacitor 原生壳** | 中-高 | App 商店审核 | 推送/相机/键盘原生级 | 多套构建 | ★★★ |
| **D. 接入 Happy Coder / vibe-remote 协议** | 高 | 借力现成 App | 定位错位，项目降级为后端 | 重 | ★ |
| **E. 完全自研 iOS/Android App** | 极高 | 商店审核 + 双端原生 | 最好 | 最重 | ★★ |
| **F. 外挂 Telegram/Discord Bot（推送通道）** | 低 | 用户已有 IM | 不能做结构化交互 | 低 | ★★★★（作为 A 的补丁） |

**推荐组合**：**A → B → F**（推送强需求时） → **C**（团队规模化后评估）。**不推荐 D / E**。

---

## 5. 关键 tradeoff

### 5.1 iOS PWA 推送

- Web Push 在 iOS 16.4+ 支持，但需要用户"添加到主屏幕"才能装注册推送
- Android Chrome 全面支持，无此限制
- **决策点**：如果"agent 完成后推送到手机"是高优需求 → 推 Telegram/Discord webhook 作为补丁（方案 F），不要等用户都升 iOS 16.4 + 装到桌面

### 5.2 二维码 vs Pairing Code

当前 Remote Access 是"输入 6 位配对码"，扫码会让首次上手时间从 ~30s 降到 ~3s。同时扫码本身可以编码：

```
vibekanban://pair?host=<host_id>&code=<one_time_token>&relay=<relay_url>
```

手机端 PWA 通过 `getUserMedia` + jsQR 解析，无需原生权限。

### 5.3 Relay 自托管 vs 公共

- 公共 `cloud.vibekanban.com`：零配置，但上游 sunsetting，长期不可靠
- 自建 relay：项目已经有 `crates/relay-*` 系列 crate（relay-client / relay-control / relay-protocol / relay-ws / relay-hosts），基础设施齐全
- **建议**：fork 中默认走自建 relay，公共 relay 作为可选 fallback

### 5.4 当 IDE 远控真的需要

少数用户场景是"在手机上让 Claude Code 跑代码"，而不是"看 Kanban"。此时**不要自己造**：

- 推荐用户在桌面跑 `claude /rc` 或 `happy codex` 自己解决
- Vibe Kanban 文档里加一段"在卡片里用 agent CLI 时如何远程跟进"的指引即可

---

## 6. 推荐路径（落地顺序）

```
里程碑 M1：cherry-pick PR #2947 + 验证响应式
  ↓
里程碑 M2：把 Remote Access pairing code 改成二维码扫码
  ↓
里程碑 M3：评估推送需求
   - 低 → 留在 PWA + Web Push（Android 友好）
   - 高 → 加 Telegram/Discord webhook bot
  ↓
里程碑 M4（可选）：团队订阅规模 → Tauri Mobile 包壳
```

详见 [`spec-draft.md`](./spec-draft.md)。

---

## 7. 引用来源

调研工具：`super-search-skill`，使用通道 `Exa + Tavily`（Grok 不可用，已用户确认继续）。

### 7.1 官方/权威

- [Claude Code Remote Control on Your Phone — Builder.io](https://www.builder.io/blog/claude-code-mobile-phone)
- [Claude Code Remote Control: Practical Guide — Claude Lab](https://claudelab.net/en/articles/claude-code/claude-code-remote-control-guide)
- [Claude Code 推 Remote Control 功能 — unwire.pro](https://unwire.pro/2026/02/25/claude-code-remote-control-mobile/ai/)
- [Codex 更新远程控制 — 53AI](https://www.53ai.com/news/LargeLanguageModel/2026051516548.html)
- [OpenAI Codex 手機版上線 — aiposthub](https://www.aiposthub.com/openai-codex-mobile-app-remote-agent-control/)
- [Vibe Kanban Remote Access — 官方文档](https://vibekanban.com/docs/remote-access)
- [Introducing Vibe Kanban Cloud — vibekanban.com/blog](https://www.vibekanban.com/blog/introducing-vibe-kanban-cloud)

### 7.2 开源/产品

- [slopus/happy — Mobile and Web client for Codex and Claude Code](https://github.com/slopus/happy)
- [ymzuiku/vibe-remote](https://github.com/ymzuiku/vibe-remote) · [btelolabs/btelo-coding-release](https://github.com/btelolabs/btelo-coding-release)
- [AgentsRoom — Mobile-Desktop Sync](https://agentsroom.dev/features/mobile-desktop-sync) · [App Store](https://apps.apple.com/us/app/agentsroom-ai-remote-dev-agent/id6761265182)
- [Termly — Universal AI Coding Assistant on Mobile](https://termly.dev/)
- [手机上也能 vibe coding 了 — 少数派](https://sspai.com/post/105692)（Happy Coder 实测）
- [随时随地 AI 编程 — VibeVibe Happy Coder 章节](https://www.vibevibe.cn/Advanced/happy-coder.html)

### 7.3 综述/对比

- [Remote Coding: Running AI Agents From Anywhere (The Full Stack) — DEV](https://dev.to/stevengonsalvez/remote-coding-running-ai-agents-from-anywhere-the-full-stack-4lji)
- [Pocket Agent / mobile-first AI coding — LinkedIn 综述](https://www.linkedin.com/posts/shubhamsaboo_you-dont-need-your-laptop-to-run-claude-activity-7369919053785821184-mqM0)
- [17 Best Vibe Coding Tools 2026 — Taskade](https://www.taskade.com/blog/best-vibe-coding-tools)
- [Claude Code vs Cursor — Builder.io](https://www.builder.io/blog/cursor-vs-claude-code)

### 7.4 上游 vibe-kanban PR/Issue

- PR [#2947 feat: full mobile layout](https://github.com/BloopAI/vibe-kanban/pull/2947)
- PR [#2889 mobile-friendly responsive layout with PWA support](https://github.com/BloopAI/vibe-kanban/pull/2889)
- PR [#1334 Can't scroll kanban horizontally on mobile](https://github.com/BloopAI/vibe-kanban/pull/1334)
- Issue [#230 Can't scroll on Mobile screens](https://github.com/BloopAI/vibe-kanban/issues/230)
- Issue [#1359 Can it provide better support for mobile use](https://github.com/BloopAI/vibe-kanban/issues/1359)
