import { ExternalLink } from 'lucide-react';
import {
  buildWorkspaceSessionHref,
  type AgentSessionRow,
} from '../model/workflowRunView';
import { cn } from '@/shared/lib/utils';

interface WorkflowAgentSessionsListProps {
  rows: AgentSessionRow[];
  workspaceHref?: string | null;
  compact?: boolean;
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : 'none';
}

export function WorkflowAgentSessionsList({
  rows,
  workspaceHref,
  compact = false,
}: WorkflowAgentSessionsListProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-low">
          Agent Sessions
        </h3>
        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-low">
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-secondary bg-primary/50 p-3 text-xs text-low">
          This Agent Step has not created a Session in this run yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-secondary bg-primary">
          {rows.map((row) => {
            const sessionHref = buildWorkspaceSessionHref(
              workspaceHref,
              row.sessionId
            );

            return (
              <div
                key={`${row.runId}-${row.nodeId}-${row.sessionId ?? 'pending'}-${row.executionProcessId ?? 'process'}`}
                className="border-b border-secondary/70 p-3 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-high">
                        Session {shortId(row.sessionId)}
                      </span>
                      <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] capitalize text-low">
                        {row.statusLabel}
                      </span>
                    </div>
                    <div className="mt-1 grid gap-1 text-[11px] text-low">
                      <span>Run {shortId(row.runId)}</span>
                      <span>Process {shortId(row.executionProcessId)}</span>
                      <span>
                        {row.startedLabel} / {row.durationLabel}
                      </span>
                    </div>
                  </div>

                  {sessionHref ? (
                    <a
                      href={sessionHref}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-secondary px-2 py-1 text-[11px] font-medium text-brand hover:bg-secondary/60"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </a>
                  ) : null}
                </div>

                <p
                  className={cn(
                    'mt-2 whitespace-pre-wrap rounded bg-panel px-2 py-1.5 font-mono text-[11px] text-high',
                    compact ? 'line-clamp-3' : 'max-h-28 overflow-auto'
                  )}
                >
                  {row.outputPreview}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
