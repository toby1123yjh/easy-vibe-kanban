# AI Workflow Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P0/P1 productization capabilities from `docs/future/ai-workflow/spec-product.md`: stable edge handles, graph migration, schema-driven node configuration, insert-on-edge, quick add, runtime I/O debugging, and node-level Agent session surfaces.

**Architecture:** Keep React Flow as the canvas engine and keep the existing runtime decision: one Workflow Run has one shared workspace/worktree, each Agent Step has its own session/process. Add narrowly scoped model helpers first, then wire UI behavior, then upgrade run debugging. Avoid broad node catalog expansion and avoid replacing existing workspace/session APIs.

**Tech Stack:** React 18, TypeScript, `@xyflow/react`, Tailwind, Playwright workflow fixture, Rust workflow crate, SQLx-backed server routes, existing Vibe Kanban workspace/session components.

---

## Scope Check

This plan intentionally covers only the `spec-product.md` P0/P1 milestone. It excludes:

- ConditionAgent node.
- Full checkpoint/time-travel replay.
- Template marketplace.
- Visual regression infrastructure.
- Broad typed I/O system.
- Making every node a workspace.

Those are later specs/plans. This plan should produce working, testable product improvements on its own.

## File Structure

### Model And Migration

- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.ts`
  - Owns persisted graph shape, graph version, React Flow conversion, and migration entry point.
- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.test.ts`
  - Covers handle persistence and v1-to-v2 graph migration.
- Modify: `crates/workflow/src/graph.rs`
  - Adds optional persisted handle fields to backend graph edge structs while preserving old JSON compatibility.
- Modify: `crates/workflow/src/templates.rs`
  - Updates helper constructors to include default source/target handles where useful.
- Modify: `crates/workflow/src/validation.rs`
  - Keeps validation compatible with optional handles.
- Modify: `crates/workflow/src/planner.rs`
  - Should not need semantic behavior changes, but helper edge constructors in tests must compile.
- Modify: `crates/workflow/src/handlers.rs`
  - Should not need semantic behavior changes, but helper edge constructors in tests must compile.

### Canvas Editing

- Modify: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
  - Persists React Flow handles, renders insert-on-edge affordance, integrates quick add entry points.
- Create: `packages/web-core/src/features/workflow/ui/WorkflowQuickAdd.tsx`
  - Searchable node picker for command-style add.
- Create: `packages/web-core/src/features/workflow/ui/workflowEdgeInsert.ts`
  - Pure helper for splitting an edge when inserting a node.
- Modify: `tests/workflow/fixture/src/main.tsx`
  - Adds fixture hooks and stable output for handle reload, insert-on-edge, and quick add tests.
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`
  - Adds Playwright coverage for handles, insert-on-edge, quick add, and run debug panels.

### Node Configuration

- Create: `packages/web-core/src/features/workflow/model/workflowNodeSchemas.ts`
  - Defines schema metadata for node fields and reusable field types.
- Create: `packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts`
  - Covers schema lookup, defaults, and required fields.
- Create: `packages/web-core/src/features/workflow/ui/WorkflowNodeFieldRenderer.tsx`
  - Renders schema fields into controlled inputs.
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowNodeInspector.tsx`
  - Moves from node-type hardcoded forms toward schema-driven rendering while preserving complex list editors where still needed.
- Modify: `packages/web-core/src/features/workflow/model/workflowNodeCatalog.ts`
  - Reuses schema defaults where practical.

### Run Debugging And Agent Session Surface

- Modify: `packages/web-core/src/features/workflow/model/workflowRunView.ts`
  - Adds selectors for upstream outputs, selected node prompt template, and run debug rows.
- Modify: `packages/web-core/src/features/workflow/model/workflowRunView.test.ts`
  - Covers debug selectors.
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
  - Uses the new debug selectors and delegates conversation panel rendering.
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunDebugPanel.tsx`
  - Renders raw input, rendered prompt, upstream outputs, output/error, session/process metadata.
- Create: `packages/web-core/src/features/workflow/ui/WorkflowNodeSessionPanel.tsx`
  - Embeds or closely mirrors the existing session/conversation history for a node `session_id`.
- Modify: `tests/workflow/fixture/src/main.tsx`
  - Seeds run canvas fixture data for prompt rendering and node session panel states.

## Verification Commands

Use these commands throughout:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowGraph.test.ts --root packages/web-core --pool forks
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts --root packages/web-core --pool forks
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowRunView.test.ts --root packages/web-core --pool forks
pnpm run web-core:check
pnpm run workflow:e2e
cargo test -p workflow
git diff --check
```

Notes:

- On this Windows machine, full `pnpm run format` may fail if `cargo` is not installed. Still run `pnpm run web-core:format` for frontend-only edits and document any local toolchain blocker.
- Do not claim completion without fresh verification output.

## Task 1: Persist Edge Handles In The Graph Model

**Files:**
- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.ts`
- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.test.ts`
- Modify: `crates/workflow/src/graph.rs`
- Modify: `crates/workflow/src/templates.rs`
- Modify: `crates/workflow/src/validation.rs`
- Modify: `crates/workflow/src/planner.rs`
- Modify: `crates/workflow/src/handlers.rs`

- [ ] **Step 1: Write failing TypeScript tests for handle persistence**

Add tests to `packages/web-core/src/features/workflow/model/workflowGraph.test.ts`:

```ts
it('preserves edge handles through React Flow conversion', () => {
  const edge = createWorkflowEdge({
    id: 'condition-true',
    source: 'condition',
    source_handle: 'branch:true',
    target: 'agent',
    target_handle: 'input',
    type: 'condition_branch',
  });

  const flowEdges = toReactFlowEdges({
    version: WORKFLOW_GRAPH_VERSION,
    nodes: [],
    edges: [edge],
  });

  expect(flowEdges[0]).toMatchObject({
    sourceHandle: 'branch:true',
    targetHandle: 'input',
  });

  expect(fromReactFlowGraph([], flowEdges).edges[0]).toEqual(edge);
});
```

