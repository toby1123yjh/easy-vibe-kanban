import { cn } from '@/shared/lib/utils';
import type { WorkflowNodeDebugView } from '../model/workflowRunView';

export function WorkflowRunDebugPanel({
  debug,
}: {
  debug: WorkflowNodeDebugView | null;
}) {
  if (!debug) {
    return <div className="text-sm text-low">No debug data for this step.</div>;
  }

  return (
    <div data-testid="workflow-node-debug-panel" className="space-y-base">
      <DebugBlock title="Run Input" value={debug.rawInput} />
      <DebugBlock title="Prompt Template" value={debug.promptTemplate} />
      <DebugBlock title="Rendered Prompt" value={debug.renderedPrompt} />
      <div>
        <h3 className="mb-half text-xs font-semibold uppercase text-low">
          Upstream Outputs
        </h3>
        <div className="space-y-half">
          {debug.upstreamOutputs.length === 0 ? (
            <p className="text-xs text-low">No upstream output.</p>
          ) : (
            debug.upstreamOutputs.map((output) => (
              <DebugBlock
                key={output.nodeId}
                title={output.nodeId}
                value={output.outputText}
              />
            ))
          )}
        </div>
      </div>
      <DebugBlock title="Output" value={debug.outputText} />
      {debug.errorText ? (
        <DebugBlock title="Error" value={debug.errorText} tone="danger" />
      ) : null}
      <DebugBlock title="Session ID" value={debug.sessionId} />
      <DebugBlock title="Process ID" value={debug.executionProcessId} />
    </div>
  );
}

function DebugBlock({
  title,
  value,
  tone = 'normal',
}: {
  title: string;
  value: string | null;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div>
      <h3
        className={cn(
          'mb-half text-xs font-semibold uppercase',
          tone === 'danger' ? 'text-error' : 'text-low'
        )}
      >
        {title}
      </h3>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap rounded border p-half text-xs',
          tone === 'danger'
            ? 'border-error/50 bg-error/10 text-error'
            : 'border-secondary bg-primary text-high'
        )}
      >
        {value || `No ${title.toLowerCase()}.`}
      </pre>
    </div>
  );
}
