import type { WorkflowNodeKind, WorkflowNodeData } from './workflowGraph';

export interface CatalogEntry {
  type: WorkflowNodeKind;
  label: string;
  description: string;
  defaultData: WorkflowNodeData;
}

export interface WorkflowNodeCatalogSection {
  label: string;
  entries: CatalogEntry[];
}

export const WORKFLOW_NODE_CATALOG: CatalogEntry[] = [
  {
    type: 'start',
    label: 'Start',
    description: 'Entry point of the workflow',
    defaultData: { display_name: 'Start' },
  },
  {
    type: 'end',
    label: 'End',
    description: 'Exit point of the workflow',
    defaultData: { display_name: 'End' },
  },
  {
    type: 'agent',
    label: 'Agent',
    description: 'AI agent to execute tasks',
    defaultData: {
      display_name: 'Agent',
      role_template_id: 'custom',
      prompt_template: '',
    },
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Branching logic based on rules',
    defaultData: {
      display_name: 'Condition',
      joiner: 'and',
      conditions: [
        {
          input: '{{input}}',
          operator: 'contains',
          value: '',
        },
      ],
      branches: [{ name: 'true' }, { name: 'false' }],
    },
  },
  {
    type: 'human_gate',
    label: 'Human Gate',
    description: 'Wait for human approval',
    defaultData: {
      display_name: 'Human Gate',
      required_action: 'approve_or_reject',
    },
  },
  {
    type: 'transform',
    label: 'Transform',
    description: 'Transform data between nodes',
    defaultData: {
      display_name: 'Transform',
      mode: 'template',
      template: '{{input}}',
    },
  },
  {
    type: 'arena',
    label: 'Arena',
    description: 'Run multiple agents in parallel',
    defaultData: {
      display_name: 'Arena',
      promote_strategy: 'manual',
      apply_strategy: 'diff_apply',
      attempts: [
        {
          id: 'attempt-a',
          display_name: 'Attempt A',
          role_template_id: 'custom',
          prompt_template: '',
        },
        {
          id: 'attempt-b',
          display_name: 'Attempt B',
          role_template_id: 'custom',
          prompt_template: '',
        },
      ],
    },
  },
];

export function createDefaultNodeData(
  kind: WorkflowNodeKind
): WorkflowNodeData {
  const entry = WORKFLOW_NODE_CATALOG.find((e) => e.type === kind);
  if (!entry) {
    return { display_name: kind };
  }
  // Deep clone to prevent mutating catalog defaults
  return JSON.parse(JSON.stringify(entry.defaultData)) as WorkflowNodeData;
}

export function getWorkflowNodeCatalogSections(): WorkflowNodeCatalogSection[] {
  const entryByType = new Map(
    WORKFLOW_NODE_CATALOG.map((entry) => [entry.type, entry])
  );
  const sections: Array<{ label: string; types: WorkflowNodeKind[] }> = [
    { label: 'Entry', types: ['start', 'end'] },
    { label: 'AI', types: ['agent', 'arena'] },
    { label: 'Control', types: ['condition', 'human_gate', 'transform'] },
  ];

  return sections.map((section) => ({
    label: section.label,
    entries: section.types
      .map((type) => entryByType.get(type))
      .filter((entry): entry is CatalogEntry => Boolean(entry)),
  }));
}
