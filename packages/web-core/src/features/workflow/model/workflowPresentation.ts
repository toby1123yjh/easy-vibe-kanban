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

export interface WorkflowNodeVisual {
  accentClass: string;
  iconClass: string;
  badgeClass: string;
}

export interface WorkflowEdgeVisual {
  label?: string;
  pathClass: string;
  chipClass: string;
}

export interface WorkflowNodeMetadataChip {
  label: string;
  value: string;
}

export interface WorkflowNodeRouteHint {
  label: string;
  tone: 'brand' | 'success' | 'warning' | 'danger';
}

const NODE_VISUALS: Record<WorkflowNodeKind, WorkflowNodeVisual> = {
  start: {
    accentClass: 'bg-emerald-500',
    iconClass: 'bg-emerald-500/10 text-emerald-700',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  },
  end: {
    accentClass: 'bg-slate-500',
    iconClass: 'bg-slate-500/10 text-slate-700',
    badgeClass: 'border-slate-500/30 bg-slate-500/10 text-slate-700',
  },
  agent: {
    accentClass: 'bg-sky-500',
    iconClass: 'bg-sky-500/10 text-sky-700',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
  },
  condition: {
    accentClass: 'bg-amber-500',
    iconClass: 'bg-amber-500/10 text-amber-700',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  },
  human_gate: {
    accentClass: 'bg-violet-500',
    iconClass: 'bg-violet-500/10 text-violet-700',
    badgeClass: 'border-violet-500/30 bg-violet-500/10 text-violet-700',
  },
  transform: {
    accentClass: 'bg-cyan-500',
    iconClass: 'bg-cyan-500/10 text-cyan-700',
    badgeClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700',
  },
  arena: {
    accentClass: 'bg-fuchsia-500',
    iconClass: 'bg-fuchsia-500/10 text-fuchsia-700',
    badgeClass: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700',
  },
};

const EDGE_VISUALS: Record<WorkflowEdgeKind, WorkflowEdgeVisual> = {
  default: {
    pathClass: 'stroke-low/60',
    chipClass: 'border-secondary bg-panel text-low',
  },
  condition_branch: {
    label: EDGE_LABELS.condition_branch,
    pathClass: 'stroke-amber-500',
    chipClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  },
  approval: {
    label: EDGE_LABELS.approval,
    pathClass: 'stroke-emerald-500',
    chipClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  },
  rejection: {
    label: EDGE_LABELS.rejection,
    pathClass: 'stroke-rose-500',
    chipClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700',
  },
  arena_winner: {
    label: EDGE_LABELS.arena_winner,
    pathClass: 'stroke-fuchsia-500',
    chipClass: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700',
  },
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

export function getWorkflowNodeVisual(
  kind: WorkflowNodeKind
): WorkflowNodeVisual {
  return NODE_VISUALS[kind];
}

function formatToken(value: unknown, fallback: string): string {
  return String(value || fallback).replace(/_/g, ' ');
}

export function getWorkflowNodeMetadata(
  kind: WorkflowNodeKind,
  data: WorkflowNodeData
): WorkflowNodeMetadataChip[] {
  switch (kind) {
    case 'start':
      return [{ label: 'Trigger', value: 'manual' }];
    case 'end':
      return [{ label: 'State', value: 'terminal' }];
    case 'agent':
      return [
        { label: 'Role', value: formatToken(data.role_template_id, 'custom') },
      ];
    case 'condition':
      return [
        {
          label: 'Branches',
          value: String(
            Array.isArray(data.branches) ? data.branches.length : 0
          ),
        },
        { label: 'Logic', value: String(data.joiner || 'and').toUpperCase() },
      ];
    case 'human_gate':
      return [
        {
          label: 'Action',
          value: formatToken(data.required_action, 'approve or reject'),
        },
      ];
    case 'transform':
      return [{ label: 'Mode', value: formatToken(data.mode, 'template') }];
    case 'arena':
      return [
        {
          label: 'Attempts',
          value: String(
            Array.isArray(data.attempts) ? data.attempts.length : 0
          ),
        },
        {
          label: 'Promote',
          value: formatToken(data.promote_strategy, 'manual'),
        },
      ];
  }
}

export function getWorkflowNodeRouteHints(
  kind: WorkflowNodeKind,
  data: WorkflowNodeData
): WorkflowNodeRouteHint[] {
  if (kind === 'condition') {
    return (data.branches ?? []).slice(0, 3).map((branch, index) => ({
      label: branch.name || `Branch ${index + 1}`,
      tone: index === 0 ? 'success' : 'warning',
    }));
  }

  if (kind === 'human_gate') {
    return [
      { label: 'Approve', tone: 'success' },
      { label: 'Reject', tone: 'danger' },
    ];
  }

  if (kind === 'arena') {
    return [{ label: 'Winner', tone: 'brand' }];
  }

  return [];
}

export function getWorkflowEdgeLabel(
  kind: WorkflowEdgeKind
): string | undefined {
  if (kind === 'default') {
    return undefined;
  }
  return EDGE_LABELS[kind];
}

export function getWorkflowEdgeVisual(
  kind: WorkflowEdgeKind
): WorkflowEdgeVisual {
  return EDGE_VISUALS[kind];
}

export function getWorkflowEdgeKindOptions(): WorkflowEdgeKindOption[] {
  return EDGE_KIND_OPTIONS;
}
