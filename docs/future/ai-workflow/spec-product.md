# AI Workflow Productization Spec

> Status: P0/P1 baseline implemented locally
> Date: 2026-05-14
> Scope: AI Workflow canvas productization and next implementation priorities
> Related docs: `spec.md`, `spec-0512c.md`, `canvas-open-source-analysis-0511.md`, `canvas-p1-implementation-plan-0512.md`

## 0. How To Read This Spec

This document is the product-level organizing spec for AI Workflow canvas work.
It is meant to answer four questions:

1. What product are we building?
2. Why does the current canvas still feel behind Dify, n8n, Circuit and similar tools?
3. Which capabilities should be built next?
4. What should not be done yet?

Use this document to review scope and priority. Use implementation plans for
file-by-file execution.

## 1. Decision Snapshot

### 1.1 Product Direction

AI Workflow is a task execution workflow designer for multi-agent coding work.
It is not a generic automation builder and not only a visualization of a running
workspace.

The user mental model should be:

> I can take one issue, design how multiple agents and review gates should solve
> it, run that workflow, and inspect every agent session and handoff.

### 1.2 Core Runtime Decision

- One Workflow Run owns one task context.
- One Workflow Run normally owns one shared workspace/worktree.
- Each Agent Step owns its own session and execution process.
- A node is not a full workspace.
- A node is a configured work unit inside the run.
- Cross-agent handoff happens through rendered input, upstream outputs, run
  metadata and shared worktree state.
- Agents should not share hidden chat memory by default.

### 1.3 Current Status

Already implemented or partially implemented:

- Workflow template graph JSON.
- Design canvas based on React Flow.
- Drag from palette.
- Node movement and position persistence.
- Connect and reconnect edges.
- Semantic edge labels.
- Node inspector/dialog basics.
- Run canvas with node execution state.
- Agent node double-click stays on run canvas and opens a node conversation panel.
- Edge handle persistence with four-direction handle IDs.
- Graph migration from legacy handle-less graphs.
- Schema-driven node configuration baseline.
- Insert-on-edge for adding Agent Steps.
- Quick add / command search.
- Runtime I/O, rendered prompt and upstream output debug panel.
- Node-level session surface with session/process metadata.

Still missing for later product quality:

- Full chat transcript embedding for a node session.
- Append-from-selected-node shortcut.
- Multi-select, copy/paste, grouping and comments.
- Step rerun / continue controls.
- Visual regression coverage for core canvas states.

## 2. Product Language

Use **Step** in user-facing copy. Use **node** only in code and technical docs.

| Product term | Meaning | Data/runtime mapping |
|---|---|---|
| Workflow | Reusable task execution graph | Workflow template / `graph_json` |
| Run | One workflow execution for one task | `workflow_run` |
| Step | One visual unit in the workflow | Workflow node |
| Agent Step | One configured agent session launcher | Workspace session + execution process |
| Human Gate | Manual review/checkpoint | Awaiting-human node execution |
| Arena Step | Parallel attempt comparison | Arena group / attempts / promotion |
| Connection | Control/data route between steps | Workflow edge |
| Session | Existing agent conversation | Existing `Session` |
| Execution Process | One execution inside a session | Existing execution process |
| Worktree | Shared code state for the run | Existing workspace/worktree |

## 3. Priority Backlog

### 3.1 P0: Persist Edge Handles And Add Graph Migration

#### Problem

Current `WorkflowEdge` stores only:

```ts
{
  id: string
  source: string
  target: string
  type: WorkflowEdgeKind
}
```

This means the graph knows that node A connects to node B, but does not know
which source port or target port was used.

#### Target

Persist handle identity:

```ts
{
  id: string
  source: string
  source_handle?: string
  target: string
  target_handle?: string
  type: WorkflowEdgeKind
}
```

The React Flow runtime can keep `sourceHandle` / `targetHandle`. Persisted graph
JSON can use `source_handle` / `target_handle` if that matches the API style.
The key product requirement is that saved workflow data remembers the port
identity.

#### Why It Matters

Example:

```ts
condition.approved -> implement.input
condition.rejected -> revise.input
```

Without source and target handles, the graph can degrade into:

```ts
condition -> implement
condition -> revise
```

The route still exists, but the route meaning is weaker.

User value:

- Four-direction handles become real behavior, not decoration.
- Lines reload in the same visual direction.
- Branch labels stay attached to the correct route.
- Existing edge endpoints can be dragged without corrupting branch meaning.
- Condition, approval, rejection and arena-winner routes become easier to reason about.

#### Graph Migration