- [ ] **Step 2: Run the focused TypeScript test and verify RED**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowGraph.test.ts --root packages/web-core --pool forks
```

Expected: FAIL because `WorkflowEdge` and `createWorkflowEdge` do not accept `source_handle` / `target_handle`, or because conversion drops handles.

- [ ] **Step 3: Write failing Rust graph compatibility test**

Add to `crates/workflow/src/graph.rs` tests:

```rust
#[test]
fn parses_edges_with_optional_handles() {
    let graph: WorkflowGraph = serde_json::from_value(serde_json::json!({
        "version": 2,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            { "id": "agent", "type": "agent", "data": { "display_name": "Agent" } }
        ],
        "edges": [
            {
                "id": "e1",
                "source": "start",
                "source_handle": "output",
                "target": "agent",
                "target_handle": "input",
                "type": "default"
            }
        ]
    }))
    .unwrap();

    assert_eq!(graph.edges[0].source_handle.as_deref(), Some("output"));
    assert_eq!(graph.edges[0].target_handle.as_deref(), Some("input"));
}

#[test]
fn parses_legacy_edges_without_handles() {
    let graph: WorkflowGraph = serde_json::from_value(serde_json::json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "end", "type": "default" }
        ]
    }))
    .unwrap();

    assert_eq!(graph.edges[0].source_handle, None);
    assert_eq!(graph.edges[0].target_handle, None);
}
```

- [ ] **Step 4: Run the Rust graph test and verify RED**

Run:

```bash
cargo test -p workflow parses_edges_with_optional_handles parses_legacy_edges_without_handles
```

Expected: FAIL because `WorkflowEdge` has no handle fields.

- [ ] **Step 5: Implement TypeScript edge handle fields**

Update `packages/web-core/src/features/workflow/model/workflowGraph.ts`:

```ts
export const WORKFLOW_GRAPH_VERSION = 2;

export interface WorkflowEdge {
  id: string;
  source: string;
  source_handle?: string;
  target: string;
  target_handle?: string;
  type: WorkflowEdgeKind;
}
```

Update `createWorkflowEdge` to accept optional handles and default to `output` / `input` for new edges:

```ts
export function createWorkflowEdge(options: {
  id?: string;
  source: string;
  source_handle?: string;
  target: string;
  target_handle?: string;
  type?: WorkflowEdgeKind;
}): WorkflowEdge {
  return {
    id: options.id ?? `${options.source}-${options.target}`,
    source: options.source,
    source_handle: options.source_handle ?? 'output',
    target: options.target,
    target_handle: options.target_handle ?? 'input',
    type: options.type ?? 'default',
  };
}
```

Update `toReactFlowEdges`:

```ts
return graph.edges.map((edge) => ({
  id: edge.id,
  source: edge.source,
  sourceHandle: edge.source_handle,
  target: edge.target,
  targetHandle: edge.target_handle,
  type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
  data: { workflowType: edge.type },
  label: getWorkflowEdgeLabel(edge.type),
}));
```

Update `fromReactFlowGraph`:

```ts
return {
  id: edge.id,
  source: edge.source,
  source_handle: edge.sourceHandle ?? undefined,
  target: edge.target,
  target_handle: edge.targetHandle ?? undefined,
  type: getWorkflowTypeFromReactFlowEdge(edge),
};
```

- [ ] **Step 6: Implement Rust edge handle fields**

Update `crates/workflow/src/graph.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowEdge {
    pub id: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<String>,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<String>,
    #[serde(rename = "type")]
    pub kind: WorkflowEdgeKind,
}
```

Update helper constructors in `crates/workflow/src/templates.rs`, `validation.rs`, `planner.rs`, and `handlers.rs` tests:

```rust
WorkflowEdge {
    id: id.to_string(),
    source: source.to_string(),
    source_handle: Some("output".to_string()),
    target: target.to_string(),
    target_handle: Some("input".to_string()),
    kind,
}
```

For tests that intentionally verify legacy parsing, keep omitted fields in JSON.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowGraph.test.ts --root packages/web-core --pool forks
cargo test -p workflow parses_edges_with_optional_handles parses_legacy_edges_without_handles
```

Expected: PASS.

- [ ] **Step 8: Run broader workflow crate tests**

Run:

```bash
cargo test -p workflow
```

Expected: PASS. If local Rust toolchain is unavailable, record the blocker and run remote CI later.

- [ ] **Step 9: Commit**

```bash
git add packages/web-core/src/features/workflow/model/workflowGraph.ts packages/web-core/src/features/workflow/model/workflowGraph.test.ts crates/workflow/src/graph.rs crates/workflow/src/templates.rs crates/workflow/src/validation.rs crates/workflow/src/planner.rs crates/workflow/src/handlers.rs
git commit -m "feat(workflow): persist edge handles"
```

## Task 2: Add Graph Migration For Legacy Workflow JSON

**Files:**
- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.ts`
- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.test.ts`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowTemplateEditorPage.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`

- [ ] **Step 1: Write failing migration tests**

Add tests to `workflowGraph.test.ts`:

```ts
it('migrates legacy v1 graphs to v2 edge handles', () => {
  const graph = migrateWorkflowGraph({
    version: 1,
    nodes: [
      { id: 'start', type: 'start', data: { display_name: 'Start' } },
      { id: 'agent', type: 'agent', data: { display_name: 'Agent' } },
    ],
    edges: [
      { id: 'start-agent', source: 'start', target: 'agent', type: 'default' },
    ],
  });

  expect(graph.version).toBe(WORKFLOW_GRAPH_VERSION);
  expect(graph.edges[0]).toMatchObject({
    source_handle: 'output',
    target_handle: 'input',
  });
});

