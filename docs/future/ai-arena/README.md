# AI Arena 文档目录

本目录沉淀 **AI Arena**（同题多 agent 头对头对比）功能的全部设计与实施文档。

## 目录索引

| 文件 | 内容 |
|---|---|
| [README.md](./README.md) | 本索引 |
| [spec.md](./spec.md) | 功能规格 — 用户故事、数据模型、API 接口、UI 描述、验收标准 |
| [plan.md](./plan.md) | 分阶段实施计划 — 4 个独立可交付里程碑 + 调研 Step 0 |

未来新增文件命名约定：

| 类型 | 命名 | 例子 |
|---|---|---|
| 设计决策 | `decision-<日期>-<主题>.md` | `decision-2026-05-multi-column-diff.md` |
| 实施记录 | `impl-step<编号>-<日期>.md` | `impl-step1-2026-05.md` |
| 问题排查 | `issue-<日期>-<主题>.md` | `issue-2026-06-worktree-leak.md` |
| 测试结论 | `test-<日期>.md` | `test-2026-06.md` |

## 一句话定位

> Vibe Kanban 现有的"task → workspace（attempt）→ session"已经是天然的并行结构；AI Arena 不是新建一套机制，而是给一个 task **同时启动 N 个 workspaces**（每个绑不同 executor），并提供 N 栏并列 diff 的评审视图，最后挑一个 promote 到主分支。

## 关联资料

- 上层路线图：[`docs/future/future_task.md`](../future_task.md) §4 T0-1
- 数据模型基线：`crates/db/migrations/20251216142123_refactor_task_attempts_to_workspaces_sessions.sql`
- Workspace 启动逻辑入口：`crates/server/src/routes/workspaces/create.rs` + `crates/server/src/routes/workspaces/execution.rs`
