# AI Mobile — 初步规格草案

> 状态：Draft · 创建于 2026-05-21 · 调研依据：[`research-2026-05-21-mobile-solutions-landscape.md`](./research-2026-05-21-mobile-solutions-landscape.md)

---

## 1. 一句话目标

> 让 Vibe Kanban 用户在手机上完成「看板浏览 / 触发 attempt / 看 diff / 批准 agent 操作 / 写评论 / merge」全流程；走 **PWA + 响应式 + 二维码配对** 路径，最小可用版不做原生 App、不做 IDE 远控、不做手机端代码编辑器。

**为什么命名 "AI Mobile"**：与已有 `ai-arena` / `ai-workflow` 同级、含义直白；产品名称在 UI 文案上叫 "Mobile" 或 "On the go" 均可。

**与同类产品的差异**：Happy Coder / Claude Code `/rc` / Codex Mobile 是「IDE 远控」，主交互是 prompt + token 流；Vibe Kanban Mobile 是「看板 + 评审 + 编排」，主交互是卡片浏览 + diff + 批准。两者互不替代，长远可在卡片详情页提供"用 Happy 远程跟进 agent CLI"的引导链接，但不自己造 IDE 远控。

---

## 2. 用户故事

### 主路径

```
作为 用 vibe-kanban 调度多 agent 的工程师
我想 在通勤/会议/排队时用手机查看看板进度、批准 agent 的危险操作、回复评论
为了 不被"必须坐在电脑前"绑住，让 agent 异步工作得到充分利用
```

### 支线场景

| ID | 场景 |
|---|---|
| US-1 | 桌面跑着 Vibe Kanban → 点 "Pair mobile" 弹出二维码 → 手机扫码自动进入 PWA → 看到自己的项目和看板 |
| US-2 | 通勤路上打开 PWA → 看到某 task 的 agent 正在 review 阶段，需要批准 `rm -rf node_modules` → 在手机上点批准 |
| US-3 | 会议间隙看到 agent 完成了一个 attempt → 在手机上看 diff（带语法高亮）→ 评论"按钮颜色改成蓝色"→ 触发重跑 |
| US-4 | 在手机上新建一个 task → 选 executor → 一键启动 attempt → 关掉手机继续过日子 |
| US-5 | agent 跑完 / 失败 / 卡在批准点 → 手机收到推送通知 → 点进去直达卡片详情 |
| US-6 | 在手机上把某 attempt promote 到 main 分支 / 创建 PR / merge |
| US-7 | 切换组织 / 切换 host（多机配对）→ 抽屉式导航 |

### 非目标（Out of Scope，V1 不做）

- ❌ **手机端代码编辑器** — 文件编辑场景指引用户用 Claude Code `/rc` 或 Happy Coder
- ❌ **手机端终端 / agent CLI 远控** — 同上
- ❌ **原生 iOS / Android App**（推迟到 V3 评估 Tauri Mobile）
- ❌ **AI Workflow / AI Arena 的可视化画布编辑** — 移动端只支持运行视图查看，不支持画布编辑
- ❌ **离线模式 / 离线编辑队列** — V1 仅在线
- ❌ **手机端 PR 行内评审** — 看 diff 可以，行内评论推迟到 V2

---

## 3. 信息架构

### 3.1 三层导航（mobile-first）

```
┌─────────────────────────────────┐
│  ☰  Vibe Kanban       🔔 👤    │ ← 顶 navbar：抽屉触发 + 通知 + 用户
├─────────────────────────────────┤
│                                 │
│  [Project / Org 切换]           │
│  [Task 看板（垂直流，可切换列）] │ ← 主区
│   ┌─────────┐                  │
│   │ Task 卡 │                  │
│   └─────────┘                  │
│                                 │
├─────────────────────────────────┤
│ [Kanban] [Workflow] [Cmd]      │ ← 底 tab bar：核心入口
└─────────────────────────────────┘
```

