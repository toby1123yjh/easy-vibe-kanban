import type { WorkflowNodeData, WorkflowNodeKind } from './workflowGraph';

export type WorkflowNodeFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'condition_rules'
  | 'condition_branches'
  | 'arena_attempts';

export interface WorkflowNodeFieldOption {
  label: string;
  value: string;
}

export interface WorkflowNodeFieldSchema {
  key: keyof WorkflowNodeData;
  type: WorkflowNodeFieldType;
  label: string;
  options?: WorkflowNodeFieldOption[];
  rows?: number;
}

export interface WorkflowNodeSchema {
  type: WorkflowNodeKind;
  label: string;
  fields: WorkflowNodeFieldSchema[];
}

export const WORKFLOW_NODE_SCHEMAS: Record<
  WorkflowNodeKind,
  WorkflowNodeSchema
> = {
  start: {
    type: 'start',
    label: 'Start Step',
    fields: [{ key: 'display_name', type: 'text', label: 'Display Name' }],
  },
  end: {
    type: 'end',
    label: 'End Step',
    fields: [{ key: 'display_name', type: 'text', label: 'Display Name' }],
  },
  agent: {
    type: 'agent',
    label: 'Agent Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      { key: 'role_template_id', type: 'text', label: 'Role Template ID' },
      {
        key: 'prompt_template',
        type: 'textarea',
        label: 'Prompt Template',
        rows: 4,
      },
    ],
  },
  condition: {
    type: 'condition',
    label: 'Condition Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      {
        key: 'joiner',
        type: 'select',
        label: 'Joiner',
        options: [
          { label: 'AND', value: 'and' },
          { label: 'OR', value: 'or' },
        ],
      },
      { key: 'conditions', type: 'condition_rules', label: 'Rules' },
      { key: 'branches', type: 'condition_branches', label: 'Branches' },
    ],
  },
  human_gate: {
    type: 'human_gate',
    label: 'Human Gate Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      {
        key: 'prompt_to_human',
        type: 'textarea',
        label: 'Prompt to Human',
        rows: 3,
      },
      {
        key: 'required_action',
        type: 'select',
        label: 'Required Action',
        options: [
          { label: 'Approve Only', value: 'approve' },
          { label: 'Approve or Reject', value: 'approve_or_reject' },
        ],
      },
    ],
  },
  transform: {
    type: 'transform',
    label: 'Transform Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        options: [
          { label: 'Template', value: 'template' },
          { label: 'Regex Extract', value: 'regex_extract' },
          { label: 'Truncate', value: 'truncate' },
        ],
      },
      { key: 'template', type: 'textarea', label: 'Template', rows: 3 },
      { key: 'regex', type: 'text', label: 'Regex' },
      { key: 'max_chars', type: 'number', label: 'Max Chars' },
    ],
  },
  arena: {
    type: 'arena',
    label: 'Arena Step',
    fields: [
      { key: 'display_name', type: 'text', label: 'Display Name' },
      {
        key: 'prompt_template',
        type: 'textarea',
        label: 'Prompt Template',
        rows: 4,
      },
      { key: 'attempts', type: 'arena_attempts', label: 'Attempts' },
    ],
  },
};

export function getWorkflowNodeSchema(
  type: WorkflowNodeKind
): WorkflowNodeSchema {
  return WORKFLOW_NODE_SCHEMAS[type];
}

export function getWorkflowNodeSchemaFields(
  type: WorkflowNodeKind
): WorkflowNodeFieldSchema[] {
  return getWorkflowNodeSchema(type).fields;
}
