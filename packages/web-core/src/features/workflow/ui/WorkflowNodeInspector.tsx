import type { WorkflowNode, WorkflowNodeData } from '../model/workflowGraph';
import { getWorkflowNodeKindLabel } from '../model/workflowPresentation';
import { getWorkflowNodeIcon } from './workflowNodeIcons';
import { Plus, Trash2 } from 'lucide-react';

export interface WorkflowNodeInspectorProps {
  node: WorkflowNode | null;
  readOnly?: boolean;
  onChange?: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
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
            {getWorkflowNodeKindLabel(type)} Step
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-high">Display Name</label>
        <input
          type="text"
          className={inputClass}
          value={data.display_name ?? ''}
          onChange={(e) => handleChange('display_name', e.target.value)}
          disabled={readOnly}
        />
      </div>

      {type === 'agent' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">
              Role Template ID
            </label>
            <input
              type="text"
              className={inputClass}
              value={data.role_template_id ?? ''}
              onChange={(e) => handleChange('role_template_id', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">
              Prompt Template
            </label>
            <textarea
              className={inputClass}
              rows={4}
              value={data.prompt_template ?? ''}
              onChange={(e) => handleChange('prompt_template', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">
              Output Capture
            </label>
            <select
              className={inputClass}
              value={data.output_capture ?? 'last_message'}
              onChange={(e) => handleChange('output_capture', e.target.value)}
              disabled={readOnly}
            >
              <option value="last_message">Last Message</option>
              <option value="full_text">Full Text</option>
              <option value="diff_summary">Diff Summary</option>
            </select>
          </div>
        </>
      )}

      {type === 'condition' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">Joiner</label>
            <select
              className={inputClass}
              value={data.joiner ?? 'and'}
              onChange={(e) => handleChange('joiner', e.target.value)}
              disabled={readOnly}
            >
              <option value="and">AND</option>
              <option value="or">OR</option>
            </select>
          </div>
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
        </>
      )}

      {type === 'human_gate' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">
              Prompt to Human
            </label>
            <input
              type="text"
              className={inputClass}
              value={data.prompt_to_human ?? ''}
              onChange={(e) => handleChange('prompt_to_human', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">
              Required Action
            </label>
            <select
              className={inputClass}
              value={data.required_action ?? 'approve_or_reject'}
              onChange={(e) => handleChange('required_action', e.target.value)}
              disabled={readOnly}
            >
              <option value="approve">Approve Only</option>
              <option value="approve_or_reject">Approve or Reject</option>
            </select>
          </div>
        </>
      )}

      {type === 'transform' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">Mode</label>
            <select
              className={inputClass}
              value={data.mode ?? 'template'}
              onChange={(e) => handleChange('mode', e.target.value)}
              disabled={readOnly}
            >
              <option value="template">Template</option>
              <option value="regex_extract">Regex Extract</option>
              <option value="truncate">Truncate</option>
            </select>
          </div>
          {data.mode === 'template' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-high">
                Template
              </label>
              <textarea
                className={inputClass}
                rows={3}
                value={data.template ?? ''}
                onChange={(e) => handleChange('template', e.target.value)}
                disabled={readOnly}
              />
            </div>
          )}
          {data.mode === 'regex_extract' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-high">Regex</label>
              <input
                type="text"
                className={inputClass}
                value={data.regex ?? ''}
                onChange={(e) => handleChange('regex', e.target.value)}
                disabled={readOnly}
              />
            </div>
          )}
          {data.mode === 'truncate' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-high">
                Max Chars
              </label>
              <input
                type="number"
                className={inputClass}
                value={data.max_chars ?? 1000}
                onChange={(e) =>
                  handleChange('max_chars', parseInt(e.target.value, 10))
                }
                disabled={readOnly}
              />
            </div>
          )}
        </>
      )}

      {type === 'arena' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-high">
              Prompt Template
            </label>
            <textarea
              className={inputClass}
              rows={4}
              value={data.prompt_template ?? ''}
              onChange={(e) => handleChange('prompt_template', e.target.value)}
              disabled={readOnly}
            />
          </div>
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
