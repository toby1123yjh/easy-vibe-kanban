import type { Edge as ReactFlowEdge } from '@xyflow/react';
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
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
      sourceHandle: edge.sourceHandle ?? DEFAULT_SOURCE_HANDLE,
      target: nodeId,
      targetHandle: DEFAULT_TARGET_HANDLE,
      type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
      data: { workflowType },
    },
    {
      id: `${nodeId}-${edge.target}`,
      source: nodeId,
      sourceHandle: DEFAULT_SOURCE_HANDLE,
      target: edge.target,
      targetHandle: edge.targetHandle ?? DEFAULT_TARGET_HANDLE,
      type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
      data: { workflowType: 'default' },
    },
  ];
}
