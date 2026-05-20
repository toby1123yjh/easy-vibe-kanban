import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

function shortId(value: string | null, fallback: string): string {
  return value ? value.slice(0, 8) : fallback;
}

function formatNodeStatusLabel(label: string, t: TFunction<'common'>): string {
  switch (label) {
    case 'awaiting human':
      return t('workflow.nodeStatus.awaitingHuman');
    case 'awaiting arena':
      return t('workflow.nodeStatus.awaitingArena');
    case 'pending':
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'skipped':
      return t(`workflow.nodeStatus.${label}`);
    default:
      return label;
  }
}

export function WorkflowAgentSessionsList({
  rows,
  workspaceHref,
  compact = false,
}: WorkflowAgentSessionsListProps) {
  const { t } = useTranslation('common');
  const emptyIdLabel = t('workflow.dashboard.none');

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-low">
          {t('workflow.agentSessions.title')}
        </h3>
        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-low">
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-secondary bg-primary/50 p-3 text-xs text-low">
          {t('workflow.agentSessions.none')}
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
                        {t('workflow.agentSessions.session', {
                          id: shortId(row.sessionId, emptyIdLabel),
                        })}
                      </span>
                      <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] capitalize text-low">
                        {formatNodeStatusLabel(row.statusLabel, t)}
                      </span>
                    </div>
                    <div className="mt-1 grid gap-1 text-[11px] text-low">
                      <span>
                        {t('workflow.agentSessions.run', {
                          id: shortId(row.runId, emptyIdLabel),
                        })}
                      </span>
                      <span>
                        {t('workflow.agentSessions.process', {
                          id: shortId(row.executionProcessId, emptyIdLabel),
                        })}
                      </span>
                      <span>
                        {formatSessionStartedLabel(row.startedLabel, t)} /{' '}
                        {formatSessionDurationLabel(row.durationLabel, t)}
                      </span>
                    </div>
                  </div>

                  {sessionHref ? (
                    <a
                      href={sessionHref}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-secondary px-2 py-1 text-[11px] font-medium text-brand hover:bg-secondary/60"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t('workflow.agentSessions.open')}
                    </a>
                  ) : null}
                </div>

                <p
                  className={cn(
                    'mt-2 whitespace-pre-wrap rounded bg-panel px-2 py-1.5 font-mono text-[11px] text-high',
                    compact ? 'line-clamp-3' : 'max-h-28 overflow-auto'
                  )}
                >
                  {row.outputPreview === 'No output yet'
                    ? t('workflow.agentSessions.noOutputYet')
                    : row.outputPreview}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatSessionStartedLabel(
  label: string,
  t: TFunction<'common'>
): string {
  return label === 'Not started' ? t('workflow.dashboard.notStarted') : label;
}

function formatSessionDurationLabel(
  label: string,
  t: TFunction<'common'>
): string {
  return label === 'Not started' ? t('workflow.dashboard.notStarted') : label;
}
