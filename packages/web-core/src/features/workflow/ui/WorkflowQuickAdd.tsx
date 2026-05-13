import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowNodeKind } from '../model/workflowGraph';
import { WORKFLOW_NODE_CATALOG } from '../model/workflowNodeCatalog';

export function WorkflowQuickAdd({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (type: WorkflowNodeKind) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const options = useMemo(
    () =>
      WORKFLOW_NODE_CATALOG.filter((item) =>
        `${item.label} ${item.description}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [query]
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Add workflow step"
      className="rounded-md border border-secondary bg-panel p-2 shadow-lg"
      style={{
        position: 'fixed',
        left: '50%',
        top: 80,
        zIndex: 10000,
        width: 320,
        transform: 'translateX(-50%)',
      }}
    >
      <input
        ref={inputRef}
        className="w-full rounded border border-secondary bg-primary px-3 py-2 text-sm text-high"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        placeholder="Search steps"
      />
      <div role="listbox" className="mt-2 max-h-64 overflow-auto">
        {options.map((item) => (
          <button
            key={item.type}
            type="button"
            role="option"
            aria-selected={false}
            className="block w-full rounded px-3 py-2 text-left text-sm text-high hover:bg-secondary"
            onClick={() => onSelect(item.type)}
          >
            {item.label} Step
          </button>
        ))}
      </div>
    </div>
  );
}
