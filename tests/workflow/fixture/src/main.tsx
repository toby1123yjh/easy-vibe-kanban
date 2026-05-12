import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "./style.css";
import {
  WORKFLOW_GRAPH_VERSION,
  WORKFLOW_NODE_DRAG_DATA_TYPE,
  clearConditionBranchTargetForEdge,
  createWorkflowNode,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  setConditionBranchTargetForEdge,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodePosition,
} from "../../../../packages/web-core/src/features/workflow/model/workflowGraph";
import { WorkflowCanvas } from "../../../../packages/web-core/src/features/workflow/ui/WorkflowCanvas";
import { WorkflowEdgeInspector } from "../../../../packages/web-core/src/features/workflow/ui/WorkflowEdgeInspector";
import { WorkflowNodeInspector } from "../../../../packages/web-core/src/features/workflow/ui/WorkflowNodeInspector";
import type { ValidationIssue } from "../../../../packages/web-core/src/features/workflow/ui/WorkflowValidationPanel";

const initialGraph: WorkflowGraph = {
  version: WORKFLOW_GRAPH_VERSION,
  nodes: [
    {
      id: "start",
      type: "start",
      data: { display_name: "Start" },
      position: { x: 40, y: 140 },
    },
    {
      id: "condition",
      type: "condition",
      data: {
        display_name: "Condition",
        joiner: "and",
        conditions: [
          {
            input: "run_input",
            operator: "contains",
            value: "ship",
          },
        ],
        branches: [
          { name: "true", target_node_id: "yes" },
          { name: "false", target_node_id: "no" },
        ],
      },
      position: { x: 280, y: 140 },
    },
    {
      id: "yes",
      type: "agent",
      data: { display_name: "Yes path", role_template_id: "reviewer" },
      position: { x: 540, y: 40 },
    },
    {
      id: "no",
      type: "agent",
      data: { display_name: "No path", role_template_id: "fixer" },
      position: { x: 540, y: 240 },
    },
    {
      id: "end",
      type: "end",
      data: { display_name: "End" },
      position: { x: 820, y: 140 },
    },
  ],
  edges: [
    {
      id: "start-condition",
      source: "start",
      target: "condition",
      type: "default",
    },
    {
      id: "condition-yes",
      source: "condition",
      target: "yes",
      type: "condition_branch",
    },
    {
      id: "condition-no",
      source: "condition",
      target: "no",
      type: "condition_branch",
    },
    { id: "yes-end", source: "yes", target: "end", type: "default" },
    { id: "no-end", source: "no", target: "end", type: "default" },
  ],
};

const canvasValidationIssues: ValidationIssue[] = [
  {
    type: "warning",
    nodeId: "condition",
    message: "Condition needs a fallback route",
  },
];

function PaletteButton({ kind }: { kind: WorkflowNodeKind }) {
  return (
    <button
      data-testid={`palette-${kind}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(WORKFLOW_NODE_DRAG_DATA_TYPE, kind);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      Agent
    </button>
  );
}

function WorkflowCanvasHarness() {
  const readOnly =
    new URLSearchParams(window.location.search).get("readonly") === "1";
  const [graph, setGraph] = useState<WorkflowGraph>(initialGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [openNodeDialogId, setOpenNodeDialogId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [graph, selectedEdgeId],
  );
  const dialogNode = useMemo(
    () => graph.nodes.find((node) => node.id === openNodeDialogId) ?? null,
    [graph, openNodeDialogId],
  );
  const selectedEdgeConditionBranchName = useMemo(
    () =>
      selectedEdge
        ? getConditionBranchNameForEdge(graph, selectedEdge.id)
        : null,
    [graph, selectedEdge],
  );
  const selectedEdgeConditionBranchNames = useMemo(
    () =>
      selectedEdge
        ? getConditionBranchNamesForEdge(graph, selectedEdge.id)
        : [],
    [graph, selectedEdge],
  );

  const handleNodeDrop = (
    kind: WorkflowNodeKind,
    position: WorkflowNodePosition,
  ) => {
    const node = createWorkflowNode(kind, { position });
    setGraph((current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));
  };

  const handleEdgeChange = (
    edgeId: string,
    updates: Partial<Pick<WorkflowEdge, "type">>,
  ) => {
    setGraph((current) => {
      let nextGraph: WorkflowGraph = {
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...updates } : edge,
        ),
      };

      if (updates.type === "condition_branch") {
        const branchName =
          getConditionBranchNameForEdge(nextGraph, edgeId) ??
          getConditionBranchNamesForEdge(nextGraph, edgeId)[0];
        if (branchName) {
          nextGraph = setConditionBranchTargetForEdge(
            nextGraph,
            edgeId,
            branchName,
          );
        }
      } else if (updates.type) {
        nextGraph = clearConditionBranchTargetForEdge(nextGraph, edgeId);
      }

      return nextGraph;
    });
  };

  const handleNodeChange = (
    nodeId: string,
    dataUpdates: Partial<WorkflowGraph["nodes"][number]["data"]>,
  ) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...dataUpdates } }
          : node,
      ),
    }));
  };

  return (
    <main>
      <aside>
        <PaletteButton kind="agent" />
        <button
          data-testid="select-condition-edge"
          onClick={() => setSelectedEdgeId("condition-yes")}
        >
          Select condition edge
        </button>
      </aside>
      <section data-testid="workflow-canvas" style={{ height: 520 }}>
        <ReactFlowProvider>
          <WorkflowCanvas
            graph={graph}
            validationIssues={canvasValidationIssues}
            readOnly={readOnly}
            onChange={setGraph}
            onNodeDrop={handleNodeDrop}
            onSelectionChange={(selection) => {
              setSelectedNodeId(selection.nodeId);
              setSelectedEdgeId(selection.edgeId);
            }}
            onNodeOpen={(nodeId) => {
              setSelectedNodeId(nodeId);
              setSelectedEdgeId(null);
              setOpenNodeDialogId(nodeId);
            }}
          />
        </ReactFlowProvider>
      </section>
      <section data-testid="node-inspector">
        <WorkflowNodeInspector node={selectedNode} onChange={handleNodeChange} />
      </section>
      <section data-testid="edge-inspector">
        <WorkflowEdgeInspector
          edge={selectedEdge}
          nodes={graph.nodes}
          conditionBranchName={selectedEdgeConditionBranchName}
          conditionBranchNames={selectedEdgeConditionBranchNames}
          onChange={handleEdgeChange}
          onConditionBranchChange={(edgeId, branchName) => {
            setGraph((current) =>
              setConditionBranchTargetForEdge(current, edgeId, branchName),
            );
          }}
        />
      </section>
      {dialogNode ? (
        <section data-testid="node-dialog">
          <WorkflowNodeInspector node={dialogNode} onChange={handleNodeChange} />
        </section>
      ) : null}
      <pre data-testid="graph-json">{JSON.stringify(graph, null, 2)}</pre>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<WorkflowCanvasHarness />);