- **抽屉（左侧滑入）**：项目列表 + 组织头 + 登录态
- **底 tab bar**：Kanban / Workflow Run / Command（创建 task）
- **看板单列模式**：手机宽度只显示一列，左右滑切换列状态（todo → in-progress → review → done → cancelled）

### 3.2 关键页面

| 页面 | 桌面端 | 移动端差异 |
|---|---|---|
| Kanban 看板 | 多列横向滚动 | 单列垂直 + 左右滑切列 |
| Task 详情 | 三栏（左：metadata / 中：chat / 右：diff/logs）| 顶部 tab 切换（Chat / Diff / Logs / Files） |
| Diff 视图 | 双栏 side-by-side | 单栏 unified diff + 折叠 hunk |
| Workflow 画布 | 可编辑 | 只读运行视图（节点状态色 + 失败高亮）|
| 设置 | 多分类侧边栏 | 折叠 list |

---

## 4. 配对与远程访问

### 4.1 现状

上游 Remote Access 是 **6 位 pairing code 手输入**：

1. 桌面打开 Settings → Remote Access → Show pairing code
2. 手机访问 `cloud.vibekanban.com` 登录
3. 在手机上 `Remote Access → Link a host` → 选 host → 输 6 位码 → Pair

### 4.2 V1 改造：二维码

```
桌面端                          手机端 PWA
─────────                       ─────────
点 "Pair Mobile" 按钮            打开 https://<host>/m （PWA 入口）
   ↓                                ↓
弹出二维码（含 host_id + token）   首次：点 "Scan to pair"
   ↓                                ↓
   ←──── 扫码 ────────────────── 调起 getUserMedia + jsQR
   ↓
relay 握手（沿用 crates/relay-*）
   ↓
配对完成 → 跳转到 host 的看板
```

**二维码内容编码**：

```
vibekanban://pair?host=<host_id>&code=<one_time_token>&relay=<relay_url>&expires=<unix_ts>
```

- `host_id`：host 实例标识
- `code`：一次性 token，30 秒过期，签名防伪造
- `relay`：relay URL（自建优先，公共 fallback）
- `expires`：token 过期时间

**为什么不直接复用 pairing code 流程**：

- pairing code 需要用户手动登录 cloud.vibekanban.com（上游正在 sunset，长期不可靠）
- 扫码可以同时编码 relay 地址，**支持自建 relay 零配置**
- 首次配对时间从 ~30s 降到 ~3s

### 4.3 Relay 策略

- **默认**：连接 host 自身（同局域网 / Tailscale 场景）
- **公网穿透**：走自建 relay（项目已有 `crates/relay-client` / `crates/relay-control` / `crates/relay-protocol` / `crates/relay-ws` / `crates/relay-hosts`，基础设施齐全）
- **fallback**：公共 `cloud.vibekanban.com`（上游 sunsetting，仅向后兼容）

---

## 5. 推送通知（V1 中性策略）

iOS Safari Web Push 在 16.4+ 支持，且要求"添加到主屏幕"。Android Chrome 全面支持。

### 5.1 V1：双轨

| 通道 | 触发 | 备注 |
|---|---|---|
| **Web Push (PWA)** | agent 完成 / 失败 / 等待批准 | Android 友好；iOS 需用户先"添加到主屏幕" |
| **可选 Telegram / Discord webhook** | 同上 | 用户在 Settings 配置 bot token，作为兜底通道；Slack 在 V2 |

### 5.2 通知内容

```
[Project A] Task #42: agent 等待批准
🤖 codex 想执行 `rm -rf target/`
[批准] [拒绝] [查看]
```

支持 action button 快速批准 / 拒绝，点击进入卡片详情。

---

## 6. 里程碑划分