it('does not overwrite existing v2 handles', () => {
  const graph = migrateWorkflowGraph({
    version: 2,
    nodes: [],
    edges: [
      {
        id: 'a-b',
        source: 'a',
        source_handle: 'right',
        target: 'b',
        target_handle: 'left',
        type: 'default',
      },
    ],
  });

  expect(graph.edges[0].source_handle).toBe('right');
  expect(graph.edges[0].target_handle).toBe('left');
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowGraph.test.ts --root packages/web-core --pool forks
```

Expected: FAIL because `migrateWorkflowGraph` does not exist.

- [ ] **Step 3: Implement migration helper**

Add to `workflowGraph.ts`:

```ts
export function migrateWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  if (graph.version >= WORKFLOW_GRAPH_VERSION) {
    return graph;
  }

  return {
    ...graph,
    version: WORKFLOW_GRAPH_VERSION,
    edges: graph.edges.map((edge) => ({
      ...edge,
      source_handle: edge.source_handle ?? 'output',
      target_handle: edge.target_handle ?? 'input',
    })),
  };
}
```

If TypeScript complains because legacy objects do not have the new shape, introduce:

```ts
type LegacyWorkflowEdge = Omit<WorkflowEdge, 'source_handle' | 'target_handle'> &
  Partial<Pick<WorkflowEdge, 'source_handle' | 'target_handle'>>;

type LegacyWorkflowGraph = Omit<WorkflowGraph, 'edges'> & {
  edges: LegacyWorkflowEdge[];
};
```

Then accept `WorkflowGraph | LegacyWorkflowGraph`.

- [ ] **Step 4: Wire migration into graph parsing sites**

Update `WorkflowTemplateEditorPage.tsx` wherever graph JSON is parsed:

```ts
const parsed = JSON.parse(template.graph_json) as WorkflowGraph;
return migrateWorkflowGraph(parsed);
```

Update `WorkflowRunCanvasTab.tsx` `parseWorkflowGraph`:

```ts
const parsed = JSON.parse(graphJson) as WorkflowGraph;
if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
  return migrateWorkflowGraph(parsed);
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowGraph.test.ts --root packages/web-core --pool forks
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 6: Add Playwright fixture coverage for legacy graph load**

Modify `tests/workflow/fixture/src/main.tsx` to support:

```ts
const legacyGraphMode =
  new URLSearchParams(window.location.search).get('legacy') === '1';
```

When `legacy=1`, pass a graph with `version: 1` and no edge handles into `WorkflowCanvas`.

Add a `pre` output:

```tsx
<pre data-testid="graph-json">{JSON.stringify(graph, null, 2)}</pre>
```

This already exists in the fixture; ensure migration output can be read after initial render.

- [ ] **Step 7: Add Playwright test**

Add to `tests/workflow/specs/workflow-canvas.spec.ts`:

```ts
test('loads legacy workflow graphs and assigns default handles', async ({ page }) => {
  await page.goto('/?legacy=1');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges[0];
    })
    .toMatchObject({
      source_handle: 'output',
      target_handle: 'input',
    });
});
```

- [ ] **Step 8: Run workflow e2e**

Run:

```bash
pnpm run workflow:e2e
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/web-core/src/features/workflow/model/workflowGraph.ts packages/web-core/src/features/workflow/model/workflowGraph.test.ts packages/web-core/src/features/workflow/ui/WorkflowTemplateEditorPage.tsx packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx tests/workflow/fixture/src/main.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "feat(workflow): migrate legacy graph handles"
```

## Task 3: Persist Handles Through Canvas Connect And Reconnect

**Files:**
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
- Modify: `packages/web-core/src/features/workflow/model/workflowGraph.ts`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`

- [ ] **Step 1: Write failing Playwright test for new connections**

Extend the existing "connects workflow nodes by dragging between visible handles" test in `workflow-canvas.spec.ts`:

```ts
const graph = await readGraph(page);
const edge = graph.edges.find((edge) => edge.id === 'yes-no');
expect(edge).toMatchObject({
  source: 'yes',
  source_handle: 'output-right',
  target: 'no',
  target_handle: 'input-left',
});
```

Use the actual handle IDs from the implementation. Prefer stable names:

- `input-left`
- `input-top`
- `input-right`
- `input-bottom`
- `output-left`
- `output-top`
- `output-right`
- `output-bottom`

- [ ] **Step 2: Run e2e and verify RED**

Run:

```bash
pnpm run workflow:e2e
```

Expected: FAIL because graph JSON does not include handles.

- [ ] **Step 3: Render stable handle IDs on canvas nodes**

Update `WorkflowCanvas.tsx` node component handles:

```tsx
<Handle id="input-left" type="target" position={Position.Left} />
<Handle id="input-top" type="target" position={Position.Top} />
<Handle id="input-right" type="target" position={Position.Right} />
<Handle id="input-bottom" type="target" position={Position.Bottom} />

<Handle id="output-left" type="source" position={Position.Left} />
<Handle id="output-top" type="source" position={Position.Top} />
<Handle id="output-right" type="source" position={Position.Right} />
<Handle id="output-bottom" type="source" position={Position.Bottom} />
```

Keep visual styling subtle; handles can be visible on hover/selection if current design supports it. Preserve existing Playwright selectors like `.react-flow__handle-right.source` if tests depend on them.

- [ ] **Step 4: Preserve handles in `onConnect`**

Update `WorkflowCanvas.tsx` `onConnect`:

```ts
const onConnect = useCallback(
  (connection: Connection) => {
    if (readOnly) return;
    const next = addEdge(
      {
        ...connection,
        id:
          connection.source && connection.target
            ? `${connection.source}-${connection.target}`
            : undefined,
        type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
        sourceHandle: connection.sourceHandle ?? 'output-right',
        targetHandle: connection.targetHandle ?? 'input-left',
        data: { workflowType: 'default' },
      },
      edgesRef.current
    ) as ReactFlowEdge<ReactFlowWorkflowEdgeData>[];
    edgesRef.current = next;
    setEdges(next);
    reportChange(nodesRef.current, next);
  },
  [readOnly, reportChange, setEdges]
);
```

- [ ] **Step 5: Preserve handles in `onReconnect`**

Ensure `reconnectEdge` keeps `sourceHandle` / `targetHandle` from `newConnection`.
If React Flow already does this, no extra code is needed. Add a guard only if the failing test proves handles are dropped.

- [ ] **Step 6: Run e2e and verify GREEN**

Run:

```bash
pnpm run workflow:e2e
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "feat(workflow): preserve canvas connection handles"
```

## Task 4: Add Schema-Driven Node Configuration Registry

**Files:**
- Create: `packages/web-core/src/features/workflow/model/workflowNodeSchemas.ts`
- Create: `packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts`
- Modify: `packages/web-core/src/features/workflow/model/workflowNodeCatalog.ts`
- Modify: `packages/web-core/src/features/workflow/index.ts`

- [ ] **Step 1: Write failing schema registry tests**

Create `packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getWorkflowNodeSchema,
  getWorkflowNodeSchemaFields,
} from './workflowNodeSchemas';

