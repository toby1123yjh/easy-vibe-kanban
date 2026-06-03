import type { WorkflowNodeKind, WorkflowNodeData } from './workflowGraph';

export interface CatalogEntry {
  type: WorkflowNodeKind;
  label: string;
  description: string;
  defaultData: WorkflowNodeData;
}

export interface WorkflowNodeCatalogSection {
  id: 'execution' | 'control' | 'structure';
  label: string;
  labelKey: string;
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
    description: 'Agentic routing across connected branches',
    defaultData: {
      display_name: 'Condition',
      routing_mode: 'single',
      branches: [],
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
  const sections: Array<{
    id: WorkflowNodeCatalogSection['id'];
    label: string;
    labelKey: string;
    types: WorkflowNodeKind[];
  }> = [
    {
      id: 'execution',
      label: 'Execution',
      labelKey: 'workflow.editor.sections.execution',
      types: ['agent'],
    },
    {
      id: 'control',
      label: 'Control',
      labelKey: 'workflow.editor.sections.control',
      types: ['condition', 'human_gate'],
    },
    {
      id: 'structure',
      label: 'Structure',
      labelKey: 'workflow.editor.sections.structure',
      types: ['start', 'end'],
    },
  ];

  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    labelKey: section.labelKey,
    entries: section.types
      .map((type) => entryByType.get(type))
      .filter((entry): entry is CatalogEntry => Boolean(entry)),
  }));
}
