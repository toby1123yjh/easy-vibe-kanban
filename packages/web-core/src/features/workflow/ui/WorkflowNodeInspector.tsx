import type {
  WorkflowNode,
  WorkflowNodeData,
  WorkflowNodeKind,
} from '../model/workflowGraph';
import {
  getWorkflowNodeSchema,
  type WorkflowNodeFieldSchema,
} from '../model/workflowNodeSchemas';
import { WorkflowNodeFieldRenderer } from './WorkflowNodeFieldRenderer';
import { getWorkflowNodeIcon } from './workflowNodeIcons';
import { Plus, Trash2 } from 'lucide-react';

export interface WorkflowNodeInspectorProps {
  node: WorkflowNode | null;
  readOnly?: boolean;
  onChange?: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
}

const simpleFieldTypes = new Set(['text', 'textarea', 'select', 'number']);

function isSimpleField(field: WorkflowNodeFieldSchema) {
  return simpleFieldTypes.has(field.type);
}

function shouldRenderSimpleField(
  type: WorkflowNodeKind,
  data: WorkflowNodeData,
  field: WorkflowNodeFieldSchema
) {
  if (type !== 'transform') {
    return true;
  }

  if (field.key === 'template') {
    return (data.mode ?? 'template') === 'template';
  }
  if (field.key === 'regex') {
    return data.mode === 'regex_extract';
  }
  if (field.key === 'max_chars') {
    return data.mode === 'truncate';
  }
  return true;
}

