import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import './style.css';
import {
  WORKFLOW_GRAPH_VERSION,
  clearConditionBranchTargetForEdge,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  migrateWorkflowGraph,
  setConditionBranchTargetForEdge,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodePosition,
} from '../../../../packages/web-core/src/features/workflow/model/workflowGraph';
import { WorkflowCanvas } from '../../../../packages/web-core/src/features/workflow/ui/WorkflowCanvas';
import { WorkflowEdgeInspector } from '../../../../packages/web-core/src/features/workflow/ui/WorkflowEdgeInspector';
import { IssueWorkflowEntryCard } from '../../../../packages/web-core/src/features/workflow/ui/IssueWorkflowEntryCard';
import { WorkflowNodeInspector } from '../../../../packages/web-core/src/features/workflow/ui/WorkflowNodeInspector';
import { IssueTaskAttemptsSection } from '../../../../packages/ui/src/components/IssueTaskAttemptsSection';
import type { ValidationIssue } from '../../../../packages/web-core/src/features/workflow/ui/WorkflowValidationPanel';

const initialGraph: WorkflowGraph = {
  version: WORKFLOW_GRAPH_VERSION,
  nodes: [
    {
      id: 'start',
      type: 'start',
      data: { display_name: 'Start' },
      position: { x: 40, y: 140 },
    },
    {
      id: 'condition',
      type: 'condition',
      data: {
        display_name: 'Condition',
        joiner: 'and',
        conditions: [
          {
            input: 'run_input',
            operator: 'contains',
            value: 'ship',
          },
        ],
        branches: [
          { name: 'true', target_node_id: 'yes' },
          { name: 'false', target_node_id: 'no' },
        ],
      },
      position: { x: 280, y: 140 },
    },
    {
      id: 'yes',
      type: 'agent',
      data: {
        display_name: 'Yes path',
        role_template_id: 'reviewer',
        prompt_template: 'Review {{input}} and {{upstream}}',
        session_id: 'session-yes',
      },
      position: { x: 540, y: 40 },
    },
    {
      id: 'no',
      type: 'agent',
      data: { display_name: 'No path', role_template_id: 'fixer' },
      position: { x: 540, y: 240 },
    },
    {
      id: 'end',
      type: 'end',
      data: { display_name: 'End' },
      position: { x: 820, y: 140 },
    },
  ],
  edges: [
    {
      id: 'start-condition',
      source: 'start',
      target: 'condition',
      type: 'default',
    },
    {
      id: 'condition-yes',
      source: 'condition',
      target: 'yes',
      type: 'condition_branch',
    },
    {
      id: 'condition-no',
      source: 'condition',
      target: 'no',
      type: 'condition_branch',
    },
    { id: 'yes-end', source: 'yes', target: 'end', type: 'default' },
    { id: 'no-end', source: 'no', target: 'end', type: 'default' },
  ],
};

const canvasValidationIssues: ValidationIssue[] = [
  {
    type: 'warning',
    nodeId: 'condition',
    message: 'Condition needs a fallback route',
  },
];

interface AgentStepContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

function avoidOverlap(
  graph: WorkflowGraph,
  position: WorkflowNodePosition
): WorkflowNodePosition {
  let next = { ...position };
  let guard = 0;
  while (
    guard < 12 &&
    graph.nodes.some((node) => {
      if (!node.position) return false;
      return (
        Math.abs(node.position.x - next.x) < 240 &&
        Math.abs(node.position.y - next.y) < 140
      );
    })
  ) {
    next = { x: next.x + 40, y: next.y + 120 };
    guard += 1;
  }
  return next;
}