| 里程碑 | 目标 | 主要工作 | 预估工作量 |
|---|---|---|---|
| **M1：拿下基础布局** | 手机能流畅浏览看板和 task 详情 | Cherry-pick 上游 PR [#2947](https://github.com/BloopAI/vibe-kanban/pull/2947) + [#2889](https://github.com/BloopAI/vibe-kanban/pull/2889) → 适配当前 fork → 真机验证（iPhone Safari + Android Chrome）→ 修补已知 Issue [#230](https://github.com/BloopAI/vibe-kanban/issues/230) / [#1359](https://github.com/BloopAI/vibe-kanban/issues/1359) | S（1-2 天） |
| **M2：二维码配对** | 首次上手时间从 30s → 3s | 桌面端 QR 生成（含签名 token + relay URL）→ PWA 扫码（`getUserMedia` + jsQR）→ relay 握手沿用 `crates/relay-*` → 自建 relay 默认 | M（3-5 天） |
| **M3：移动批准与 diff 体验** | 在手机上能批准 agent 操作 + 看 diff | 批准对话框移动布局优化 → diff 单栏 unified 视图 + hunk 折叠 → 评论输入框优化（自动展开 + 软键盘适配） | M（3-5 天） |
| **M4：推送通道** | agent 状态变化能找到用户 | PWA Web Push (Service Worker) → action button → Telegram/Discord webhook bot → Settings 配置 UI | M（5-7 天） |
| **M5（可选）：Tauri Mobile 包壳** | 团队订阅规模 + 推送强需求 | 评估 Tauri Mobile（已有 `crates/tauri-app` desktop 基础）→ iOS / Android 构建 → App Store / Play Store 审核 | L（2-4 周）|

---

## 7. 技术选型小结

| 方面 | 选型 | 备选 | 决定理由 |
|---|---|---|---|
| 移动框架 | PWA（沿用 `packages/local-web` + `web-core`）| Capacitor / Tauri Mobile / 原生 | 复用 100% 现有代码；阻力最小 |
| 配对协议 | 自定义 QR + `crates/relay-*` | pairing code / Tailscale 引导 | 基础设施齐全；体验最好 |
| 推送通道 | Web Push + Telegram/Discord webhook 双轨 | 仅 Web Push / 仅 IM | iOS 兼容性兜底 |
| QR 扫描 | `getUserMedia` + jsQR（纯前端）| zxing-js / 原生相机 | 无需原生权限；PWA 友好 |
| 看板交互 | 单列 + 左右滑切列 | 横向滚动整面看板 | 上游 Issue #1359 已证明横向滚动在手机上失败 |
| Diff 视图 | unified + 折叠 hunk | side-by-side / monaco diff | 移动屏幕宽度不够 side-by-side；monaco 在手机加载慢 |

---

## 8. 待决策（需用户/团队 review）

- [ ] **是否自建 relay 作为默认**？还是先继续依赖 `cloud.vibekanban.com`（上游 sunsetting 风险）？
- [ ] **Telegram 还是 Discord 作为 V1 推送 IM**？还是两个都做？
- [ ] **PWA 入口路径**：`/m`、`/mobile`，还是直接根路径响应式检测？
- [ ] **是否在 M2 把 pairing code 流程完全替换掉**？还是保留作为 fallback？
- [ ] **本 fork 是否要把"移动端"作为差异化卖点对外宣传**？还是低调跟进上游就好？

---

## 9. 关联资料

- 调研报告：[`research-2026-05-21-mobile-solutions-landscape.md`](./research-2026-05-21-mobile-solutions-landscape.md)
- 索引：[`README.md`](./README.md)
- 上游 Remote Access：[`vibekanban.com/docs/remote-access`](https://vibekanban.com/docs/remote-access)
- 上游 mobile PR：[#2947](https://github.com/BloopAI/vibe-kanban/pull/2947) · [#2889](https://github.com/BloopAI/vibe-kanban/pull/2889)
- Relay 基础设施：`crates/relay-client` / `relay-control` / `relay-protocol` / `relay-ws` / `relay-hosts`
- 当前包结构：`packages/local-web/` + `packages/remote-web/` + `packages/web-core/`
