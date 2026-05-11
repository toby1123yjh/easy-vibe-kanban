import type {
  WorkflowEdgeKind,
  WorkflowNodeData,
  WorkflowNodeKind,
} from './workflowGraph';

const NODE_KIND_LABELS: Record<WorkflowNodeKind, string> = {
  start: 'Start',
  end: 'End',
  agent: 'Agent',
  condition: 'Condition',
  human_gate: 'Human Gate',
  transform: 'Transform',
  arena: 'Arena',
};

const EDGE_LABELS: Record<Exclude<WorkflowEdgeKind, 'default'>, string> = {
  condition_branch: 'Condition',
  approval: 'Approve',
  rejection: 'Reject',
  arena_winner: 'Winner',
};

export interface WorkflowEdgeKindOption {
  value: WorkflowEdgeKind;
  label: string;
  description: string;
}

const EDGE_KIND_OPTIONS: WorkflowEdgeKindOption[] = [
  {
    value: 'default',
    label: 'Default',
    description: 'Continue to the next node.',
  },
  {
    value: 'condition_branch',
    label: 'Condition',
    description: 'Route through a conditional branch.',
  },
  {
    value: 'approval',
    label: 'Approve',
    description: 'Continue after a human approval.',
  },
  {
    value: 'rejection',
    label: 'Reject',
    description: 'Route after a human rejection.',
  },
  {
    value: 'arena_winner',
    label: 'Winner',
    description: 'Promote the winning arena attempt.',
  },
];

export function getWorkflowNodeKindLabel(kind: WorkflowNodeKind): string {
  return NODE_KIND_LABELS[kind];
}

export function getWorkflowNodeSummary(
  kind: WorkflowNodeKind,
  data: WorkflowNodeData
): string {
  switch (kind) {
    case 'start':
      return 'Entry point';
    case 'end':
      return 'Exit point';
    case 'agent':
      return `Role: ${String(data.role_template_id || 'custom')}`;
    case 'condition':
      return `Branches: ${Array.isArray(data.branches) ? data.branches.length : 0}`;
    case 'human_gate':
      return 'Waits for approval';
    case 'transform':
      return `Mode: ${String(data.mode || 'template')}`;
    case 'arena':
      return `Attempts: ${Array.isArray(data.attempts) ? data.attempts.length : 0}`;
  }
}

export function getWorkflowEdgeLabel(
  kind: WorkflowEdgeKind
): string | undefined {
  if (kind === 'default') {
    return undefined;
  }
  return EDGE_LABELS[kind];
}

export function getWorkflowEdgeKindOptions(): WorkflowEdgeKindOption[] {
  return EDGE_KIND_OPTIONS;
}
