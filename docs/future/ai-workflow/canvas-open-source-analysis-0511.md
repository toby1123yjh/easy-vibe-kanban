# AI Workflow Canvas Open Source Analysis 0511

Status: analysis complete, ready for P1 design approval
Date: 2026-05-11
Branch: `feat/ai-workflow-v1`
Focus: canvas visual polish and authoring interaction depth, not new node types.

## Research Snapshot

The analysis below is based on local sparse clones outside this repository.

| Project | Revision | Key files inspected |
|---|---:|---|
| n8n | `9072ee3beb1789f34008cb0f85f361dcac8cae26` | `packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/*` |
| Dify | `59dab7deac1810dd42816cc52450fb2faba0fb2f` | `web/app/components/workflow/*`, `nodes/_base/*`, `block-selector/*` |
| Flowise Agentflow | `a82edce8aeb7fa650ff35780df5dcbd7548f8446` | `packages/agentflow/src/Agentflow.tsx`, `features/canvas/*`, `core/theme/tokens.ts` |
| Circuit | `a20cbf059bbd739c0b7e2e7cd1d7e90f93091db8` | `frontend/src/components/*`, `frontend/src/stores/workflowStore.ts`, `backend/src/schemas/*` |
| Open Agent Builder | `be856e57f8126e90915c898f473dc94fbaefc945` | `components/app/(home)/sections/workflow-builder/*`, `lib/workflow/templates/examples/*` |
| ComfyUI Frontend | `02e1ba29689c6ff957881615029504c0d3d31753` | `src/renderer/extensions/vueNodes/*`, `src/services/nodeSearchService.ts`, `src/stores/workspace/searchBoxStore.ts` |

## Main Conclusion

The current React Flow direction is still valid. The issue is not the canvas engine. The issue is that our current `WorkflowCanvas.tsx` still renders nodes and edges as basic cards, while mature workflow products put a large amount of product quality into canvas micro-interactions:

- node anatomy with icon, title, status, summary, metadata, warning and output hints;
- left-to-right flow handles with visible hover affordances;
- edge labels, edge hover toolbars, wide hit areas and route coloring;
- validation/checklist surfacing directly on nodes and in the editor header;
- quick add, insert-on-edge and contextual node actions;
- comments/sticky notes and run-state overlays;
- consistent canvas tokens for background, minimap, controls, selection, hover and disabled states.

So the next phase should be a canvas quality pass. Node type expansion can wait.

## Code-Level Evidence

The key open-source lesson is that "advanced" workflow editors rarely depend on
large new graph semantics first. They usually ship richer presentation around the
same graph model.

| Project | Code evidence | Product lesson |
|---|---|---|
| n8n | `CanvasEdge.vue` uses segmented `BaseEdge`, `interaction-width="40"`, edge labels and `CanvasEdgeToolbar`; `CanvasNodeDefault.vue` composes status classes, zoom-adjusted sizing and status icons | Wide hit targets, hover toolbars and zoom-safe node chrome are core primitives, not polish-only CSS |
| Dify | `custom-edge.tsx` mounts `BlockSelector` at the edge midpoint; `header/checklist/index.tsx` groups warnings and selects the related node; `nodes/_base/components/node-handle.tsx` can open block selection from handles | Authoring speed comes from placing add/fix actions exactly where the user's attention already is |
| Flowise | `AgentFlowNode.tsx` centralizes status, validation and toolbar overlays; `NodeOutputHandles.tsx` measures node height with `ResizeObserver`; `AgentFlowEdge.tsx` draws a transparent selector path before the visible gradient edge | React Flow can feel professional when node/edge hit areas and state overlays are custom-owned |
| Circuit | `BaseNode.tsx` puts status rings, badges and left/right handles into the node shell; `GenericNode.tsx` renders condition/approval previews from schema/config; `workflowStore.ts` serializes React Flow back to workflow data | Our domain needs config summaries and approval/condition branch hints more than many new node categories |
| Open Agent Builder | `WorkflowBuilder.tsx` has BFS-style auto layout, edge click/double-click handlers, 20px edge interaction width, preview/execution panels; `VariableReferencePicker.tsx` and `ConnectionMapperModal.tsx` model data flow authoring | Later stages should add variable mapping and run preview, but P1 can borrow layout/control placement now |
| ComfyUI Frontend | `LGraphNode.vue` handles collapsed/bypassed/muted visual modes; `NodeHeader.vue` supports collapse, rename and status badges; `nodeSearchService.ts` uses Fuse search with aliases and typed filters | Dense pro tools expose compact badges, typed sockets and command search instead of long explanatory UI |