function WorkflowCanvasHarness() {
  const searchParams = new URLSearchParams(window.location.search);
  const readOnly = searchParams.get('readonly') === '1';
  const legacyGraphMode = searchParams.get('legacy') === '1';
  const defaultGraphMode = searchParams.get('mode') === 'default-graph';

  const [graph, setGraph] = useState<WorkflowGraph>(() => {
    const baseGraph = defaultGraphMode
      ? createDefaultWorkflowGraph()
      : initialGraph;
    return migrateWorkflowGraph({
      ...baseGraph,
      version: legacyGraphMode ? 1 : baseGraph.version,
      edges: legacyGraphMode
        ? baseGraph.edges.map(
            ({ source_handle: _source, target_handle: _target, ...edge }) =>
              edge
          )
        : baseGraph.edges,
    });
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [sessionPanelNodeId, setSessionPanelNodeId] = useState<string | null>(
    null
  );
  const [contextMenu, setContextMenu] =
    useState<AgentStepContextMenuState | null>(null);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [graph, selectedEdgeId]
  );
  const selectedEdgeConditionBranchName = useMemo(
    () =>
      selectedEdge
        ? getConditionBranchNameForEdge(graph, selectedEdge.id)
        : null,
    [graph, selectedEdge]
  );
  const selectedEdgeConditionBranchNames = useMemo(
    () =>
      selectedEdge
        ? getConditionBranchNamesForEdge(graph, selectedEdge.id)
        : [],
    [graph, selectedEdge]
  );
  const sessionPanelNode = useMemo(
    () => graph.nodes.find((node) => node.id === sessionPanelNodeId) ?? null,
    [graph, sessionPanelNodeId]
  );
  const editNode = useMemo(
    () => graph.nodes.find((node) => node.id === editNodeId) ?? null,
    [graph, editNodeId]
  );

  const addAgentStep = (position?: WorkflowNodePosition) => {
    setGraph((current) => {
      const selectedNode = current.nodes.find(
        (node) => node.id === selectedNodeId
      );
      const requestedPosition =
        position ??
        (selectedNode?.position
          ? { x: selectedNode.position.x + 300, y: selectedNode.position.y }
          : { x: 360, y: 160 });
      const node = createWorkflowNode('agent', {
        position: avoidOverlap(current, requestedPosition),
      });
      const edges =
        selectedNode && selectedNode.type !== 'end'
          ? [
              ...current.edges,
              createWorkflowEdge({
                id: `${selectedNode.id}-${node.id}`,
                source: selectedNode.id,
                target: node.id,
              }),
            ]
          : current.edges;

      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setSessionPanelNodeId(null);
      setEditNodeId(node.id);
      setEditTitle(String(node.data.display_name ?? ''));
      setEditPrompt(String(node.data.prompt_template ?? ''));

      return {
        ...current,
        nodes: [...current.nodes, node],
        edges,
      };
    });
  };

  const handleNodeDrop = (
    kind: WorkflowNodeKind,
    position: WorkflowNodePosition
  ) => {
    if (kind === 'agent') addAgentStep(position);
  };

  const handleEdgeChange = (
    edgeId: string,
    updates: Partial<Pick<WorkflowEdge, 'type'>>
  ) => {
    setGraph((current) => {
      let nextGraph: WorkflowGraph = {
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...updates } : edge
        ),
      };

      if (updates.type === 'condition_branch') {
        const branchName =
          getConditionBranchNameForEdge(nextGraph, edgeId) ??
          getConditionBranchNamesForEdge(nextGraph, edgeId)[0];
        if (branchName) {
          nextGraph = setConditionBranchTargetForEdge(
            nextGraph,
            edgeId,
            branchName
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
    dataUpdates: Partial<WorkflowGraph['nodes'][number]['data']>
  ) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...dataUpdates } }
          : node
      ),
    }));
  };

  const openEditDialog = (nodeId: string) => {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    setEditNodeId(nodeId);
    setEditTitle(String(node.data.display_name ?? ''));
    setEditPrompt(String(node.data.prompt_template ?? ''));
    setContextMenu(null);
  };

  const saveEditDialog = () => {
    if (!editNodeId) return;
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === editNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                display_name: editTitle,
                prompt_template: editPrompt,
              },
            }
          : node
      ),
    }));
    setEditNodeId(null);
  };

  const duplicateAgentStep = (nodeId: string) => {
    setGraph((current) => {
      const node = current.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.type !== 'agent') return current;
      const duplicateData = { ...node.data };
      delete duplicateData.session_id;
      const duplicate = createWorkflowNode('agent', {
        data: {
          ...duplicateData,
          display_name: `${node.data.display_name ?? 'Agent Step'} copy`,
        },
        position: avoidOverlap(current, {
          x: (node.position?.x ?? 360) + 80,
          y: (node.position?.y ?? 160) + 80,
        }),
      });
      return { ...current, nodes: [...current.nodes, duplicate] };
    });
    setContextMenu(null);
  };

  const deleteAgentStep = (nodeId: string) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
    }));
    setContextMenu(null);
  };

  return (
    <main>
      <aside>
        <button type="button" onClick={() => addAgentStep()}>
          Add Agent Step
        </button>
        <button
          data-testid="select-condition-edge"
          onClick={() => setSelectedEdgeId('condition-yes')}
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
              setContextMenu(null);
              if (selection.nodeId !== sessionPanelNodeId) {
                setSessionPanelNodeId(null);
              }
            }}
            onNodeOpen={(nodeId) => {
              const node = graph.nodes.find(
                (candidate) => candidate.id === nodeId
              );
              if (!node || node.type === 'start' || node.type === 'end') {
                return;
              }
              setSelectedNodeId(nodeId);
              setSelectedEdgeId(null);
              setSessionPanelNodeId(nodeId);
            }}
            onNodeContextMenu={(event) => {
              const node = graph.nodes.find(
                (candidate) => candidate.id === event.nodeId
              );
              setContextMenu(node?.type === 'agent' ? event : null);
            }}
          />
        </ReactFlowProvider>
      </section>
      <section data-testid="node-inspector">
        <WorkflowNodeInspector
          node={selectedNode}
          onChange={handleNodeChange}
        />
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
              setConditionBranchTargetForEdge(current, edgeId, branchName)
            );
          }}
        />
      </section>

      {sessionPanelNode ? (
        <section data-testid="workflow-node-session-panel">
          <h2>{sessionPanelNode.data.display_name}</h2>
          <p data-testid="workflow-node-session-id">
            {String(sessionPanelNode.data.session_id ?? 'draft-session')}
          </p>
          <textarea aria-label="Message" defaultValue="" />
        </section>
      ) : null}

      {contextMenu ? (
        <div
          role="menu"
          data-testid="agent-step-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
          }}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setSessionPanelNodeId(contextMenu.nodeId);
              setContextMenu(null);
            }}
          >
            Open Session
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => openEditDialog(contextMenu.nodeId)}
          >
            Edit
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => duplicateAgentStep(contextMenu.nodeId)}
          >
            Duplicate
          </button>
          <button role="menuitem" type="button" disabled>
            Run From Here
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => deleteAgentStep(contextMenu.nodeId)}
          >
            Delete
          </button>
        </div>
      ) : null}

      {editNode ? (
        <section data-testid="agent-step-edit-dialog" role="dialog">
          <h2>Edit Agent Step</h2>
          <label>
            Step title
            <input
              aria-label="Step title"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
            />
          </label>
          <label>
            Default prompt
            <textarea
              aria-label="Default prompt"
              value={editPrompt}
              onChange={(event) => setEditPrompt(event.target.value)}
            />
          </label>
          <button type="button" onClick={saveEditDialog}>
            Save step
          </button>
        </section>
      ) : null}

      <pre data-testid="graph-json">{JSON.stringify(graph, null, 2)}</pre>
    </main>
  );
}

