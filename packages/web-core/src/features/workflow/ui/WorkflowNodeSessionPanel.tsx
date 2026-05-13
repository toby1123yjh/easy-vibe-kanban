import type { WorkflowNodeExecutionResponse } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';

export function WorkflowNodeSessionPanel({
  execution,
  sessionHref,
  workspaceHref,
}: {
  execution: WorkflowNodeExecutionResponse;
  sessionHref: string | null;
  workspaceHref: string | null;
}) {
  return (
    <div
      data-testid="workflow-node-session-panel"
      className="flex min-h-full flex-col gap-base"
    >
      <div className="rounded border border-secondary bg-primary p-half">
        <div className="flex items-start justify-between gap-base">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-high">Agent Session</h3>
            <p
              data-testid="workflow-node-session-id"
              className="mt-1 truncate text-xs text-low"
            >
              Session: {execution.session_id ?? 'Not started'}
            </p>
            <p className="truncate text-xs text-low">
              Process: {execution.execution_process_id ?? 'Not started'}
            </p>
          </div>
          {sessionHref ? (
            <Button asChild size="xs" variant="outline">
              <a href={sessionHref}>Open in workspace</a>
            </Button>
          ) : workspaceHref ? (
            <Button asChild size="xs" variant="outline">
              <a href={workspaceHref}>Open workspace</a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded border border-secondary bg-primary p-half">
        <h3 className="text-xs font-semibold uppercase text-low">
          Conversation
        </h3>
        <pre className="mt-half whitespace-pre-wrap text-xs text-high">
          {execution.output_text || 'No agent response has been captured yet.'}
        </pre>
      </div>

      <div className="rounded border border-secondary bg-primary p-half">
        <h3 className="text-xs font-semibold uppercase text-low">
          Node Prompt
        </h3>
        <pre className="mt-half whitespace-pre-wrap text-xs text-high">
          {execution.input_text || 'No prompt has been captured yet.'}
        </pre>
      </div>

      {execution.error_text ? (
        <div className="rounded border border-error/50 bg-error/10 p-half">
          <h3 className="text-xs font-semibold uppercase text-error">Error</h3>
          <pre className="mt-half whitespace-pre-wrap text-xs text-error">
            {execution.error_text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
