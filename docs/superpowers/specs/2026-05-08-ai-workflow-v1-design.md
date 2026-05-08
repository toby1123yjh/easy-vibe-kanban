# AI Workflow V1 Design

> Status: Approved design draft
> Date: 2026-05-08
> Source: `docs/future/ai-workflow/spec.md`

## Goal

Build AI Workflow V1 as a product-complete workflow system for turning one
issue into a multi-agent execution graph. A workflow run is a single attempt to
solve an issue, but it is decomposed into smaller role-based node executions
such as planning, implementation, review, approval, transformation, branching,
and arena-style candidate selection.

V1 must include the full product loop:

- Issue detail entry point.
- System built-in and project-level workflow templates.
- React Flow template editor with drag-and-drop nodes and edge editing.
- Executable workflow runner.
- Run canvas plus full dashboard.
- Arena node fan-out with manual winner selection.

## Product Model

An issue remains the top-level work item. A workflow run is one implementation
attempt for that issue. Inside the run, each workflow node is a sub-task or
control step.

```text
Issue
  -> Workflow Run
    -> main workflow workspace / worktree
    -> node executions
      -> Agent session
      -> Human Gate
      -> Condition
      -> Transform
      -> Arena fan-out
```

Normal Agent nodes are role steps. They default to sharing the workflow run's
main workspace and worktree so code changes accumulate naturally across
planning, implementation, review, and fix stages.

Arena nodes are the exception. They create several independent workspaces and
worktrees, one per candidate attempt. The workflow pauses while the user reviews
the candidates. After the user manually selects a winner, the winner's output
and diff are applied back to the main workflow worktree and downstream nodes
continue.

## Scope

V1 includes these node types:

- Start
- End
- Agent
- Condition
- Human Gate
- Transform
- Arena

V1 includes these statuses:

```text
workflow_runs.status:
pending / running / awaiting_human / awaiting_arena / succeeded / failed / canceled

node_executions.status:
pending / running / awaiting_human / awaiting_arena / succeeded / failed / skipped
```

V1 does not include:

- Global user templates across projects.
- Arbitrary JavaScript sandbox transforms.
- Automatic LLM judging for Arena winners.
- Full checkpoint replay from arbitrary nodes.
- Conflict-free concurrent writes to the same main worktree.

## Templates

Workflow templates come from two sources:

- `system`: built-in templates, not directly editable.
- `project`: user-created or copied templates bound to a project.

System templates can be copied into a project and then edited. V1 should ship
with at least:

- `Plan -> Approve -> Implement -> Review`
- `Plan -> Arena -> Pick Winner -> Review`
- `Research -> Architect -> Implement -> Review -> Fix If Needed`

Agent nodes support both role templates and full customization. Built-in role
templates should include:

- Architect
- Researcher
- Implementer
- Reviewer
- Fixer
- Custom

Role templates prefill display name, prompt template, recommended executor
shape, and output guidance. They must not prevent users from editing prompt,
executor, variant, or node name.

## Data Model

Add three primary tables:

```text
workflows
workflow_runs
node_executions
```

`workflows` stores templates:

```text
id
source                 -- system | project
project_id nullable
name
description
graph_json
created_at
updated_at
```

`workflow_runs` stores a single execution attempt:

```text
id
workflow_id
issue_id
workspace_id           -- main workflow workspace
trigger_source         -- V1: manual
input_text
output_text
status
started_at
finished_at
error_text
```

`node_executions` stores per-node runtime state:

```text
id
run_id
node_id                -- React Flow node id
node_type
iteration              -- reserved for future loops
status
input_text
output_text
session_id             -- Agent node
arena_group_id         -- Arena node
tokens_used nullable
cost_estimate nullable
started_at
finished_at
error_text
```

All new table types and request/response types should be exported through
ts-rs. Generated TypeScript must be regenerated with `pnpm run generate-types`;
do not edit `shared/types.ts` manually.

## Graph Schema

`workflows.graph_json` is not free-form storage. The backend must validate:

- graph version
- supported node types
- supported edge types
- required node data fields
- one Start node
- at least one End node
- no unreachable executable nodes
- no cycles in V1

V1 graph:

```text
version: 1
nodes: start | end | agent | condition | human_gate | transform | arena
edges: default | condition_branch | approval | rejection | arena_winner
```

Agent node data:

```text
display_name
role_template_id nullable
executor_config
prompt_template
output_capture = last_message | full_text | diff_summary
```

Arena node data:

```text
display_name
attempts[]
prompt_template
promote_strategy = manual
apply_strategy = diff_apply
```

Condition node data:

```text
conditions[]
joiner = and | or
branches[]
```

Human Gate node data:

```text
prompt_to_human
required_action = approve | approve_or_reject
```

Transform node data:

```text
mode = template | regex_extract | truncate
template
```

V1 intentionally avoids arbitrary JavaScript transforms. Safe transform modes
cover the common text operations without introducing JS sandbox risk, Windows
build risk, timeout handling, or memory-limit complexity.

## Runner

Add a dedicated crate:

```text
crates/workflow/
```

The workflow crate owns graph validation, ready-node calculation, node handler
dispatch, and run state transitions. It should not own HTTP routing or UI
concerns.

The server crate owns routes and request/response types. Existing services,
local-deployment, workspace-manager, and executors continue to own workspace,
worktree, session, and process execution.

Runner startup:

1. Create or bind the workflow run's main workspace/worktree.
2. Initialize node executions.
3. Mark Start ready.
4. Run ready nodes through node handlers.
5. Persist each state transition.
6. Emit workflow events.
7. Recompute ready nodes after node completion.
8. Mark run complete when there are no runnable or awaiting nodes.

Node handlers:

- Start: output `workflow_runs.input_text`.
- Agent: render prompt from upstream outputs, start a session in the main
  workflow workspace, wait for completion, store final output.
- Condition: evaluate rules and mark non-selected branches skipped.
- Human Gate: mark node/run `awaiting_human` and wait for approve/reject API.
- Transform: run safe text transform.
- Arena: create arena group and attempts, mark node/run `awaiting_arena`, wait
  for manual winner selection.
- End: combine upstream outputs, write `workflow_runs.output_text`, mark run
  succeeded.

V1 should serialize writing Agent nodes on the main worktree. If a graph makes
multiple main-worktree Agent nodes ready at the same time, the runner should
run them one at a time and record a warning. Arena attempts can still run in
parallel because each attempt has its own workspace/worktree.

## Events

V1 event stream covers run and node state transitions rather than token-level
streaming:

```text
run_status
node_status
node_output
node_error
node_waiting_human
node_waiting_arena
```

Agent token streaming remains available inside the existing session/workspace
view. The workflow dashboard should link to session detail for complete logs.

## Recovery

After server restart:

- `awaiting_human` runs can continue through approve/reject.
- `awaiting_arena` runs can continue through winner selection.
- `running` nodes are conservatively marked failed/recoverable in V1.
- Completed `node_executions.input_text` and `output_text` remain available for
  dashboard replay and future checkpoint features.

## UI

### Issue Entry

Issue detail gets a primary workflow action:

```text
Run workflow
```

The dialog lets the user:

- choose a system or project template
- review/edit run input
- choose main repo and branch
- start the run

Default input is issue title plus issue description.

### Template Pages

Add project routes:

```text
/projects/:projectId/workflows
/projects/:projectId/workflows/:workflowId/edit
```

The template editor uses React Flow:

```text
left: node library
center: graph canvas
right: node inspector
top: Save / Validate / Run test
bottom: validation panel
```

Node library:

- Start
- End
- Agent
- Condition
- Human Gate
- Transform
- Arena

### Run Page

Add run route:

```text
/projects/:projectId/workflow-runs/:runId
```

The run page has two tabs:

- Canvas
- Dashboard

Canvas is read-only during a run. It shows node state colors, edge state, node
detail drawers, Human Gate approve/reject controls, and Arena open/pick-winner
links.

Dashboard includes seven sections:

1. Header: issue, workflow, run id, status.
2. Progress: step count, elapsed time, cancel action.
3. Steps Timeline: node status, duration, session link.
4. Selected Step Detail: input, output, error, approval controls.
5. Decisions Made: Condition results, Human Gate decisions, Arena winner.
6. Agent Contribution: executor summary with steps and duration; token fields
   can remain nullable.