Graph migration is the compatibility layer that upgrades old saved workflow JSON
to the latest graph shape.

Because existing workflow graphs were saved without handles, old graphs should
open safely and receive defaults:

```ts
version 1:
  start -> agent

version 2 after migration:
  start.output -> agent.input
```

User value:

- Existing templates continue to open.
- Old workflow runs remain inspectable.
- New canvas features can ship without forcing users to recreate workflows.
- Tests can prove graph format changes are safe.

Likely modules:

- `packages/web-core/src/features/workflow/model/workflowGraph.ts`
- `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
- Rust workflow graph structs and generated shared types if API contracts expose the new fields.

Acceptance:

- Unit tests load old graph JSON and migrate it to the current graph shape.
- Playwright verifies connect, reconnect and reload preserve handle identity.
- TypeScript check passes.
- Generated shared types are updated if Rust type changes are required.

### 3.2 P0: Introduce A Schema-Driven Node Configurator

#### Problem

`WorkflowNodeInspector.tsx` currently renders node forms with type-specific UI
branches. This works for a small V1 surface, but it becomes hard to maintain
when Agent Step grows to include:

- executor profile;
- model;
- prompt template;
- rendered prompt preview;
- input bindings;
- MCP tools;
- retry policy;
- conversation mode;
- output schema.

#### What Schema-Driven Means

Today, the inspector logic is roughly:

```ts
if (node.type === 'agent') {
  render role input
  render prompt textarea
}

if (node.type === 'condition') {
  render condition rules
  render branch editor
}
```

The target is a node schema registry:

```ts
agent: {
  fields: [
    { key: 'display_name', type: 'text', label: 'Name' },
    { key: 'executor_config', type: 'executor_profile', label: 'Executor' },
    { key: 'prompt_template', type: 'textarea', label: 'Prompt' },
    { key: 'input_bindings', type: 'variable_picker', label: 'Inputs' }
  ]
}
```

Then `WorkflowNodeInspector` becomes a generic renderer:

- read node type;
- load schema for that type;
- render matching field components;
- write changes back to `WorkflowNodeData`.

#### Why It Matters

User value:

- Agent Step can grow without making the inspector fragile.
- New node settings become faster to add.
- MCP/tool selectors, variable pickers and retry controls can share reusable field components.
- Validation can be derived from the same schema.
- The UI becomes closer to Circuit and Nodetool style node definitions.

Likely modules:

- new `workflowNodeSchemas.ts` or similar registry;
- `WorkflowNodeInspector.tsx`;
- `workflowNodeCatalog.ts`;
- validation helpers.

Acceptance:

- Existing Agent, Condition, Human Gate, Arena and Transform fields still render.
- Tests prove schema defaults and validation work.
- Playwright verifies users can edit the same fields as before.

### 3.3 P1: Insert Step On Edge

#### Problem

Dragging from a palette is not enough for a mature workflow builder. Users often
want to insert a new step into an existing route.

#### Target Behavior

1. User hovers a connection.
2. A midpoint `+` control appears.
3. User chooses a step type.
4. The original edge is split:

```ts
before:
  source -> target

after:
  source -> new_step -> target