## What Makes A Canvas Feel Advanced

The visual upgrade is not one big effect. It is the sum of many small,
consistent signals:

- Nodes should have a stable anatomy: accent rail, icon, title, type label,
  config summary, metadata chips and status/warning slot.
- Handles should explain graph direction. For this product, left input and right
  output read better than top/bottom because most workflow products and coding
  agent processes are sequential.
- Edges need their own component. A default smoothstep path with a label is not
  enough; mature editors use wide invisible selectors, hover states, selected
  states, route colors and midpoint actions.
- Validation should live where the problem is. The bottom validation panel is
  useful, but node-level badges and a header checklist reduce hunting.
- Canvas chrome matters: background grid, minimap, controls, empty state and
  selection outlines should share a token system.
- Runtime styling can wait, but the editor should already reserve visual slots
  for invalid, selected, read-only, running and failed states.

## Borrow, Avoid, Adapt

### Borrow Now

- n8n: edge hit area, edge toolbar behavior, zoom-safe label sizing.
- Dify: edge midpoint add affordance, checklist count, candidate node ghost.
- Flowise: canvas token map, validation-to-node badge flow, custom edge path
  with separate hit target.
- Circuit: domain-specific node previews, condition/approval route labels,
  left-to-right handle posture.
- Open Agent Builder: simple auto-layout control and execution preview location.
- ComfyUI: compact badges and search aliases for later quick add.

### Avoid Copying

- n8n's full canvas architecture is too broad for V1.
- Dify's collaboration/comment stack is not needed before core authoring feels
  good.
- Flowise's bright per-node coloring can make a productivity tool feel toy-like
  if used as full-card color.
- Circuit's thick color headers are useful for status clarity but too visually
  dominant when many nodes are visible.
- Open Agent Builder's inline styling would fight this repo's Tailwind/design
  token patterns.
- ComfyUI's dense typed sockets are premature until this workflow model has
  stable typed outputs.

### Adapt For Vibe Kanban

- Use neutral cards with a narrow color rail/accent, not full-color blocks.
- Keep radius at `8px` or below to match the repo's product UI.
- Use lucide icons and existing app surfaces (`bg-panel`, `text-high`,
  `border-secondary`) instead of inventing a separate brand layer.
- Prefer compact metadata chips over visible instructional text.
- Make every visual state testable through data attributes or stable text so
  Playwright can catch regressions.

## Current Vibe Kanban Canvas State

Already implemented:

- React Flow canvas rendering.
- Palette-to-canvas drag/drop.
- Persisted node positions.
- Snap grid and delete keys.
- Edge labels by semantic edge type.
- Edge selection plus edge inspector.
- Condition branch mapping from edge inspector.
- Playwright smoke coverage for drag/drop and branch routing.

Current visual gaps:

- Nodes use a simple `rounded-lg border bg-panel shadow-sm` card.
- Ports are top/bottom and generic, while all reviewed workflow tools use left-to-right reading as the primary mental model.
- Handles do not express branch/output meaning.
- Edges use default smoothstep rendering, with no custom hover, hit area, route color, midpoint insert affordance or semantic label chrome.
- Selection state is only border/ring.
- No node toolbar, node context menu, copy/duplicate, auto layout or quick add.
- Validation is in a bottom panel, but nodes do not carry issue markers.
- Run canvas has status colors, but editor canvas has no pending/configured/invalid visual state.
- Palette exists, but there is no searchable command/quick add flow.

## Comparator Matrix

