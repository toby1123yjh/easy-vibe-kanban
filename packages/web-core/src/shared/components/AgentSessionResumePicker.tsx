import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckIcon,
  ClockCounterClockwiseIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { BaseCodingAgent, ResumableAgentSession } from 'shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vibe/ui/components/Dropdown';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import { cn } from '@/shared/lib/utils';
import { sessionsApi, type NativeAgentSessionPreview } from '@/shared/lib/api';

interface AgentSessionResumePickerProps {
  scopePath?: string;
  executor: BaseCodingAgent | null;
  selectedSessionId?: string | null;
  disabled?: boolean;
  onSelect: (session: ResumableAgentSession) => void;
}

interface AgentSessionResumeChipProps {
  session: ResumableAgentSession;
  onClear: () => void;
}

const RECENT_DAYS = 3;
const EXTENDED_DAYS = 30;
const RECENT_LIMIT = 10;
const PREVIEW_TURNS = 20;

function formatResumeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AgentSessionResumePicker({
  scopePath,
  executor,
  selectedSessionId,
  disabled,
  onSelect,
}: AgentSessionResumePickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(RECENT_DAYS);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(
    selectedSessionId ?? null
  );
  const normalizedScopePath = scopePath?.trim() || undefined;
  const canLoad = Boolean(executor && normalizedScopePath);

  useEffect(() => {
    setDays(RECENT_DAYS);
    setPreviewSessionId(selectedSessionId ?? null);
  }, [normalizedScopePath, executor, selectedSessionId]);

  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: [
      'agent-session-resume',
      normalizedScopePath,
      executor,
      days,
      RECENT_LIMIT,
    ],
    queryFn: () =>
      sessionsApi.getResumable({
        scopePath: normalizedScopePath,
        executor: executor!,
        days,
        limit: RECENT_LIMIT,
      }),
    enabled: open && canLoad,
    staleTime: 30_000,
  });

  const { data: discoveryState } = useQuery({
    queryKey: ['agent-session-resume-state', executor],
    queryFn: () =>
      sessionsApi.getResumableDiscoveryState({ executor: executor! }),
    enabled: open && Boolean(executor),
    staleTime: 60_000,
  });

  const sessions = useMemo(() => data ?? [], [data]);
  useEffect(() => {
    if (!open) return;
    if (selectedSessionId) {
      setPreviewSessionId(selectedSessionId);
      return;
    }
    setPreviewSessionId((current) => {
      if (current && sessions.some((s) => s.agent_session_id === current)) {
        return current;
      }
      return sessions[0]?.agent_session_id ?? null;
    });
  }, [open, selectedSessionId, sessions]);

  const {
    data: preview,
    isLoading: isPreviewLoading,
    isError: isPreviewError,
    isFetching: isPreviewFetching,
  } = useQuery({
    queryKey: [
      'agent-session-native-preview',
      normalizedScopePath,
      executor,
      previewSessionId,
      PREVIEW_TURNS,
    ],
    queryFn: () =>
      sessionsApi.getNativePreview({
        scopePath: normalizedScopePath,
        executor: executor!,
        sessionId: previewSessionId!,
        turns: PREVIEW_TURNS,
      }),
    enabled: open && canLoad && Boolean(previewSessionId),
    staleTime: 30_000,
  });

  const triggerLabel = t('agentSessionResume.open', {
    defaultValue: 'Recent agent sessions',
  });
  const sessionListState =
    discoveryState === 'unsupported'
      ? 'unsupported'
      : sessions.length === 0 && (isLoading || isFetching)
        ? 'loading'
        : sessions.length === 0 && isError
          ? 'error'
          : sessions.length === 0
            ? 'empty'
            : 'ready';
  const compactStateClassName =
    'mx-half my-half rounded-sm border border-border bg-secondary';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || !canLoad}
          title={triggerLabel}
          aria-label={triggerLabel}
          className={cn(
            'flex items-center justify-center rounded-sm border border-border bg-secondary p-half text-low',
            'hover:text-normal focus:outline-none focus-visible:ring-1 focus-visible:ring-brand',
            (disabled || !canLoad) &&
              'cursor-not-allowed opacity-40 hover:text-low'
          )}
        >
          <ClockCounterClockwiseIcon className="size-icon-base" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          {t(
            days === RECENT_DAYS
              ? 'agentSessionResume.recentLabel'
              : 'agentSessionResume.extendedLabel',
            {
              defaultValue:
                days === RECENT_DAYS ? 'Last 3 days' : 'Last 30 days',
            }
          )}
        </DropdownMenuLabel>

        <DropdownMenuLabel className="pt-0 text-xs font-normal">
          {t('agentSessionResume.sourceHint', {
            defaultValue: "Loaded from the agent's native resume history",
          })}
        </DropdownMenuLabel>

        {sessionListState === 'loading' && (
          <LoadingState
            compact
            className={compactStateClassName}
            title={t('agentSessionResume.loading', {
              defaultValue: 'Loading sessions...',
            })}
          />
        )}

        {sessionListState === 'error' && (
          <>
            <ErrorState
              compact
              className={compactStateClassName}
              title={t('agentSessionResume.error', {
                defaultValue: 'Failed to load sessions',
              })}
              description={t('agentSessionResume.errorHint', {
                defaultValue:
                  'The agent history could not be read from this machine.',
              })}
            />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void refetchSessions();
              }}
            >
              {t('agentSessionResume.retry', {
                defaultValue: 'Try again',
              })}
            </DropdownMenuItem>
          </>
        )}

        {sessionListState === 'unsupported' && (
          <DegradedState
            compact
            className={compactStateClassName}
            title={t('agentSessionResume.unsupported', {
              defaultValue:
                'Native session discovery is not available for this agent',
            })}
          />
        )}

        {sessionListState === 'empty' && (
          <EmptyState
            compact
            className={compactStateClassName}
            title={t('agentSessionResume.empty', {
              defaultValue: 'No recent sessions',
            })}
          />
        )}

        {sessionListState === 'ready' &&
          sessions.map((session) => (
            <DropdownMenuItem
              key={session.agent_session_id}
              icon={
                selectedSessionId === session.agent_session_id
                  ? CheckIcon
                  : undefined
              }
              badge={
                <span className="whitespace-nowrap text-xs text-low">
                  {formatResumeTime(session.last_used_at)}
                </span>
              }
              onFocus={() => setPreviewSessionId(session.agent_session_id)}
              onPointerMove={() =>
                setPreviewSessionId(session.agent_session_id)
              }
              onClick={() => onSelect(session)}
            >
              {session.title}
            </DropdownMenuItem>
          ))}

        {sessionListState === 'ready' && (
          <NativeSessionPreviewPanel
            preview={preview ?? null}
            isLoading={isPreviewLoading || (isPreviewFetching && !preview)}
            isError={isPreviewError && !preview}
          />
        )}

        {days === RECENT_DAYS &&
          (sessionListState === 'ready' || sessionListState === 'empty') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setDays(EXTENDED_DAYS);
                }}
              >
                {t('agentSessionResume.more', {
                  defaultValue: 'Show last 30 days',
                })}
              </DropdownMenuItem>
            </>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NativeSessionPreviewPanel({
  preview,
  isLoading,
  isError,
}: {
  preview: NativeAgentSessionPreview | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation('common');

  return (
    <>
      <DropdownMenuSeparator />
      <div className="mx-half max-h-72 overflow-y-auto px-half py-half">
        <div className="mb-half text-xs font-medium text-low">
          {t('agentSessionResume.previewLabel', {
            defaultValue: 'Recent context',
          })}
        </div>
        {isLoading && (
          <LoadingState
            compact
            title={t('agentSessionResume.previewLoading', {
              defaultValue: 'Loading preview...',
            })}
          />
        )}
        {!isLoading && isError && (
          <ErrorState
            compact
            title={t('agentSessionResume.previewError', {
              defaultValue: 'Preview unavailable',
            })}
            description={t('agentSessionResume.previewErrorHint', {
              defaultValue:
                'You can still resume this session without the preview.',
            })}
          />
        )}
        {!isLoading &&
          !isError &&
          (!preview || preview.entries.length === 0) && (
            <EmptyState
              compact
              title={t('agentSessionResume.previewEmpty', {
                defaultValue: 'No preview available',
              })}
            />
          )}
        {!isLoading &&
          !isError &&
          preview?.entries.map((entry, index) => (
            <div
              key={`${entry.role}:${index}:${entry.timestamp ?? ''}`}
              className="mb-half last:mb-0"
            >
              <div className="mb-[2px] text-[11px] uppercase text-low">
                {entry.role === 'assistant'
                  ? t('agentSessionResume.previewAssistant', {
                      defaultValue: 'Assistant',
                    })
                  : t('agentSessionResume.previewUser', {
                      defaultValue: 'User',
                    })}
              </div>
              <div className="whitespace-pre-wrap break-words rounded-sm bg-secondary px-half py-half text-xs leading-relaxed text-normal">
                {entry.content}
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

export function AgentSessionResumeChip({
  session,
  onClear,
}: AgentSessionResumeChipProps) {
  const { t } = useTranslation('common');
  const label = useMemo(
    () =>
      t('agentSessionResume.pending', {
        title: session.title,
        time: formatResumeTime(session.last_used_at),
        defaultValue: 'Will resume: {{title}} - {{time}}',
      }),
    [session.last_used_at, session.title, t]
  );

  return (
    <span
      className="inline-flex max-w-[280px] items-center gap-half rounded-sm border border-brand/30 bg-brand/10 px-half py-[3px] text-xs text-normal"
      title={label}
    >
      <ClockCounterClockwiseIcon
        className="size-icon-xs shrink-0 text-brand"
        weight="bold"
      />
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 text-low hover:text-normal"
        aria-label={t('agentSessionResume.clear', {
          defaultValue: 'Clear resume session',
        })}
      >
        <XIcon className="size-icon-xs" weight="bold" />
      </button>
    </span>
  );
}
