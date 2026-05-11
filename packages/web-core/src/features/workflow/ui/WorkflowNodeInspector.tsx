import type { WorkflowNode, WorkflowNodeData } from '../model/workflowGraph';
import { getWorkflowNodeKindLabel } from '../model/workflowPresentation';
import { getWorkflowNodeIcon } from './workflowNodeIcons';

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

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 border-b border-secondary pb-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-secondary/20">
          <Icon className="h-4 w-4 text-high" />
        </div>
        <span className="font-semibold text-high">
          {getWorkflowNodeKindLabel(type)} Properties
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-semibold text-high">Display Name</label>
        <input
          type="text"
          className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
          value={data.display_name ?? ''}
          onChange={(e) => handleChange('display_name', e.target.value)}
          disabled={readOnly}
        />
      </div>

      {type === 'agent' && (
        <>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Role Template ID</label>
            <input
              type="text"
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
              value={data.role_template_id ?? ''}
              onChange={(e) => handleChange('role_template_id', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Prompt Template</label>
            <textarea
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
              rows={4}
              value={data.prompt_template ?? ''}
              onChange={(e) => handleChange('prompt_template', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Output Capture</label>
            <select
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
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
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Joiner</label>
            <select
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
              value={data.joiner ?? 'and'}
              onChange={(e) => handleChange('joiner', e.target.value)}
              disabled={readOnly}
            >
              <option value="and">AND</option>
              <option value="or">OR</option>
            </select>
          </div>
          {data.conditions && data.conditions.length > 0 && (
            <div className="flex flex-col gap-2 rounded border border-secondary p-2">
              <label className="font-semibold text-high">Rule 1</label>
              <input
                type="text"
                placeholder="Input"
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                value={data.conditions[0].input ?? ''}
                onChange={(e) => {
                  const newConditions = [...data.conditions!];
                  newConditions[0] = {
                    ...newConditions[0],
                    input: e.target.value,
                  };
                  handleChange('conditions', newConditions);
                }}
                disabled={readOnly}
              />
              <select
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                value={data.conditions[0].operator ?? 'contains'}
                onChange={(e) => {
                  const newConditions = [...data.conditions!];
                  newConditions[0] = {
                    ...newConditions[0],
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
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                value={data.conditions[0].value ?? ''}
                onChange={(e) => {
                  const newConditions = [...data.conditions!];
                  newConditions[0] = {
                    ...newConditions[0],
                    value: e.target.value,
                  };
                  handleChange('conditions', newConditions);
                }}
                disabled={readOnly}
              />
            </div>
          )}
        </>
      )}

      {type === 'human_gate' && (
        <>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Prompt to Human</label>
            <input
              type="text"
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
              value={data.prompt_to_human ?? ''}
              onChange={(e) => handleChange('prompt_to_human', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Required Action</label>
            <select
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
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
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Mode</label>
            <select
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
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
            <div className="flex flex-col gap-1">
              <label className="font-semibold text-high">Template</label>
              <textarea
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                rows={3}
                value={data.template ?? ''}
                onChange={(e) => handleChange('template', e.target.value)}
                disabled={readOnly}
              />
            </div>
          )}
          {data.mode === 'regex_extract' && (
            <div className="flex flex-col gap-1">
              <label className="font-semibold text-high">Regex</label>
              <input
                type="text"
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                value={data.regex ?? ''}
                onChange={(e) => handleChange('regex', e.target.value)}
                disabled={readOnly}
              />
            </div>
          )}
          {data.mode === 'truncate' && (
            <div className="flex flex-col gap-1">
              <label className="font-semibold text-high">Max Chars</label>
              <input
                type="number"
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
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
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-high">Prompt Template</label>
            <textarea
              className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
              rows={4}
              value={data.prompt_template ?? ''}
              onChange={(e) => handleChange('prompt_template', e.target.value)}
              disabled={readOnly}
            />
          </div>
          {data.attempts?.map((attempt, i) => (
            <div
              key={attempt.id ?? i}
              className="mt-2 flex flex-col gap-2 rounded border border-secondary p-2"
            >
              <label className="font-semibold text-high">
                {attempt.display_name ?? `Attempt ${i + 1}`}
              </label>
              <input
                type="text"
                placeholder="Display Name"
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                value={attempt.display_name ?? ''}
                onChange={(e) => {
                  const newAttempts = [...(data.attempts ?? [])];
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
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                value={attempt.role_template_id ?? ''}
                onChange={(e) => {
                  const newAttempts = [...(data.attempts ?? [])];
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
                className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
                rows={2}
                value={attempt.prompt_template ?? ''}
                onChange={(e) => {
                  const newAttempts = [...(data.attempts ?? [])];
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