| Project | What it does well | Implementation pattern | Style traits | Weaknesses |
|---|---|---|---|---|
| n8n | Industrial canvas primitives, status states, edge toolbar, zoom compensation | Vue Flow, split `CanvasNode`, `CanvasHandleRenderer`, `CanvasEdge`, toolbar parts | Compact, token-driven, subtle, high-density | Complex architecture; direct copying would overfit |
| Dify | Workflow authoring loop, edge insert selector, checklist, comments, collaboration | React Flow, custom edge, block selector, workflow store | Polished panels, blur, hidden handles until useful, clean status warnings | Heavy product-specific dependencies |
| Flowise | Clean embeddable agent canvas, validation panel, typed outputs, sticky notes | React Flow, MUI tokens, custom nodes/edges, ResizeObserver handles | Tinted node surfaces, gradient edges, compact FAB controls | Some inline styling; bright type colors can become toy-like |
| Circuit | Closest domain fit for coding agents and approval flows | React Flow + Zustand + backend schemas | Dark technical canvas, colored headers, thick selected borders, right inspector | Less refined edge interactions; strong colors dominate |
| Open Agent Builder | End-to-end agent builder panels, variables, execution preview, edge labels | React Flow plus many side panels and modals | Compact pill-like nodes, heat accent, utilitarian panels | Custom nodes are simplistic; many inline styles |
| ComfyUI | Power-user node UX, typed sockets, fuzzy node search, collapse/mute/bypass | LiteGraph/Vue, typed slot components, Fuse search | Dense, functional, color-coded sockets, badges | Too domain-specific and dense for our first AI workflow pass |

## n8n

### Features

n8n's canvas is built around small but important primitives:

- `CanvasNode.vue` maps real node inputs and outputs into renderable ports.
- `CanvasNodeDefault.vue` handles visual states: selected, disabled, success, error, pinned, waiting and running.
- Running and waiting states are not just icons. They use an animated conic border behind the node.
- `CanvasHandleRenderer.vue` renders main and non-main handles differently.
- Main output handles can show a plus affordance that lets the user add the next node directly from the port.
- `CanvasEdge.vue` uses a custom edge renderer with a large `interaction-width` and an edge toolbar.
- `CanvasEdgeToolbar.vue` exposes add and delete actions on the edge itself.
- `CanvasAddButton.vue` provides an explicit empty-canvas starting point.

### Implementation Traits

- Strong decomposition: node shell, node render type, handle render type, edge render type and toolbar are separate.
- Zoom compensation is first-class. Labels and handles scale with `--canvas-zoom-compensation-factor`.
- Connection ports are computed from node metadata, not hardcoded per visual component.
- Edge hover has delayed hiding, which prevents flicker when moving between edge and toolbar.

### Style Traits

- Most information is subtle until the user hovers, selects or runs a node.
- Uses neutral surfaces and state-specific accents instead of full-color cards.
- Labels are small and constrained, with overflow handling.
- The visual hierarchy is clear: icon first, title second, status third.

### Strengths

- Best reference for professional canvas micro-interactions.
- Good model for zoom-safe UI and large edge hit areas.
- The edge toolbar is a strong product pattern for "insert here" flows.

### Weaknesses

- Architecture is too large to copy directly.
- Its node and connection model is more general than our V1 graph.

### Borrow

- Custom edge with wide hit area, hover toolbar and delayed hide.
- Node toolbar that appears on hover/selection.
- Animated running/waiting outline for run canvas later.
- Zoom-safe labels and handles.
- First-step empty canvas button.

## Dify

### Features

Dify has the most complete authoring loop among the React Flow references:

- `custom-edge.tsx` renders a custom edge and shows `BlockSelector` at the edge midpoint.
- Users can insert a node between source and target without breaking the mental model.
- `custom-edge-linear-gradient-render.tsx` colors running edges based on source and target status.
- `custom-connection-line.tsx` gives drag-to-connect a deliberate visual trail.
- `candidate-node-main.tsx` shows a ghost candidate node at the cursor before placement.
- `node-contextmenu.tsx`, `edge-contextmenu.tsx` and `selection-contextmenu.tsx` cover right-click workflows.
- `header/checklist/index.tsx` exposes graph problems as a header checklist with navigation.
- `comment/*` and collaboration hooks make canvas annotations part of the product surface.
- `nodes/_base/node.tsx` places node handles, node toolbar, status borders, collaboration avatars, retry and failure branch UI directly on the node.

### Implementation Traits