describe('workflow node schemas', () => {
  it('defines editable fields for Agent Step', () => {
    expect(getWorkflowNodeSchemaFields('agent').map((field) => field.key)).toEqual([
      'display_name',
      'role_template_id',
      'prompt_template',
    ]);
  });

  it('marks prompt template as a multiline field', () => {
    expect(getWorkflowNodeSchema('agent').fields).toContainEqual(
      expect.objectContaining({
        key: 'prompt_template',
        type: 'textarea',
        label: 'Prompt Template',
      })
    );
  });
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts --root packages/web-core --pool forks
```

Expected: FAIL because `workflowNodeSchemas.ts` does not exist.

- [ ] **Step 3: Implement minimal schema registry**

Create `workflowNodeSchemas.ts`:

```ts
import type { WorkflowNodeData, WorkflowNodeKind } from './workflowGraph';

export type WorkflowNodeFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'condition_rules'
  | 'condition_branches'
  | 'arena_attempts';

export interface WorkflowNodeFieldSchema {
  key: keyof WorkflowNodeData;
  type: WorkflowNodeFieldType;
  label: string;
  options?: Array<{ label: string; value: string }>;
  rows?: number;
}

export interface WorkflowNodeSchema {
  type: WorkflowNodeKind;
  label: string;
  fields: WorkflowNodeFieldSchema[];
}

export const WORKFLOW_NODE_SCHEMAS: Record<WorkflowNodeKind, WorkflowNodeSchema> = {
  start: {
    type: 'start',
    label: 'Start Step',
    fields: [{ key: 'display_name', type: 'text', label: 'Display Name' }],
  },
  end: {
    type: 'end',
    label: 'End Step',
    fields: [{ key: 'display_name', type: 'text', label: 'Display Name' }],
  },
  agent: {
    type: 'agent',
    label: 'Agent Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      { key: 'role_template_id', type: 'text', label: 'Role Template ID' },
      { key: 'prompt_template', type: 'textarea', label: 'Prompt Template', rows: 4 },
    ],
  },
  condition: {
    type: 'condition',
    label: 'Condition Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      {
        key: 'joiner',
        type: 'select',
        label: 'Joiner',
        options: [
          { label: 'AND', value: 'and' },
          { label: 'OR', value: 'or' },
        ],
      },
      { key: 'conditions', type: 'condition_rules', label: 'Rules' },
      { key: 'branches', type: 'condition_branches', label: 'Branches' },
    ],
  },
  human_gate: {
    type: 'human_gate',
    label: 'Human Gate Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      { key: 'prompt_to_human', type: 'textarea', label: 'Prompt To Human', rows: 3 },
      {
        key: 'required_action',
        type: 'select',
        label: 'Required Action',
        options: [
          { label: 'Approve', value: 'approve' },
          { label: 'Approve or reject', value: 'approve_or_reject' },
        ],
      },
    ],
  },
  transform: {
    type: 'transform',
    label: 'Transform Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        options: [
          { label: 'Template', value: 'template' },
          { label: 'Regex extract', value: 'regex_extract' },
          { label: 'Truncate', value: 'truncate' },
        ],
      },
      { key: 'template', type: 'textarea', label: 'Template', rows: 3 },
    ],
  },
  arena: {
    type: 'arena',
    label: 'Arena Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      { key: 'attempts', type: 'arena_attempts', label: 'Attempts' },
    ],
  },
};

export function getWorkflowNodeSchema(type: WorkflowNodeKind): WorkflowNodeSchema {
  return WORKFLOW_NODE_SCHEMAS[type];
}

export function getWorkflowNodeSchemaFields(
  type: WorkflowNodeKind
): WorkflowNodeFieldSchema[] {
  return getWorkflowNodeSchema(type).fields;
}
```

- [ ] **Step 4: Export schema helpers**

Update `packages/web-core/src/features/workflow/index.ts`:

```ts
export * from './model/workflowNodeSchemas';
```

- [ ] **Step 5: Run schema tests and type check**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts --root packages/web-core --pool forks
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web-core/src/features/workflow/model/workflowNodeSchemas.ts packages/web-core/src/features/workflow/model/workflowNodeSchemas.test.ts packages/web-core/src/features/workflow/index.ts
git commit -m "feat(workflow): add node schema registry"
```

## Task 5: Refactor WorkflowNodeInspector To Use Schema Fields

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/WorkflowNodeFieldRenderer.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowNodeInspector.tsx`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`

- [ ] **Step 1: Add Playwright regression assertions before refactor**

Keep or add tests proving current behavior remains:

```ts
test('edits agent configuration through the node dialog', async ({ page }) => {
  await page.goto('/');

  await clickWorkflowNode(page, 'yes');
  const dialog = page.getByTestId('node-dialog');

  await dialog.getByLabel('Role Template ID').fill('planner');
  await dialog.getByLabel('Prompt Template').fill('Plan from {{input}}');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const node = graph.nodes.find((candidate) => candidate.id === 'yes') as
        | undefined
        | { data?: { role_template_id?: string; prompt_template?: string } };
      return node?.data;
    })
    .toMatchObject({
      role_template_id: 'planner',
      prompt_template: 'Plan from {{input}}',
    });
});
```

