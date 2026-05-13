import { useId } from 'react';
import type { WorkflowNodeData } from '../model/workflowGraph';
import type { WorkflowNodeFieldSchema } from '../model/workflowNodeSchemas';

interface WorkflowNodeFieldRendererProps {
  data: WorkflowNodeData;
  field: WorkflowNodeFieldSchema;
  inputClassName: string;
  readOnly?: boolean;
  onChange: (key: keyof WorkflowNodeData, value: unknown) => void;
}

export function WorkflowNodeFieldRenderer({
  data,
  field,
  inputClassName,
  readOnly,
  onChange,
}: WorkflowNodeFieldRendererProps) {
  const id = useId();
  const fieldId = `${id}-${String(field.key)}`;
  const value = data[field.key];

  if (field.type === 'textarea') {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-xs font-semibold text-high">
          {field.label}
        </label>
        <textarea
          id={fieldId}
          className={inputClassName}
          rows={field.rows ?? 3}
          value={String(value ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
          disabled={readOnly}
        />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-xs font-semibold text-high">
          {field.label}
        </label>
        <select
          id={fieldId}
          className={inputClassName}
          value={String(value ?? field.options?.[0]?.value ?? '')}
          onChange={(event) => onChange(field.key, event.target.value)}
          disabled={readOnly}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-xs font-semibold text-high">
          {field.label}
        </label>
        <input
          id={fieldId}
          type="number"
          className={inputClassName}
          value={Number(value ?? 1000)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            onChange(field.key, Number.isNaN(next) ? undefined : next);
          }}
          disabled={readOnly}
        />
      </div>
    );
  }

  if (field.type !== 'text') {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-xs font-semibold text-high">
        {field.label}
      </label>
      <input
        id={fieldId}
        type="text"
        className={inputClassName}
        value={String(value ?? '')}
        onChange={(event) => onChange(field.key, event.target.value)}
        disabled={readOnly}
      />
    </div>
  );
}