export function WorkflowNodeInspector({
  node,
  readOnly,
  onChange,
}: WorkflowNodeInspectorProps) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-base text-center text-low text-sm">
        Select a node to inspect
      </div>
    );
  }

  const handleChange = (key: keyof WorkflowNodeData, value: unknown) => {
    if (readOnly || !onChange) return;
    onChange(node.id, { [key]: value });
  };

  const { data, type } = node;
  const Icon = getWorkflowNodeIcon(type);
  const schema = getWorkflowNodeSchema(type);
  const schemaFields = schema.fields;
  const simpleFields = schemaFields
    .filter(isSimpleField)
    .filter((field) => shouldRenderSimpleField(type, data, field));
  const hasConditionRules = schemaFields.some(
    (field) => field.type === 'condition_rules'
  );
  const hasConditionBranches = schemaFields.some(
    (field) => field.type === 'condition_branches'
  );
  const hasArenaAttempts = schemaFields.some(
    (field) => field.type === 'arena_attempts'
  );
  const conditions = data.conditions ?? [];
  const branches = data.branches ?? [];
  const attempts = data.attempts ?? [];

  const inputClass =
    'w-full rounded-md border border-secondary bg-primary px-3 py-1.5 text-sm shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50';
  const secondaryButtonClass =
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-secondary bg-primary px-2.5 text-xs font-medium text-high shadow-sm transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50';
  const iconButtonClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-secondary bg-primary text-low shadow-sm transition-colors hover:border-error/70 hover:text-error disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-panel/50 p-5 text-sm">
      <div className="mb-2 flex items-center gap-3 border-b border-secondary pb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-secondary/40 bg-secondary/20 shadow-sm">
          <Icon className="h-4 w-4 text-high" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-low">
            Step
          </span>
          <span className="text-sm font-semibold text-high">
            {schema.label}
          </span>
        </div>
      </div>

      {simpleFields.map((field) => (
        <WorkflowNodeFieldRenderer
          key={String(field.key)}
          data={data}
          field={field}
          inputClassName={inputClass}
          readOnly={readOnly}
          onChange={handleChange}
        />
      ))}

      {type === 'condition' && (hasConditionRules || hasConditionBranches) && (
        <>
          {hasConditionRules ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-high">Rules</label>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={readOnly}
                  onClick={() =>
                    handleChange('conditions', [
                      ...conditions,
                      {
                        input: '{{input}}',
                        operator: 'contains',
                        value: '',
                      },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add rule
                </button>
              </div>
              {conditions.map((condition, index) => (
                <div
                  key={condition.id ?? index}
                  className="flex flex-col gap-2 rounded-md border border-secondary/60 bg-primary/50 p-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-high">
                      Rule {index + 1}
                    </label>
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={`Remove rule ${index + 1}`}
                      disabled={readOnly}
                      onClick={() =>
                        handleChange(
                          'conditions',
                          conditions.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Input"
                    className={inputClass}
                    value={condition.input ?? ''}
                    onChange={(e) => {
                      const newConditions = [...conditions];
                      newConditions[index] = {
                        ...newConditions[index],
                        input: e.target.value,
                      };
                      handleChange('conditions', newConditions);
                    }}
                    disabled={readOnly}
                  />
                  <select
                    className={inputClass}
                    value={condition.operator ?? 'contains'}
                    onChange={(e) => {
                      const newConditions = [...conditions];
                      newConditions[index] = {
                        ...newConditions[index],
                        operator: e.target
                          .value as import('../model/workflowGraph').ConditionOperator,
                      };
                      handleChange('conditions', newConditions);
                    }}
                    disabled={readOnly}
                  >
                    <option value="contains">Contains</option>
                    <option value="equals">Equals</option>
                    <option value="not_equals">Not Equals</option>
                    <option value="regex">Regex</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Value"
                    className={inputClass}
                    value={condition.value ?? ''}
                    onChange={(e) => {
                      const newConditions = [...conditions];
                      newConditions[index] = {
                        ...newConditions[index],
                        value: e.target.value,
                      };
                      handleChange('conditions', newConditions);
                    }}
                    disabled={readOnly}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {hasConditionBranches ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-high">
                  Branches
                </label>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={readOnly}
                  onClick={() =>
                    handleChange('branches', [
                      ...branches,
                      { name: `branch-${branches.length + 1}` },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add branch
                </button>
              </div>
              {branches.map((branch, index) => (
                <div
                  key={`${branch.name ?? 'branch'}-${index}`}
                  className="flex items-center gap-2 rounded-md border border-secondary/60 bg-primary/50 p-2 shadow-sm"
                >
                  <input
                    type="text"
                    aria-label={`Branch ${index + 1} name`}
                    className={inputClass}
                    value={branch.name ?? ''}
                    onChange={(e) => {
                      const newBranches = [...branches];
                      newBranches[index] = {
                        ...newBranches[index],
                        name: e.target.value,
                      };
                      handleChange('branches', newBranches);
                    }}
                    disabled={readOnly}
                  />
                  <button
                    type="button"
                    className={iconButtonClass}
                    aria-label={`Remove branch ${index + 1}`}
                    disabled={readOnly || branches.length <= 1}
                    onClick={() =>
                      handleChange(
                        'branches',
                        branches.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {type === 'arena' && hasArenaAttempts && (
        <>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-high">Attempts</label>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={readOnly}
              onClick={() =>
                handleChange('attempts', [
                  ...attempts,
                  {
                    id: `attempt-${attempts.length + 1}`,
                    display_name: `Attempt ${attempts.length + 1}`,
                    role_template_id: 'custom',
                    prompt_template: '',
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add attempt
            </button>
          </div>
          {attempts.map((attempt, i) => (
            <div
              key={attempt.id ?? i}
              className="mt-2 flex flex-col gap-2 rounded-md border border-secondary/60 bg-primary/50 p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-high">
                  {attempt.display_name ?? `Attempt ${i + 1}`}
                </label>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`Remove attempt ${i + 1}`}
                  disabled={readOnly || attempts.length <= 1}
                  onClick={() =>
                    handleChange(
                      'attempts',
                      attempts.filter((_, index) => index !== i)
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Display Name"
                className={inputClass}
                value={attempt.display_name ?? ''}
                onChange={(e) => {
                  const newAttempts = [...attempts];
                  newAttempts[i] = {
                    ...newAttempts[i],
                    display_name: e.target.value,
                  };
                  handleChange('attempts', newAttempts);
                }}
                disabled={readOnly}
              />
              <input
                type="text"
                placeholder="Role Template ID"
                className={inputClass}
                value={attempt.role_template_id ?? ''}
                onChange={(e) => {
                  const newAttempts = [...attempts];
                  newAttempts[i] = {
                    ...newAttempts[i],
                    role_template_id: e.target.value,
                  };
                  handleChange('attempts', newAttempts);
                }}
                disabled={readOnly}
              />
              <textarea
                placeholder="Prompt Template Override"
                className={inputClass}
                rows={2}
                value={attempt.prompt_template ?? ''}
                onChange={(e) => {
                  const newAttempts = [...attempts];
                  newAttempts[i] = {
                    ...newAttempts[i],
                    prompt_template: e.target.value,
                  };
                  handleChange('attempts', newAttempts);
                }}
                disabled={readOnly}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
