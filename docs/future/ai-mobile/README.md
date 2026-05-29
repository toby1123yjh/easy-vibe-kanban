# AI Mobile 文档目录

本目录沉淀 **AI Mobile**（Vibe Kanban 手机远程使用）功能的全部调研、设计与实施文档。

## 目录索引

| 文件 | 内容 |
|---|---|
| [README.md](./README.md) | 本索引 |
| [research-2026-05-21-mobile-solutions-landscape.md](./research-2026-05-21-mobile-solutions-landscape.md) | 生态调研 — vibe coding 手机远程方案全景（6 大类）+ 上游 vibe-kanban 移动相关 PR/Issue 盘点 + 推荐路径分析 |
| [spec-draft.md](./spec-draft.md) | 初步规格草案 — PWA + 二维码配对 + 推送外挂的产品形态与里程碑划分 |

未来新增文件命名约定：

| 类型 | 命名 | 例子 |
|---|---|---|
| 调研 | `research-<日期>-<主题>.md` | `research-2026-06-push-notification.md` |
| 设计决策 | `decision-<日期>-<主题>.md` | `decision-2026-06-tauri-mobile-vs-capacitor.md` |
| 实施计划 | `plan-<版本>.md` | `plan-v1.md` |
| 实施记录 | `impl-step<编号>-<日期>.md` | `impl-step1-2026-06.md` |
| 问题排查 | `issue-<日期>-<主题>.md` | `issue-2026-06-ios-pwa-push.md` |
| 测试结论 | `test-<日期>.md` | `test-2026-07.md` |

## 一句话定位

> Vibe Kanban 核心是「看板浏览 + agent 编排 + 评审」，不是「手机敲代码」；因此手机方案不应套用 Claude Code Remote Control / Happy Coder 这类"IDE 远控"产品形态，而应沿着已有 `web-core` + Remote Access 配对机制走 **PWA + 响应式 + 二维码配对** 路径，把项目自身做成 mobile-first 的协作中枢，需要 IDE 远控时让用户自行外挂 Happy/官方 `/rc`。

## 关联资料

- 上层路线图：[`docs/future/future_task.md`](../future_task.md)
- 兄弟特性：[`docs/future/ai-workflow/`](../ai-workflow/) · [`docs/future/ai-arena/`](../ai-arena/)
- 上游 Remote Access 机制：[`vibekanban.com/docs/remote-access`](https://vibekanban.com/docs/remote-access)（pairing code + cloud.vibekanban.com 中继）
- 上游 mobile layout PR：[BloopAI/vibe-kanban#2947](https://github.com/BloopAI/vibe-kanban/pull/2947)（full mobile layout for local-web and remote-web）+ [#2889](https://github.com/BloopAI/vibe-kanban/pull/2889)（mobile-friendly responsive layout with PWA support）
- 上游 mobile 历史 issue：[#230](https://github.com/BloopAI/vibe-kanban/issues/230) · [#1359](https://github.com/BloopAI/vibe-kanban/issues/1359) · [PR #1334](https://github.com/BloopAI/vibe-kanban/pull/1334)
- 当前 fork 包结构：`packages/local-web/` + `packages/remote-web/` + `packages/web-core/`（与上游 monorepo 一致，#2947 可移植）