```

#### Why It Matters

This is one of the fastest ways to make the canvas feel like Dify/n8n:

- fewer drag operations;
- fewer manual reconnections;
- the user builds from the path they are already looking at.

Acceptance:

- Playwright hovers an edge, clicks add, chooses Agent Step and verifies graph
  JSON has the inserted step and two replacement edges.

### 3.4 P1: Quick Add / Command Search

#### Problem

Power users do not want to keep moving to a palette and dragging nodes.

#### Target Behavior

- User opens command search from a shortcut or canvas action.
- User searches node types or templates.
- User adds a step at:
  - selected edge;
  - selected node;
  - viewport center;
  - cursor position.

#### Why It Matters

This matches developer habits and makes the workflow builder feel like a serious
productivity tool.

Acceptance:

- Playwright opens search, filters for Agent, selects it and verifies a node is
  added at a stable position.

### 3.5 P1: Runtime I/O And Prompt Debug Panel

#### Problem

The run canvas shows node execution state, but it does not yet provide enough
debugging depth. Users need to understand why an Agent Step produced a result.

#### Target Behavior

For a selected run step, show:

- raw node input;
- rendered prompt after variable interpolation;
- upstream outputs used by this step;
- final output;
- error;
- session ID;
- execution process ID;
- relevant process/log references.

#### Why It Matters

This is the coding-agent equivalent of Dify's variable inspector and LangGraph's
state inspection. It turns workflow runs from a black box into a debuggable
system.

Acceptance:

- Run canvas fixture displays selected Agent Step input, rendered prompt/output
  and session/process IDs.
- TypeScript check passes.

### 3.6 P1: Agent Step Conversation Surface Upgrade

#### Problem

The current Agent Step conversation panel is a useful start, but it is still a
summary surface. The product target is that every Agent Step feels like a real
session work unit inside the workflow.

#### Target Behavior

- Conversation tab embeds or closely mirrors existing session history.
- User can inspect turns for that node's `session_id`.
- "Open workspace" remains secondary.
- Later, continue/rerun actions can live here.

#### Why It Matters

The user's core expectation is:

> This Agent Step is a conversation/session that did part of the task.

The canvas should satisfy that expectation without navigating away to old
workspace mode.

Acceptance:

- Playwright double-clicks an Agent Step and stays on run canvas.
- Selected conversation panel shows the node's session history or a stable empty
  state tied to that session.
- No navigation to old workspace mode occurs.

## 4. Why The Current Canvas Feels Behind

### 4.1 It Is Still A Feature Skeleton

Current AI Workflow has the right primitives: templates, graph JSON, editor
canvas, run canvas, node execution status, and a right detail panel.

Mature products make the whole loop feel complete:

1. Start from issue context.
2. Choose or generate a useful workflow skeleton.
3. Configure each step.
4. Validate readiness.
5. Run the workflow.
6. Inspect every step's input, output and session.
7. Debug failed routes.
8. Rerun or continue from a step.
9. Save the working graph as a reusable template.

The current product has pieces of this loop, but the user can still feel seams
between editor, run page, workspace, session and dashboard.

### 4.2 Nodes Do Not Yet Feel Like Work Units

In Dify, n8n and Circuit, a node carries a clear product promise. The user can
tell what the node does, what it needs, what it produced, and what is wrong.

Agent Step should express:

- which executor this step uses;
- what prompt/template is rendered;
- which upstream outputs are injected;
- which session belongs to this step;
- which process is currently running;
- what the agent has produced;
- whether the node can be rerun, continued or opened in full workspace.

### 4.3 Edges Are Still Not Product Objects

Connections should explain:

- why this route exists;
- what data is passed;
- which branch condition it represents;
- whether this route was taken;
- whether a user can insert a step here.

Edges need wide hit areas, hover toolbars, midpoint insert controls, route
labels, status color and taken-path highlighting.

### 4.4 Runtime Debugging Is Still Too Shallow

AI Workflow needs a coding-agent debugging equivalent:

- step input preview before run;
- step output after run;
- upstream variable/reference inspector;
- rendered prompt preview;
- execution logs/process state;
- single-step rerun;
- continue session from a failed or incomplete step;
- clear distinction between design blockers and run blockers.

Without this, users can draw workflows but cannot confidently repair them.

### 4.5 Visual Polish Is Structural

The perceived gap to mature tools comes from many small details:

- stable node anatomy;
- status slots on nodes;
- hover toolbars;
- selection affordances;
- compact metadata chips;
- edge hover states;
- minimap and controls that match the surface;
- empty state that guides the first action;
- validation badges near the problem;
- keyboard and context-menu alternatives;
- no layout jumps during hover, drag or execution.

These are how users understand and trust a workflow editor.

## 5. Comparator Lessons

### 5.1 Circuit

Circuit is the closest domain reference for coding-agent workflows.

Borrow:

- coding-agent nodes as real execution units;
- schema-first node definitions;
- executor registry pattern;
- text output first, JSON output as an option;
- `{{NodeName.field.path}}` style references;
- checkpoint/replay;
- fresh/persist conversation mode as a future policy concept;
- streaming status on the node.

Adapt:

- Keep one run workspace/worktree instead of making every node a workspace.
- Use Vibe Kanban's existing session/process model instead of duplicating a new
  conversation object.

### 5.2 Nodetool

Nodetool is useful for schema-driven extensibility and long-term graph evolution.

Borrow:

- schema-driven node configuration;
- versioned graph handling;
- subgraph/template thinking;
- reusable field components for complex controls.

Adapt:

- Do not import a broad node marketplace mindset too early.
- Use the schema pattern to make Agent Step excellent before expanding the catalog.

### 5.3 LangGraph

LangGraph is useful as a debugging and state inspection reference.

Borrow:

- inspectable state at each step;
- checkpoint thinking;
- replay/rerun from a known state;
- timeline or trace view of a run.

Adapt:

- Do not replace the current workflow runner with LangGraph.
- Use the debugging concepts inside Vibe Kanban's existing runtime model.

### 5.4 Dify, n8n And Open Agent Builder

Borrow from Dify:

- variable/input/output inspector;
- edge midpoint add affordance;
- run readiness checklist with node navigation;
- candidate node preview before placement.

Borrow from n8n:

- edge toolbar and large interaction width;
- manual/partial execution mental model;
- execution data attached to node UI;
- pinned/mock data for debug-like flows.

Borrow from Open Agent Builder:

- builder plus preview split;
- agent config surface with model/tools/instructions;
- variables/data mapping as a visible product concept;
- templates as the default path.

## 6. Product Principles

### 6.1 Canvas First, But Not Canvas Only

The user should enter a design canvas before running. But the canvas must be
connected to detail panels, session history, execution trace and dashboard views.

Canvas answers:

- what will happen;
- where the run is now;
- which path was taken.

Detail/session surfaces answer:

- what this step received;
- what this agent did;
- what can be changed or rerun.

### 6.2 Agent Step Is The Core Product Object

Before adding many node types, Agent Step must be excellent.

Minimum Agent Step detail:

- name and responsibility;
- executor/profile/model;
- prompt template;
- rendered prompt preview;
- upstream input bindings;
- session list/history;
- current execution process;
- output and artifacts;
- retry/continue/open workspace actions.

### 6.3 Connections Must Carry Meaning

Every connection should have a semantic role:

- default sequence;
- condition branch;
- failure route;
- human approval route;
- arena winner route;
- data handoff.

The UI should show these as labels, colors and route-specific inspector fields.

### 6.4 Validation Should Be Guidance

Separate blockers:

- Design blocker: graph cannot be represented or saved.
- Run blocker: graph can be saved, but cannot execute yet.

Examples:

- "Workspace has no repositories configured" is a run blocker.
- Missing branch target is a run blocker and visible node/edge warning.
- Corrupt graph JSON is a design blocker.

### 6.5 Advanced Feel Comes From Workflow Speed

Optimize for how users build:

- start from template/skeleton;
- insert on an existing edge;
- append next step from selected node;
- search command to add node;
- drag from palette for power users;
- edit step detail without losing canvas context.

## 7. Target Product Loops

### 7.1 Design Loop

1. User opens an issue.
2. User clicks `Design workflow`.
3. Canvas opens with issue context attached.
4. If no workflow exists, show default skeleton:
   `Start -> Agent Step -> End`.
5. User chooses a template or edits the skeleton.
6. User configures Agent Step executor, prompt and inputs.
7. Checklist reports missing config.
8. User saves draft or runs.

### 7.2 Run Loop

1. User starts workflow.
2. Run canvas highlights active step and taken path.
3. Right panel shows selected step.
4. Agent Step panel shows session conversation and process state.
5. Human Gate exposes approve/reject/follow-up controls.
6. Arena Step exposes attempts and promotion decision.
7. Failure shows recovery actions near the failed step.

### 7.3 Debug Loop

1. User selects a failed or suspicious step.
2. Inspector shows rendered input, output, variables and logs.
3. User can copy/pin/mock step output.
4. User can rerun from this step or continue its session.
5. Downstream steps update from the new output.

### 7.4 Reuse Loop

1. User confirms workflow works.
2. User saves it as a named template.
3. Template keeps step configs, variable bindings and layout.
4. Future issues can start from that template.

## 8. Roadmap

### Phase A: Make The Current Workflow Understandable

Goal: users can explain what every node means.

Required:

- Agent Step detail uses session/conversation language.
- Double-click Agent Step opens node conversation/detail in the workflow view.
- Right panel exposes Conversation, Details, Input/Output and Execution.
- Workspace/session links are secondary, not the primary interaction.
- Run blockers and design blockers are separated in copy.

Status:

- Partially implemented. Node conversation panel exists, but full embedded
  session history is still needed.

### Phase B: Make The Canvas Reliable

Goal: graph data and visual connections remain stable.

Required:

- persisted edge handles;
- graph migration;
- four-direction handles with exact source/target handle persistence;
- reconnect behavior that preserves route meaning;
- condition branch routing that survives save/reload.

### Phase C: Make The Canvas Feel Like A Builder

Goal: users can build and edit workflows quickly.

Required:

- Issue -> Design Canvas entry.
- Default skeleton and template picker.
- Edge midpoint `+` insert step.
- Append next step from selected node.
- Right-click canvas add menu.
- Command search add step.
- Semantic edge inspector.
- Undo/redo for graph edits.
- Auto layout.

### Phase D: Make Debugging First-Class

Goal: users can diagnose and repair a run without leaving the workflow.

Required:

- Step input/output inspector.
- Rendered prompt preview.
- Variable/reference inspector.
- Execution trace by step.
- Taken-path highlight.
- Single-step rerun.
- Continue selected Agent Step session.
- Pin/mock output for downstream testing.
- Human Gate feedback and retry path.

### Phase E: Make Templates A Product Surface

Goal: users do not start from blank graphs.

Required:

- Template gallery.
- Starter templates:
  - Plan -> Implement -> Review
  - Human Review Gate
  - Arena Compare -> Promote
  - Bugfix With Reviewer
  - Docs / Refactor / Test Generation
- Save current workflow as template.
- Import/export workflow JSON.
- Template versioning and migration story.

### Phase F: Make It Feel Mature

Goal: the editor feels comparable to Dify/n8n in daily use.

Required:

- keyboard shortcuts;
- multi-select and bulk move/delete;
- copy/paste/duplicate;
- comments or sticky notes;
- groups/collapse for large workflows;
- zoom-safe node labels and controls;
- screenshot regression coverage;
- performance checks for large graphs;
- AI-assisted workflow generation from issue text.

## 9. Product Acceptance Checklist

### 9.1 Entry And Onboarding

- User can enter design canvas from an issue before running.
- First canvas state is not cold/blank.
- User can choose a starter template.
- User can save without satisfying all run blockers.
- Run blockers are explained before execution.

### 9.2 Agent Step

- Agent Step clearly shows executor/profile/model.
- Agent Step clearly shows prompt/template.
- Agent Step has an embedded session/conversation surface.
- Agent Step shows current process status.
- Agent Step shows input, output and error.
- Agent Step can link to full workspace as a secondary action.

### 9.3 Canvas Interaction

- User can drag nodes from palette.
- User can move nodes and persist layout.
- User can connect and reconnect edges.
- User can insert on an edge.
- User can append from a selected node.
- User can use right-click or command search to add a node.
- Handles and connection previews do not visually bend or jump unexpectedly.
- Existing lines have draggable endpoints.

### 9.4 Data And Debugging

- Each step has inspectable input/output.
- Rendered prompt can be previewed.
- Upstream output references are visible.
- Taken branches are highlighted.
- Failed step shows actionable recovery.
- User can rerun or continue from a step.
- Debug data can be pinned or mocked for downstream testing.

### 9.5 Visual Quality

- Nodes have stable anatomy and do not resize during hover.
- Edge labels and hit areas are easy to select.
- Minimap has a visible canvas surface.
- Status colors are meaningful and consistent.
- No instructional text clutters the primary canvas.
- Empty, loading, running, failed and completed states are all designed.
- Mobile/narrow layout does not overlap text or controls.

### 9.6 Verification

- Playwright covers drag/drop, move, connect, reconnect, insert-on-edge and node
  detail opening.
- Playwright covers run canvas node session panel.
- Playwright covers graph reload after handle migration.
- TypeScript check passes.
- Workflow e2e passes.
- Screenshot or visual regression checks cover core canvas states before release.

## 10. Implementation Guardrails

- Do not replace React Flow unless a specific technical blocker appears.
- Do not expand node types before Agent Step, Human Gate and Arena Step feel complete.
- Do not make each node a workspace.
- Do not make users run a workflow just to reach the design canvas.
- Do not hide workflow state behind links to old workspace mode.
- Do not treat output capture as a main user-facing Agent Step concept.
- Do not use long explanatory copy on the canvas surface.
- Keep node cards compact, token-driven and consistent with Vibe Kanban.
- Add tests for interaction behavior before product claims.
- Keep `Open workspace` as a secondary escape hatch, not the primary node interaction.

## 11. Reference Links

- n8n node and workflow execution docs:
  - https://docs.n8n.io/workflows/components/nodes/
  - https://docs.n8n.io/workflows/executions/manual-partial-and-production-executions/
- Dify workflow docs and variable inspection:
  - https://docs.dify.ai/
  - https://docs.dify.ai/versions/3-2-x/en/user-guide/workflow/debug-and-preview/variable-inspect
- OpenAI Agent Builder:
  - https://platform.openai.com/docs/guides/agent-builder
- Open Agent Builder:
  - https://github.com/firecrawl/open-agent-builder
- Local analysis:
  - `docs/future/ai-workflow/canvas-open-source-analysis-0511.md`
  - `docs/future/ai-workflow/spec-0512c.md`
  - `docs/future/ai-workflow/search-project/findings.md`