- React Flow remains the engine, but Dify owns the canvas affordances.
- Handles are not just dots. They can open the block selector when disconnected.
- Edge/node/selection context menus are separate surfaces.
- Validation is not only a save blocker. It is a navigable checklist.
- Runtime status is pushed into node and edge data for visual styling.

### Style Traits

- Node width is stable, with rounded panel surfaces and tokenized text colors.
- Handles are often transparent until hover/selection or connection state requires them.
- Action bars use small floating panels with subtle borders and backdrop blur.
- Checklist and comments use card-like popovers with high polish.

### Strengths

- Best reference for "how users actually build a flow fast".
- Strong edge insertion pattern.
- Strong validation checklist pattern.
- Strong comments/collaboration pattern for later.

### Weaknesses

- Many details depend on Dify's block metadata, plugin system and collaboration stack.
- Visual language is more rounded/soft than Vibe Kanban's utilitarian style.

### Borrow

- Edge midpoint add button.
- Header checklist count with click-to-focus problem nodes.
- Candidate node ghost on add.
- Failure branch/error route presentation.
- Context menus for node, edge and multi-selection.

## Flowise Agentflow

### Features

Flowise Agentflow is useful because it is also React Flow and AI-agent focused:

- `AgentFlowNode.tsx` includes node icon, label, model configs, tool icons, validation warning and execution status.
- `NodeOutputHandles.tsx` supports multiple output anchors and positions them with a `ResizeObserver`.
- `AgentFlowEdge.tsx` renders gradient edges and a hover delete button.
- `ValidationFeedback.tsx` is a floating checklist panel that also pushes validation errors onto node data for border highlighting.
- `StickyNote.tsx` provides editable sticky notes as canvas nodes.
- `Agentflow.tsx` positions add/generate/sync/validate actions as canvas-level FABs.

### Implementation Traits

- Node color is computed through `useNodeColors`, which separates raw node color, hover state and selected state.
- Theme tokens centralize node colors, canvas background, minimap, controls, shadows, typography and z-index.
- Validation is both panel-level and node-level.
- Output handle positioning accounts for dynamic node height.

### Style Traits

- Node surfaces are lightly tinted by node type.
- Edges use gradients from source color to target color.
- Floating action buttons make canvas tools easy to find.
- Sticky notes are real canvas objects, not external comments.

### Strengths

- Good reference for a focused React Flow implementation.
- Token file is a useful model for avoiding ad hoc canvas colors.
- Validation feedback is simple enough to borrow.

### Weaknesses

- Too much type color can make the canvas feel less serious if copied literally.
- MUI style mixing is not aligned with this repo's Tailwind design system.

### Borrow

- A workflow canvas token map.
- Node warning/status badge overlays.
- Validation checklist floating panel or header popover.
- Sticky note node in P3.
- Dynamic handle layout if we add typed/multiple outputs later.

## Circuit

### Features

Circuit is the closest conceptual reference for this project:

- Design, Execution and MCP Servers are top-level modes.
- Palette is grouped by flow nodes and agent nodes.
- Property inspector sits on the right.
- Nodes show domain-specific summaries: model, tools, sandbox and inputs.
- Condition and approval nodes expose labeled branches.
- Runtime states are reflected on nodes with rings, glows and badges.
- Backend schemas drive frontend palette/node behavior.

### Implementation Traits

- `BaseNode.tsx` owns common node shell and status styling.
- `GenericNode.tsx` builds previews from schema metadata.
- `workflowStore.ts` keeps React Flow nodes/edges in Zustand and serializes back to workflow data.
- Schemas are the source of node metadata, default config and handles.

### Style Traits

- Dark canvas with dotted grid.
- Large colored node headers and thick selected borders.
- Dashed edges and visible branch labels.
- Right inspector uses dense form controls.

### Strengths

- Best domain fit for coding-agent workflow.
- Good schema-first node metadata story.
- Good demonstration that visual summaries make agent nodes feel real.

### Weaknesses

- Edges are visually less mature than Dify/n8n.
- Header colors are heavy; this can reduce hierarchy when many nodes are on screen.
- Branch labels are placed outside the node and may collide in dense graphs.

### Borrow

- Node previews that summarize real config.
- Status rings and badges for run canvas.
- Schema/catalog driven node presentation.
- Top-level distinction between design and execution modes.

## Open Agent Builder

### Features

