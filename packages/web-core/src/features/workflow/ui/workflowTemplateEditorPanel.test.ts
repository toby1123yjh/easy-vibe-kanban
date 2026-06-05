import { describe, expect, it } from 'vitest';
import type { WorkflowEdge, WorkflowNode } from '../model/workflowGraph';
import {
  applyWorkflowNodeDataPatch,
  getNextAgentDraftPanelNodeIdForSelection,
  getWorkflowTemplateInspectorPanel,
  shouldKeepRouterConfigPanelForSelection,
} from './workflowTemplateEditorPanel';

const agentNode: WorkflowNode = {
  id: 'agent-1',
  type: 'agent',
  data: { display_name: 'Research code' },
};

const conditionNode: WorkflowNode = {
  id: 'condition-1',
  type: 'condition',
  data: { display_name: 'Check result' },
};

const edge: WorkflowEdge = {
  id: 'edge-1',
  source: 'agent-1',
  target: 'condition-1',
  type: 'default',
};

describe('workflow template editor inspector panel', () => {
  it('shows an agent draft session in the side panel before a run exists', () => {
    expect(
      getWorkflowTemplateInspectorPanel({
        selectedEdge: null,
        selectedNode: agentNode,
        requestedAgentDraftNode: agentNode,
      })
    ).toEqual({ kind: 'agentDraft', node: agentNode });
  });

  it('keeps edge inspection ahead of an open agent draft panel', () => {
    expect(
      getWorkflowTemplateInspectorPanel({
        selectedEdge: edge,
        selectedNode: agentNode,
        requestedAgentDraftNode: agentNode,
      })
    ).toEqual({ kind: 'edge', edge });
  });

  it('uses the normal node inspector for non-agent nodes', () => {
    expect(
      getWorkflowTemplateInspectorPanel({
        selectedEdge: null,
        selectedNode: conditionNode,
        requestedAgentDraftNode: conditionNode,
      })
    ).toEqual({ kind: 'node', node: conditionNode });
  });

  it('keeps an open agent draft panel when ReactFlow repeats the same selection', () => {
    expect(
      getNextAgentDraftPanelNodeIdForSelection({
        currentPanelNodeId: 'agent-1',
        selectedNodeId: 'agent-1',
        selectedEdgeId: null,
      })
    ).toBe('agent-1');
  });

  it('closes the agent draft panel when selection moves away', () => {
    expect(
      getNextAgentDraftPanelNodeIdForSelection({
        currentPanelNodeId: 'agent-1',
        selectedNodeId: 'condition-1',
        selectedEdgeId: null,
      })
    ).toBeNull();

    expect(
      getNextAgentDraftPanelNodeIdForSelection({
        currentPanelNodeId: 'agent-1',
        selectedNodeId: 'agent-1',
        selectedEdgeId: 'edge-1',
      })
    ).toBeNull();
  });

  it('keeps the router config panel open for the auto-selected new condition', () => {
    expect(
      shouldKeepRouterConfigPanelForSelection({
        pendingRouterPromptNodeId: 'condition-1',
        selectedNodeId: 'condition-1',
        selectedEdgeId: null,
      })
    ).toBe(true);

    expect(
      shouldKeepRouterConfigPanelForSelection({
        pendingRouterPromptNodeId: 'condition-1',
        selectedNodeId: 'agent-1',
        selectedEdgeId: null,
      })
    ).toBe(false);

    expect(
      shouldKeepRouterConfigPanelForSelection({
        pendingRouterPromptNodeId: 'condition-1',
        selectedNodeId: 'condition-1',
        selectedEdgeId: 'edge-1',
      })
    ).toBe(false);
  });

  it('applies the submitted agent draft to the graph before starting a run', () => {
    const nextGraph = applyWorkflowNodeDataPatch(
      {
        version: 2,
        nodes: [agentNode, conditionNode],
        edges: [edge],
      },
      'agent-1',
      {
        prompt_template: 'Read the project and summarize the architecture.',
        executor_config: {
          executor: 'CODEX',
          variant: null,
        },
      }
    );

    expect(nextGraph.nodes.find((node) => node.id === 'agent-1')?.data).toEqual(
      {
        display_name: 'Research code',
        prompt_template: 'Read the project and summarize the architecture.',
        executor_config: {
          executor: 'CODEX',
          variant: null,
        },
      }
    );
    expect(nextGraph.nodes.find((node) => node.id === 'condition-1')).toBe(
      conditionNode
    );
    expect(nextGraph.edges).toEqual([edge]);
  });
});
