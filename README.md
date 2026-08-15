<p align="center">
  <picture>
    <source srcset="packages/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
    <img src="packages/public/vibe-kanban-logo.svg" alt="easy-vibe-kanban logo">
  </picture>
</p>

<p align="center"><strong>Plan with kanban. Execute with AI agent workflows.</strong></p>
<p align="center">Orchestrate Claude Code, Codex, Gemini CLI and 10+ coding agents — as single tasks or as multi-agent workflows on a visual canvas.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/easy-vibe-kanban"><img alt="npm" src="https://img.shields.io/npm/v/easy-vibe-kanban?style=flat-square" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" /></a>
</p>

<p align="center">English | <a href="README.zh-CN.md">中文</a></p>

> **easy-vibe-kanban** is an independently maintained hard fork of [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) (sunset by BloopAI). It continues development with a major new capability: **agentic workflows** — running a task as a graph of cooperating agent sessions.

```bash
npx easy-vibe-kanban
```

![](packages/public/vibe-kanban-screenshot-overview.png)

## Why

Engineers working with coding agents spend most of their time on two things: **planning** work and **reviewing** agent output. easy-vibe-kanban is built to make both fast — and to go one step further: instead of babysitting one agent at a time, you can wire multiple agent sessions into a workflow and let them execute a task end-to-end.

## ✨ Agentic Workflows

The headline feature of this fork. A **Workflow Attempt** is a way to execute a task: instead of a single agent session, you design a flow graph of agent steps on a visual canvas, and the steps run automatically in sequence.

![](packages/public/workflow-canvas.png)

*The built-in "Plan, Parallel Frontend & Backend, Review, Finalize" template on the workflow canvas — Claude Code plans, Gemini and Codex implement in parallel, then review and finalize.*

- **Visual canvas** — design your flow with a node palette, drag-and-drop steps, and live execution states on every node and edge
- **One agent session per step** — each Agent Step is a stable, real agent session you can open and chat with, exactly like a normal task attempt
- **Mix and match agents** — use different agents for different stages: e.g. Claude Code to implement, Codex to review, Gemini CLI to write tests
- **Shared worktree** — all steps in a workflow share one git worktree. Context flows through the actual code, not through brittle prompt-passing between nodes
- **Automatic execution** — when a step finishes, its outgoing edges trigger the next steps; fan-out and join are supported
- **Agentic condition routing** — add a router step that lets an agent decide which branch of the graph to take next
- **Issue-native** — workflows live under an issue as one of its task attempts, alongside regular single-agent attempts. Same review, diff, and PR flow afterwards

A typical flow:

```
Start → Plan (Claude Code) → Implement (Codex) → Condition Router
                                                    ├─ pass → Write tests (Gemini) → End
                                                    └─ fail → Fix issues (Claude Code) ↺
```

## Core Features

- **Plan with kanban issues** — create, prioritise, and assign issues on a kanban board
- **Run coding agents in workspaces** — each workspace gives an agent a branch, a terminal, and a dev server
- **Review diffs and leave inline comments** — send feedback directly to the agent without leaving the UI
- **Preview your app** — built-in browser with devtools, inspect mode, and device emulation
- **Switch between coding agents** — Claude Code, Codex, Gemini CLI, and Oh My Pi
- **Create pull requests and merge** — open PRs with AI-generated descriptions, review on GitHub, and merge

![](packages/public/vibe-kanban-screenshot-workspace.png)

## Installation

Authenticate with your favourite coding agent first, then run:

```bash
npx easy-vibe-kanban
```

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (>=20)
- [pnpm](https://pnpm.io/) (>=8)

```bash
cargo install cargo-watch sqlx-cli
pnpm i
pnpm run dev   # starts backend + web app; a blank DB is seeded from dev_assets_seed
```

Useful commands:

| Command | Description |
|---------|-------------|
| `pnpm run check` | Type checks (frontend + all Rust workspaces) |
| `pnpm run lint` | ESLint + clippy |
| `pnpm run format` | Prettier + rustfmt |
| `cargo test --workspace` | Rust tests |
| `pnpm run generate-types` | Regenerate TS types from Rust (ts-rs) |

### Key environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | Auto-assign | Production server port (dev: frontend port, backend uses PORT+1) |
| `HOST` | `127.0.0.1` | Backend server host |
| `VK_ALLOWED_ORIGINS` | Not set | Comma-separated origins allowed to call the backend API (required behind a reverse proxy / custom domain) |
| `DISABLE_WORKTREE_CLEANUP` | Not set | Disable git worktree cleanup (debugging) |

## Architecture

- **Backend**: Rust workspace — Axum API server, SQLx, a dedicated `workflow` crate (graph, planner, runner, validation), executor adapters for each coding agent, and git/worktree management
- **Frontend**: React + TypeScript + Vite + Tailwind monorepo (`packages/local-web`, `packages/web-core`)
- **Shared types**: generated from Rust via ts-rs (`shared/types.ts`) — never edited by hand

## Acknowledgements & License

This project is a hard fork of [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) by Bloop AI. Huge thanks to the original team for building and open-sourcing it.

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution details.