Open Agent Builder shows a complete agent builder product loop:

- Node palette is categorized as Core, Tools, Logic and Data.
- `CustomNodes.tsx` includes branch handles for condition, approval and loop nodes.
- `EdgeLabelModal.tsx` lets users label edges as true, false or custom.
- `VariableReferencePicker.tsx` lists available upstream variables and schema fields.
- `ConnectionMapperModal.tsx` maps source output fields to target arguments.
- `PreviewPanel.tsx` and `ExecutionPanel.tsx` make test runs visible.
- Example templates demonstrate full workflows, not just isolated nodes.
- `WorkflowBuilder.tsx` includes auto layout.

### Implementation Traits

- React Flow plus direct panel/modal state.
- Node labels are JSX and then stripped for persistence.
- A lot of UI logic is inline inside `WorkflowBuilder.tsx`.
- Edge labels are stored directly on edges.

### Style Traits

- Compact pill-like nodes.
- Strong accent color for primary actions.
- Right-side panels are operational and form-heavy.
- Sticky note node exists but is visually separate from functional nodes.

### Strengths

- Good reference for end-to-end editor plus run preview.
- Variable picker and connection mapping are directly relevant to future workflow data passing.
- Templates prove the workflow can be understood as a product surface.

### Weaknesses

- Node chrome is visually simple.
- Inline styling makes consistency hard.
- Edge interactions are less mature than Dify/n8n.

### Borrow

- Variable picker concept.
- Edge label editing, if our branch mapping grows.
- Auto layout button.
- Execution preview panel patterns.

## ComfyUI Frontend

### Features

ComfyUI is not an agent workflow builder, but it is a strong power-user node editor reference:

- `NodeHeader.vue` supports collapse, rename, pinned badge, mute and bypass indicators.
- `NodeSlots.vue`, `OutputSlot.vue` and `SlotConnectionDot.vue` show typed inputs/outputs with color and shape.
- `NodeContent.vue` can render rich media previews inside a node.
- `NodeSearchService` uses Fuse search over `name`, `display_name` and `search_aliases`.
- Search can filter by input type, output type, category and source.
- `searchBoxStore.ts` controls a global node search box.
- Command/keybinding store separates command registration from keybinding display.

### Implementation Traits

- Typed sockets are a first-class model.
- Slot dots support multiple data types through split-color rendering.
- Search is not a simple text filter. It has aliases, filters and advanced scoring.
- Power-user commands are stored centrally and can expose formatted key sequences.

### Style Traits

- Dense node surfaces.
- Slots are highly functional and color-coded.
- Node badges are small and compact.
- The canvas assumes users will learn a professional tool, not a wizard.

### Strengths

- Best reference for typed port semantics and search ergonomics.
- Strong keyboard/command architecture.
- Good collapse/mute/bypass affordances.

### Weaknesses

- Too dense for our current V1 target.
- Visual style is optimized for media graph editing, not task/workflow orchestration.

### Borrow

- Quick add/search aliases.
- Typed/semantic port colors later.
- Collapse/mute/bypass as future advanced actions.
- Small badges instead of large explanatory text.

## Distilled Feature Inventory

### Canvas-Level

- Dotted or grid background with low contrast.
- Styled minimap and controls that match app tokens.
- Top-right or header-level canvas action cluster.
- Empty canvas first-step button.
- Candidate/ghost preview while adding a node.
- Auto layout action.
- Search/quick add command.
- Validation/checklist indicator with issue count.

### Node-Level

- Stable node width and height constraints.
- Icon block, title, type label and config summary.
- Node kind color token, used as accent rather than full-surface color.
- Selected, hover, invalid, running, succeeded, failed, waiting and disabled states.
- Small metadata chips: output capture, branch count, attempt count, role/custom, missing config.
- Status and warning badge overlays.
- Hover/selection toolbar: run step, duplicate, delete, inspect/more.
- Route hints for condition, approval, rejection and arena winner paths.
- Optional note/sticky note node later.

### Port/Handle-Level

- Left input and right output as default orientation.
- Handles that are subtle by default and visible on hover/selection.
- Larger invisible hit areas than visible dots.
- Labels for semantic outputs.
- Typed/color-coded handles later, once source handles can be persisted safely.