- [ ] **Step 2: Run e2e and verify test is meaningful**

Run:

```bash
pnpm run workflow:e2e
```

Expected: PASS before refactor. This is a characterization test; it protects behavior while changing internals.

- [ ] **Step 3: Create generic field renderer**

Create `WorkflowNodeFieldRenderer.tsx`:

```tsx
import type { WorkflowNodeData } from '../model/workflowGraph';
import type { WorkflowNodeFieldSchema } from '../model/workflowNodeSchemas';

interface WorkflowNodeFieldRendererProps {
  data: WorkflowNodeData;
  field: WorkflowNodeFieldSchema;
  inputClassName: string;
  readOnly?: boolean;
  onChange: (key: keyof WorkflowNodeData, value: unknown) => void;
}

export function WorkflowNodeFieldRenderer({
  data,
  field,
  inputClassName,
  readOnly,
  onChange,
}: WorkflowNodeFieldRendererProps) {
  if (field.type === 'textarea') {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-high">{field.label}</label>
        <textarea
          className={inputClassName}
          rows={field.rows ?? 3}
          value={String(data[field.key] ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
          disabled={readOnly}
        />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-high">{field.label}</label>
        <select
          className={inputClassName}
          value={String(data[field.key] ?? field.options?.[0]?.value ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
          disabled={readOnly}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type !== 'text') {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-high">{field.label}</label>
      <input
        type="text"
        className={inputClassName}
        value={String(data[field.key] ?? '')}
        onChange={(event) => onChange(field.key, event.target.value)}
        disabled={readOnly}
      />
    </div>
  );
}
```

- [ ] **Step 4: Refactor simple fields in `WorkflowNodeInspector`**

In `WorkflowNodeInspector.tsx`:

- Import `getWorkflowNodeSchemaFields`.
- Import `WorkflowNodeFieldRenderer`.
- Keep complex list editors for condition rules, branches and arena attempts in the inspector for now.
- Replace duplicated text/textarea/select blocks with schema field rendering.

Pattern:

```tsx
const schemaFields = getWorkflowNodeSchemaFields(type);
const simpleFields = schemaFields.filter(
  (field) =>
    field.type === 'text' || field.type === 'textarea' || field.type === 'select'
);

{simpleFields.map((field) => (
  <WorkflowNodeFieldRenderer
    key={String(field.key)}
    data={data}
    field={field}
    inputClassName={inputClass}
    readOnly={readOnly}
    onChange={handleChange}
  />
))}
```

Keep condition/arena custom editors under checks based on schema field types:

```tsx
const hasConditionRules = schemaFields.some((field) => field.type === 'condition_rules');
```

- [ ] **Step 5: Run e2e and type check**

Run:

```bash
pnpm run workflow:e2e
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowNodeFieldRenderer.tsx packages/web-core/src/features/workflow/ui/WorkflowNodeInspector.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "refactor(workflow): render node inspector from schema"
```

## Task 6: Add Insert-On-Edge Helper And UI

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/workflowEdgeInsert.ts`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`

- [ ] **Step 1: Write failing pure helper test if a test runner is available**

If adding a UI helper test is practical, create `packages/web-core/src/features/workflow/ui/workflowEdgeInsert.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { insertWorkflowNodeOnEdge } from './workflowEdgeInsert';

describe('insertWorkflowNodeOnEdge', () => {
  it('splits an existing edge around the inserted node', () => {
    const result = insertWorkflowNodeOnEdge({
      edge: {
        id: 'start-end',
        source: 'start',
        sourceHandle: 'output-right',
        target: 'end',
        targetHandle: 'input-left',
        type: 'workflow',
        data: { workflowType: 'default' },
      },
      nodeId: 'agent-1',
    });

    expect(result.map((edge) => edge.id)).toEqual([
      'start-agent-1',
      'agent-1-end',
    ]);
  });
});
```

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/ui/workflowEdgeInsert.test.ts --root packages/web-core --pool forks
```

Expected: FAIL because helper does not exist.

- [ ] **Step 2: Write failing Playwright test**

Add to `workflow-canvas.spec.ts`:

```ts
test('inserts a workflow node from an edge midpoint action', async ({ page }) => {
  await page.goto('/');
  await waitForWorkflowNodeVisible(page, 'start');
  await expect(page.getByTestId('workflow-edge-start-condition')).toBeAttached();

  await page.getByTestId('workflow-edge-insert-start-condition').click();
  await page.getByRole('menuitem', { name: 'Agent Step' }).click();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return {
        nodeCount: graph.nodes.length,
        hasInsertedAgent: graph.nodes.some((node) => node.id.startsWith('agent-')),
        hasOriginalEdge: graph.edges.some((edge) => edge.id === 'start-condition'),
      };
    })
    .toEqual({
      nodeCount: 6,
      hasInsertedAgent: true,
      hasOriginalEdge: false,
    });
});
```

Expected initially: FAIL because no insert button exists.

- [ ] **Step 3: Implement edge split helper**

Create `workflowEdgeInsert.ts`:

```ts
import type { Edge as ReactFlowEdge } from '@xyflow/react';
import {
  WORKFLOW_REACT_FLOW_EDGE_TYPE,
  type ReactFlowWorkflowEdgeData,
} from '../model/workflowGraph';

export function splitWorkflowEdgeForInsertedNode({
  edge,
  nodeId,
}: {
  edge: ReactFlowEdge<ReactFlowWorkflowEdgeData>;
  nodeId: string;
}): ReactFlowEdge<ReactFlowWorkflowEdgeData>[] {
  const workflowType = edge.data?.workflowType ?? 'default';
  return [
    {
      id: `${edge.source}-${nodeId}`,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: nodeId,
      targetHandle: 'input-left',
      type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
      data: { workflowType },
    },
    {
      id: `${nodeId}-${edge.target}`,
      source: nodeId,
      sourceHandle: 'output-right',
      target: edge.target,
      targetHandle: edge.targetHandle,
      type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
      data: { workflowType: 'default' },
    },
  ];
}
```

- [ ] **Step 4: Render midpoint insert control in custom edge**

In `WorkflowCanvas.tsx`, extend the custom edge component to render a button near label coordinates:

```tsx
<button
  type="button"
  data-testid={`workflow-edge-insert-${id}`}
  className="nodrag nopan pointer-events-auto rounded-full border border-secondary bg-panel px-2 py-1 text-xs text-high shadow-sm hover:border-brand"
  style={{
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
  }}
  onClick={(event) => {
    event.stopPropagation();
    data?.onInsert?.(id);
  }}