function WorkflowEntryHarness() {
  const [lastAction, setLastAction] = useState('none');

  return (
    <main>
      <IssueWorkflowEntryCard
        isCreating={false}
        error={null}
        onOpenCanvas={() => setLastAction('open-canvas')}
        onRunExisting={() => setLastAction('open-canvas')}
      />
      <output data-testid="workflow-entry-action">{lastAction}</output>
    </main>
  );
}

function TaskAttemptsHarness() {
  const attempts = [
    {
      id: 'workflow-attempt-1',
      kind: 'workflow' as const,
      title: 'Workflow attempt for Familiarize code',
      subtitle: 'Draft workflow attempt',
      statusLabel: 'Draft',
      statusTone: 'draft' as const,
      updatedAt: '2026-05-14T02:00:00Z',
      primaryActionLabel: 'Open canvas',
    },
    {
      id: 'workspace-attempt-1',
      kind: 'single_agent' as const,
      title: 'Codex try',
      subtitle: 'Workspace workspace-1',
      statusLabel: 'Completed',
      statusTone: 'succeeded' as const,
      updatedAt: '2026-05-14T01:00:00Z',
      primaryActionLabel: 'Open session',
    },
  ];
  const [lastAction, setLastAction] = useState('none');

  return (
    <main>
      <IssueTaskAttemptsSection
        attempts={attempts}
        onOpenAttempt={(attempt) => setLastAction(`open:${attempt.kind}`)}
        onCreateWorkflowAttempt={() => setLastAction('create-workflow')}
      />
      <output data-testid="task-attempt-action">{lastAction}</output>
    </main>
  );
}

const mode = new URLSearchParams(window.location.search).get('mode');

createRoot(document.getElementById('root')!).render(
  mode === 'entry' ? (
    <WorkflowEntryHarness />
  ) : mode === 'task-attempts' ? (
    <TaskAttemptsHarness />
  ) : (
    <WorkflowCanvasHarness />
  )
);