### Edge-Level

- Custom edge component, not default React Flow edge.
- Wide interaction path.
- Hover/selected state with stronger stroke and toolbar.
- Edge label chip for semantic edge type.
- Route colors for approval, rejection, condition and arena winner.
- Midpoint add button later.
- Runtime edge status later: running animation, success/warning/error color.

### Checklist/Validation

- Header or floating checklist count.
- Node-level issue badges.
- Click issue to focus/select the node.
- Validation messages should reference node names, not only raw IDs.
- Save and Run test stay blocked when errors exist.

## Proposed Vibe Kanban Phases

### P1: Visual Canvas Quality, No Graph Schema Change

Goal: make the current editor look and feel like a deliberate workflow product.

Checklist:

- [ ] Create canvas design tokens for node kinds, edge kinds, states and canvas chrome.
- [ ] Replace `BaseNode` with a richer node chrome: icon, title, kind label, summary, metadata strip and status/warning slots.
- [ ] Move default visual flow to left-to-right handles while preserving graph compatibility.
- [ ] Add semantic route chips inside/near condition, human gate and arena nodes without requiring new node types.
- [ ] Add selected, hover, invalid and read-only states with polished borders/shadows.
- [ ] Add custom edge renderer for semantic edge colors, label chip, hover and selected states.
- [ ] Style background, minimap and controls to match the local app design system.
- [ ] Add node-level validation marker by passing validation results into the canvas.
- [ ] Keep palette drag/drop and persisted positions working.
- [ ] Add Playwright checks for nonblank styled canvas, node chrome presence, semantic edge label and validation marker.

P1 should be implemented first because it gives immediate perceived quality without touching runtime or graph schema.

### P2: Authoring Speed

Goal: reduce the number of clicks required to build and fix a workflow.

Checklist:

- [ ] Add node hover toolbar: inspect, duplicate, delete.
- [ ] Add edge hover toolbar: inspect/delete first, insert-node later.
- [ ] Add canvas/node/edge context menus.
- [ ] Add quick add command/search for nodes.
- [ ] Add auto layout button.
- [ ] Add keyboard shortcuts for duplicate, delete, fit view and quick add.
- [ ] Add candidate/ghost node while adding from search or edge insert.
- [ ] Extend Playwright to cover keyboard and context-menu flows.

### P3: Advanced Canvas Objects And Run Polish

Goal: move from basic authoring to professional workflow operations.

Checklist:

- [ ] Add sticky notes or canvas comments.
- [ ] Add run overlay mode: animated active node, completed node, failed node and waiting node states.
- [ ] Add richer execution detail on selected node.
- [ ] Add branch/source handle persistence if we want true multi-output sockets.
- [ ] Add typed variable/output hints after data passing is stable.
- [ ] Add collapse/group/subflow only after real graph complexity justifies it.

## P1 Acceptance Criteria

Functional:

- Existing drag/drop works.
- Existing edge inspector and condition branch mapping work.
- Save still persists node positions.
- Read-only system templates cannot be edited.
- Validation still blocks invalid saves.

Visual:

- Nodes have a clear icon, title, type and summary.
- Selected and hover states are visible but not noisy.
- Condition/human/arena routes are understandable without opening the inspector.
- Semantic edges look different from default edges.
- The canvas background, controls and minimap look intentional.
- No text overflows in node cards at normal desktop widths.

Testing:

- `pnpm run workflow:e2e` passes.
- Add at least one Playwright assertion for the new node chrome.
- Add at least one Playwright assertion for semantic edge styling or label rendering.
- Add at least one Playwright assertion for validation marker visibility if validation data is passed into the canvas.
- Existing `WorkflowCanvas.test.ts` still passes or is updated with new exported constants.

## Recommended Next Step

Start P1. The first implementation slice should be:

1. Add presentation helpers and token maps in `workflowPresentation.ts` or a new focused file.
2. Refactor `WorkflowCanvas.tsx` node rendering into a richer node chrome.
3. Add a custom workflow edge component with semantic styling.
4. Pass validation issues into the canvas from `WorkflowTemplateEditorPage.tsx`.
5. Extend Playwright smoke checks.

This is intentionally a visual/interaction quality slice. It does not add new node types and does not require replacing React Flow.