>
  +
</button>
```

If edge data cannot carry callbacks cleanly, add a `selectedEdgeInsertId` state in `WorkflowCanvas` and use a small absolutely positioned overlay inside `EdgeLabelRenderer`.

- [ ] **Step 5: Wire insert action to add an Agent Step**

For the first implementation, keep the menu minimal:

- click midpoint `+`;
- show a small menu with `Agent Step`;
- choose `Agent Step`;
- create node using `createWorkflowNode('agent', { position })`;
- replace selected edge with split edges;
- call `reportChange`.

Do not add full node picker yet; Quick Add handles broader search in Task 7.

- [ ] **Step 6: Run helper test, e2e, and type check**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/ui/workflowEdgeInsert.test.ts --root packages/web-core --pool forks
pnpm run workflow:e2e
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/workflowEdgeInsert.ts packages/web-core/src/features/workflow/ui/workflowEdgeInsert.test.ts packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "feat(workflow): insert steps from edges"
```

## Task 7: Add Quick Add / Command Search

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/WorkflowQuickAdd.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`

- [ ] **Step 1: Write failing Playwright test**

Add to `workflow-canvas.spec.ts`:

```ts
test('adds a workflow node from quick add search', async ({ page }) => {
  await page.goto('/');

  const before = await readGraph(page);
  await page.keyboard.press('ControlOrMeta+K');
  await page.getByRole('dialog', { name: 'Add workflow step' }).getByRole('textbox').fill('agent');
  await page.getByRole('option', { name: 'Agent Step' }).click();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);
});
```

Expected: FAIL because quick add does not exist.

- [ ] **Step 2: Implement `WorkflowQuickAdd`**

Create `WorkflowQuickAdd.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { WorkflowNodeKind } from '../model/workflowGraph';
import { WORKFLOW_NODE_CATALOG } from '../model/workflowNodeCatalog';

export function WorkflowQuickAdd({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (type: WorkflowNodeKind) => void;
}) {
  const [query, setQuery] = useState('');
  const options = useMemo(
    () =>
      WORKFLOW_NODE_CATALOG.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Add workflow step"
      className="absolute left-1/2 top-20 z-50 w-80 -translate-x-1/2 rounded-md border border-secondary bg-panel p-2 shadow-lg"
    >
      <input
        autoFocus
        className="w-full rounded border border-secondary bg-primary px-3 py-2 text-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        placeholder="Search steps"
      />
      <div role="listbox" className="mt-2 max-h-64 overflow-auto">
        {options.map((item) => (
          <button
            key={item.type}
            type="button"
            role="option"
            aria-selected={false}
            className="block w-full rounded px-3 py-2 text-left text-sm text-high hover:bg-secondary"
            onClick={() => onSelect(item.type)}
          >
            {item.label} Step
          </button>
        ))}
      </div>
    </div>
  );
}
```

If `cmdk` is already preferred by local patterns, use it. Keep the first pass minimal and testable.

- [ ] **Step 3: Wire quick add into `WorkflowCanvas`**

In `WorkflowCanvas.tsx`:

- Add `quickAddOpen` state.
- Add `onKeyDown` handler on wrapper div.
- Set wrapper `tabIndex={0}` so keyboard events work after canvas focus.
- On select, create node at viewport center using `screenToFlowPosition`.

Pattern:

```tsx
const [quickAddOpen, setQuickAddOpen] = useState(false);

const addNodeAtViewportCenter = useCallback((kind: WorkflowNodeKind) => {
  const node = createWorkflowNode(kind, {
    position: screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }),
  });
  const nextNodes = [...nodesRef.current, toReactFlowNodes({ version: WORKFLOW_GRAPH_VERSION, nodes: [node], edges: [] })[0]];
  nodesRef.current = nextNodes;
  setNodes(nextNodes);
  reportChange(nextNodes, edgesRef.current);
}, [reportChange, screenToFlowPosition, setNodes]);
```

Prefer reusing existing node conversion helpers instead of manually constructing a React Flow node.

- [ ] **Step 4: Run e2e and type check**

Run:

```bash
pnpm run workflow:e2e
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowQuickAdd.tsx packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "feat(workflow): add quick step search"
```

## Task 8: Add Runtime I/O And Prompt Debug Selectors

**Files:**
- Modify: `packages/web-core/src/features/workflow/model/workflowRunView.ts`
- Modify: `packages/web-core/src/features/workflow/model/workflowRunView.test.ts`
- Create: `packages/web-core/src/features/workflow/ui/WorkflowRunDebugPanel.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
- Modify: `tests/workflow/fixture/src/main.tsx`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`

- [ ] **Step 1: Write failing selector test**

Add to `workflowRunView.test.ts`:

```ts
import { buildWorkflowNodeDebugView } from './workflowRunView';

it('builds debug data for a selected run node', () => {
  const debug = buildWorkflowNodeDebugView({
    run: runFixture,
    graph: {
      version: 2,
      nodes: [
        { id: 'plan', type: 'agent', data: { prompt_template: 'Plan {{input}}' } },
        { id: 'review', type: 'agent', data: { prompt_template: 'Review {{upstream}}' } },
      ],
      edges: [
        {
          id: 'plan-review',
          source: 'plan',
          source_handle: 'output',
          target: 'review',
          target_handle: 'input',
          type: 'default',
        },
      ],
    },
    nodeId: 'review',
  });

  expect(debug).toMatchObject({
    nodeId: 'review',
    promptTemplate: 'Review {{upstream}}',
    upstreamOutputs: [{ nodeId: 'plan', outputText: 'plan result' }],
  });
});
```

Create local fixtures in the test file. Do not depend on network.

- [ ] **Step 2: Run selector test and verify RED**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowRunView.test.ts --root packages/web-core --pool forks
```

