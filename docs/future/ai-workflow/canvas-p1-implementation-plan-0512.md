# AI Workflow Canvas P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI Workflow editor canvas feel like a deliberate workflow product through richer node chrome, semantic edges, validation markers and styled canvas controls without adding new node types.

**Architecture:** Keep React Flow as the graph engine. Add focused presentation helpers in the workflow model layer, keep node/edge rendering inside `WorkflowCanvas.tsx`, and pass validation issues from `WorkflowTemplateEditorPage.tsx` into the canvas. Avoid graph schema changes.

**Tech Stack:** React 18, TypeScript, `@xyflow/react`, Tailwind utility classes, Playwright workflow fixture.

---

## File Structure

- Modify: `packages/web-core/src/features/workflow/model/workflowPresentation.ts`
  - Owns node/edge visual tokens, metadata chips and branch route hints.
- Modify: `packages/web-core/src/features/workflow/model/workflowPresentation.test.ts`
  - Covers visual token and metadata helper behavior.
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowValidationPanel.tsx`
  - Adds optional node IDs to validation issues so canvas badges can target nodes.
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.tsx`
  - Renders richer node chrome, left/right handles, custom semantic edge, styled minimap/controls/background and node validation badges.
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowTemplateEditorPage.tsx`
  - Passes validation issues into `WorkflowCanvas`.
- Modify: `packages/web-core/src/features/workflow/ui/WorkflowCanvas.test.ts`
  - Covers exported canvas constants and edge type wiring.
- Modify: `tests/workflow/fixture/src/main.tsx`
  - Supplies validation issues in the Playwright fixture.
- Modify: `tests/workflow/specs/workflow-canvas.spec.ts`
  - Adds smoke checks for node chrome, semantic edge styling and validation marker.

## Task 1: Presentation Helpers

- [ ] Add failing tests for node visual metadata, edge visual tokens and node validation issue mapping.
- [ ] Run focused test command if available: `pnpm exec vitest packages/web-core/src/features/workflow/model/workflowPresentation.test.ts`.
- [ ] Implement helper functions and exported token maps.
- [ ] Re-run the focused test or document if Vitest is unavailable.

## Task 2: Canvas Node Chrome

- [ ] Add Playwright expectations for icon/title/type/summary/metadata and left/right handle classes.
- [ ] Run `pnpm run workflow:e2e` and confirm the new assertions fail before implementation.
- [ ] Replace the current simple node card with compact product chrome: accent rail, icon capsule, title, kind label, summary, metadata chips, route hints and validation badge.
- [ ] Preserve drag/drop, position persistence and read-only behavior.

## Task 3: Custom Semantic Edge

- [ ] Add Playwright expectations for a semantic edge chip and custom edge class/data attributes.
- [ ] Run `pnpm run workflow:e2e` and confirm the new assertions fail before implementation.
- [ ] Register a custom React Flow edge type with route color, wide invisible hit path, selected/hover styling and label chip.
- [ ] Keep edge inspector selection behavior intact.

## Task 4: Canvas Chrome And Validation Wiring

- [ ] Pass validation issues from `WorkflowTemplateEditorPage.tsx` into `WorkflowCanvas`.
- [ ] Add styled background, minimap and controls that use existing app tokens.
- [ ] Add Playwright fixture validation data and assert node-level marker visibility.
- [ ] Ensure no visible instructional text is added to the canvas surface.

## Task 5: Verification And Commit

- [ ] Run `pnpm run workflow:e2e`.
- [ ] Run `pnpm --filter @vibe/web-core run check`.
- [ ] Run `pnpm --filter @vibe/web-core run format`.
- [ ] Run `git diff --check`.
- [ ] Commit and push the P1 implementation.