7. Code Changes: link to main workflow workspace diff.

Template editing and run observation are separate pages. Users should not edit
a template inside an active run page.

## Arena Node

Arena node execution:

1. Render the Arena prompt from upstream outputs.
2. Create an arena group tied to the workflow node execution.
3. Spawn N arena attempts, each in its own workspace/worktree.
4. Mark node and run `awaiting_arena`.
5. Dashboard links to the Arena page.
6. User manually selects a winner.
7. Winner output and diff are applied back to the workflow main worktree.
8. Downstream workflow nodes continue.

Winner apply strategy:

```text
apply_strategy = diff_apply
```

V1 uses `git diff` from the winner workspace and attempts `git apply` in the
main workflow worktree. If apply succeeds, Arena node succeeds and stores the
winner's final output plus diff summary. If apply fails, Arena node and run
fail with a conflict message and link to the winner workspace.

Cherry-pick can be added later, but diff apply is more natural for Design Arena
and for attempts that do not create commits.

## API Surface

V1 routes should be local-only:

```text
GET    /api/local/v1/projects/{project_id}/workflows
POST   /api/local/v1/projects/{project_id}/workflows
GET    /api/local/v1/workflows/{workflow_id}
PUT    /api/local/v1/workflows/{workflow_id}
DELETE /api/local/v1/workflows/{workflow_id}
POST   /api/local/v1/workflows/{workflow_id}/trigger

GET    /api/local/v1/workflow-runs/{run_id}
POST   /api/local/v1/workflow-runs/{run_id}/cancel
GET    /api/local/v1/workflow-runs/{run_id}/events

POST   /api/local/v1/workflow-runs/{run_id}/nodes/{node_id}/retry
POST   /api/local/v1/workflow-runs/{run_id}/nodes/{node_id}/approve
POST   /api/local/v1/workflow-runs/{run_id}/nodes/{node_id}/reject
POST   /api/local/v1/workflow-runs/{run_id}/nodes/{node_id}/arena-winner
```

Electric fallback routes should be added for:

```text
workflows
workflow_runs
node_executions
```

## Error Handling

V1 errors are explicit:

- Agent node failure: run failed; downstream pending nodes skipped.
- Condition without matching branch: use default branch; without default, fail.
- Human reject: run failed. Rejection edge loops are V2.
- Transform failure: node failed.
- Arena all attempts failed: node failed.
- Arena diff apply conflict: node/run failed and dashboard links to winner
  workspace for manual recovery.
- Cancel run: stop running session if possible and mark run canceled.

Retry support in V1:

- failed Agent nodes
- failed Condition nodes
- failed Transform nodes

Human Gate is resumed with approve/reject. Arena is resumed with winner
selection. Arbitrary checkpoint replay is deferred.

## Implementation Stages

The implementation should be delivered in five stages:

1. Data model, graph schema, and built-in templates.
2. Template API, runner core, and workflow event stream.
3. React Flow template editor and project template save/load.
4. Issue entry point, run canvas, and dashboard.
5. Arena node fan-out, manual winner selection, and diff apply backfill.

Each stage should compile and include focused tests before moving to the next
stage.

## Test Strategy

Backend tests:

- graph schema validation
- ready-node calculation
- condition branching
- transform modes
- human gate pause/resume
- arena node creates group and awaits winner
- diff apply success and conflict handling

Frontend tests/checks:

- editor saves and reloads graph
- issue panel opens Run workflow
- run page renders Canvas and Dashboard
- approve/reject controls call correct API
- Arena links open the correct group

End-to-end acceptance:

1. Create an issue.
2. Choose a built-in workflow.
3. Start a run.
4. Run reaches Human Gate.
5. Approve.
6. Run reaches Arena.
7. Choose winner.
8. Run continues and completes.
9. Dashboard shows final status and code diff link.

## Risks

Primary risks:

- Runner lifecycle must integrate cleanly with existing workspace/session
  execution.
- Session completion detection must be reliable.
- Arena winner diff apply may conflict with the main workflow worktree.
- Service restart recovery for running nodes is intentionally conservative in
  V1 and must be visible in the UI.
- Full React Flow editing and full run dashboard are significant UI work; keep
  editor and run observation pages separate to control complexity.