Expected: FAIL because `buildWorkflowNodeDebugView` does not exist.

- [ ] **Step 3: Implement debug selector**

Add to `workflowRunView.ts`:

```ts
export interface WorkflowNodeDebugView {
  nodeId: string;
  promptTemplate: string | null;
  renderedPrompt: string | null;
  rawInput: string | null;
  outputText: string | null;
  errorText: string | null;
  sessionId: string | null;
  executionProcessId: string | null;
  upstreamOutputs: Array<{ nodeId: string; outputText: string }>;
}

export function buildWorkflowNodeDebugView({
  graph,
  nodeId,
  run,
}: {
  graph: WorkflowGraph;
  nodeId: string;
  run: WorkflowRunResponse;
}): WorkflowNodeDebugView | null {
  const graphNode = graph.nodes.find((node) => node.id === nodeId);
  const execution = run.nodes.find((node) => node.node_id === nodeId);
  if (!graphNode || !execution) return null;

  const upstreamOutputs = graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => {
      const upstream = run.nodes.find((candidate) => candidate.node_id === edge.source);
      return upstream?.output_text
        ? { nodeId: edge.source, outputText: upstream.output_text }
        : null;
    })
    .filter((item): item is { nodeId: string; outputText: string } => Boolean(item));

  return {
    nodeId,
    promptTemplate: graphNode.data.prompt_template ?? null,
    renderedPrompt: execution.input_text,
    rawInput: run.input_text,
    outputText: execution.output_text,
    errorText: execution.error_text,
    sessionId: execution.session_id,
    executionProcessId: execution.execution_process_id,
    upstreamOutputs,
  };
}
```

Use existing generated type property names from `shared/types`.

- [ ] **Step 4: Add debug panel component**

Create `WorkflowRunDebugPanel.tsx`:

```tsx
import type { WorkflowNodeDebugView } from '../model/workflowRunView';
import { cn } from '@/shared/lib/utils';

export function WorkflowRunDebugPanel({
  debug,
}: {
  debug: WorkflowNodeDebugView | null;
}) {
  if (!debug) {
    return <div className="text-sm text-low">No debug data for this step.</div>;
  }

  return (
    <div data-testid="workflow-node-debug-panel" className="space-y-base">
      <DebugBlock title="Run Input" value={debug.rawInput} />
      <DebugBlock title="Prompt Template" value={debug.promptTemplate} />
      <DebugBlock title="Rendered Prompt" value={debug.renderedPrompt} />
      <div>
        <h3 className="mb-half text-xs font-semibold uppercase text-low">
          Upstream Outputs
        </h3>
        <div className="space-y-half">
          {debug.upstreamOutputs.length === 0 ? (
            <p className="text-xs text-low">No upstream output.</p>
          ) : (
            debug.upstreamOutputs.map((output) => (
              <DebugBlock
                key={output.nodeId}
                title={output.nodeId}
                value={output.outputText}
              />
            ))
          )}
        </div>
      </div>
      <DebugBlock title="Output" value={debug.outputText} />
      {debug.errorText ? <DebugBlock title="Error" value={debug.errorText} tone="danger" /> : null}
      <DebugBlock title="Session ID" value={debug.sessionId} />
      <DebugBlock title="Process ID" value={debug.executionProcessId} />
    </div>
  );
}

function DebugBlock({
  title,
  value,
  tone = 'normal',
}: {
  title: string;
  value: string | null;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div>
      <h3
        className={cn(
          'mb-half text-xs font-semibold uppercase',
          tone === 'danger' ? 'text-error' : 'text-low'
        )}
      >
        {title}
      </h3>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap rounded border p-half text-xs',
          tone === 'danger'
            ? 'border-error/50 bg-error/10 text-error'
            : 'border-secondary bg-primary text-high'
        )}
      >
        {value || `No ${title.toLowerCase()}.`}
      </pre>
    </div>
  );
}
```

- [ ] **Step 5: Wire debug panel into run canvas**

In `WorkflowRunCanvasTab.tsx`:

- Import `buildWorkflowNodeDebugView`.
- Import `WorkflowRunDebugPanel`.
- Build debug view when `activeTab === 'io'`.
- Replace or extend `NodeInputOutputTab` with `WorkflowRunDebugPanel`.

Pattern:

```tsx
const debugView =
  graph && selectedNodeId
    ? buildWorkflowNodeDebugView({ graph, run, nodeId: selectedNodeId })
    : null;
```

Pass `debugView` into `NodeDetailPanel`.

- [ ] **Step 6: Add Playwright assertions**

Update run canvas fixture in `tests/workflow/fixture/src/main.tsx` so the `yes` node prompt template contains a variable:

```ts
data: {
  display_name: 'Yes path',
  role_template_id: 'reviewer',
  prompt_template: 'Review {{input}} and {{upstream}}',
}
```

Add test:

```ts
test('shows runtime input output and rendered prompt for a run node', async ({ page }) => {
  await page.goto('/?mode=run-canvas');

  await doubleClickWorkflowRunNode(page, 'yes');
  await page.getByRole('tab', { name: 'Input / Output' }).click();

  const panel = page.getByTestId('workflow-node-debug-panel');
  await expect(panel).toContainText('Rendered Prompt');
  await expect(panel).toContainText('input');
  await expect(panel).toContainText('done');
  await expect(panel).toContainText('session-agent');
  await expect(panel).toContainText('process-agent');
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm dlx vitest run packages/web-core/src/features/workflow/model/workflowRunView.test.ts --root packages/web-core --pool forks
pnpm run workflow:e2e
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web-core/src/features/workflow/model/workflowRunView.ts packages/web-core/src/features/workflow/model/workflowRunView.test.ts packages/web-core/src/features/workflow/ui/WorkflowRunDebugPanel.tsx packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx tests/workflow/fixture/src/main.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "feat(workflow): show run node debug data"
```

## Task 9: Upgrade Agent Step Conversation Surface

**Files:**
- Create: `packages/web-core/src/features/workflow/ui/WorkflowNodeSessionPanel.tsx`
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx`
- Modify: `tests/workflow/fixture/src/main.tsx`
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`

- [ ] **Step 1: Write failing Playwright test for stable session surface**

Add to `workflow-canvas.spec.ts`:

```ts
test('keeps an agent step session surface inside the run canvas', async ({ page }) => {
  await page.goto('/?mode=run-canvas');

  await doubleClickWorkflowRunNode(page, 'yes');

  const panel = page.getByTestId('workflow-node-session-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('session-agent');
  await expect(panel).toContainText('process-agent');
  await expect(page).toHaveURL(/\/\?mode=run-canvas$/);
});
```

Expected: FAIL if the new test id does not exist.

- [ ] **Step 2: Create `WorkflowNodeSessionPanel` shell**

Start with a shell that closely mirrors session state. Do not over-integrate the full chat stack until the fixture can support required providers.

```tsx
import type { WorkflowNodeExecutionResponse } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';

export function WorkflowNodeSessionPanel({
  execution,
  sessionHref,
}: {
  execution: WorkflowNodeExecutionResponse;
  sessionHref: string | null;
}) {
  return (
    <div data-testid="workflow-node-session-panel" className="space-y-base">
      <div className="rounded border border-secondary bg-primary p-half">
        <h3 className="text-sm font-semibold text-high">Agent Session</h3>
        <p className="mt-1 break-all text-xs text-low">
          Session: {execution.session_id ?? 'Not started'}
        </p>
        <p className="break-all text-xs text-low">
          Process: {execution.execution_process_id ?? 'Not started'}
        </p>
        {sessionHref ? (
          <Button asChild size="xs" variant="outline">
            <a href={sessionHref}>Open workspace</a>
          </Button>
        ) : null}
      </div>
      <div className="rounded border border-secondary bg-primary p-half">
        <h3 className="text-xs font-semibold uppercase text-low">Conversation</h3>
        <pre className="mt-half whitespace-pre-wrap text-xs text-high">
          {execution.output_text || 'No agent response has been captured yet.'}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace inline conversation card in `WorkflowRunCanvasTab`**

Use `WorkflowNodeSessionPanel` in the Conversation tab. Keep the current `WorkflowNodeConversationPanel` only if it is simplified to delegate to the new component.

- [ ] **Step 4: Run e2e and type check**

Run:

```bash
pnpm run workflow:e2e
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 5: Optional full chat embedding spike**

If time remains and providers can be satisfied, create a follow-up branch/commit to embed existing components:

- `ConversationList` from `packages/web-core/src/features/workspace-chat/ui/ConversationListContainer.tsx`
- `SessionChatBoxContainer` from `packages/web-core/src/features/workspace-chat/ui/SessionChatBoxContainer.tsx`
- Providers used in `packages/web-core/src/features/arena/ui/ArenaConversationPane.tsx`

Do not block this milestone on full chat embedding. The milestone requirement is a stable node-level session surface inside the run canvas.

- [ ] **Step 6: Commit**

```bash
git add packages/web-core/src/features/workflow/ui/WorkflowNodeSessionPanel.tsx packages/web-core/src/features/workflow/ui/WorkflowRunCanvasTab.tsx tests/workflow/specs/workflow-canvas.spec.ts
git commit -m "feat(workflow): add node session surface"
```

## Task 10: Final Verification And Documentation Sync

**Files:**
- Modify: `docs/future/ai-workflow/spec-product.md` only if implementation reveals a spec correction.
- Modify: `docs/superpowers/plans/2026-05-14-ai-workflow-productization.md` only for checklist status.

- [ ] **Step 1: Run frontend format**

Run:

```bash
pnpm run web-core:format
```

Expected: PASS.

- [ ] **Step 2: Run frontend type check**

Run:

```bash
pnpm run web-core:check
```

Expected: PASS.

- [ ] **Step 3: Run workflow e2e**

Run:

```bash
pnpm run workflow:e2e
```

Expected: PASS, including new handle, insert-on-edge, quick add, debug panel, and session panel tests.

- [ ] **Step 4: Run backend workflow tests**

Run:

```bash
cargo test -p workflow
```

Expected: PASS. If local cargo is unavailable, document blocker and run GitHub Actions before release.

- [ ] **Step 5: Run full format if toolchain allows**

Run:

```bash
pnpm run format
```

Expected: PASS. If local cargo is unavailable, record the exact failure and keep `pnpm run web-core:format` evidence.

- [ ] **Step 6: Run diff check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Update spec status notes**

If all tasks are complete, update `docs/future/ai-workflow/spec-product.md` current status to mention:

- edge handles persisted;
- graph migration exists;
- schema-driven inspector baseline exists;
- insert-on-edge exists;
- quick add exists;
- runtime debug panel exists;
- node session surface exists.

Do not mark future features complete.

- [ ] **Step 8: Final commit**

```bash
git add docs/future/ai-workflow/spec-product.md docs/superpowers/plans/2026-05-14-ai-workflow-productization.md
git commit -m "docs(workflow): update productization plan status"
```

## Implementation Order Summary

1. Task 1: edge handles in graph model.
2. Task 2: graph migration.
3. Task 3: canvas connect/reconnect handle persistence.
4. Task 4: schema registry.
5. Task 5: schema-driven inspector refactor.
6. Task 6: insert-on-edge.
7. Task 7: quick add.
8. Task 8: runtime I/O and prompt debug panel.
9. Task 9: node session surface.
10. Task 10: final verification and docs sync.

This order is intentional. Do not implement insert-on-edge before handle
persistence and migration are stable.
