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
import { cn } from '@/shared/lib/utils';
import { sessionsApi } from '@/shared/lib/api';

interface AgentSessionResumePickerProps {
  workspaceId?: string;
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
  workspaceId,
  scopePath,
  executor,
  selectedSessionId,
  disabled,
  onSelect,
}: AgentSessionResumePickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(RECENT_DAYS);
  const normalizedScopePath = scopePath?.trim() || undefined;
  const canLoad = Boolean(executor);

  useEffect(() => {
    setDays(RECENT_DAYS);
  }, [workspaceId, normalizedScopePath, executor]);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'agent-session-resume',
      workspaceId,
      normalizedScopePath,
      executor,
      days,
      RECENT_LIMIT,
    ],
    queryFn: () =>
      sessionsApi.getResumable({
        workspaceId,
        scopePath: normalizedScopePath,
        executor: executor!,
        days,
        limit: RECENT_LIMIT,
      }),
    enabled: open && canLoad,
    staleTime: 30_000,
  });

  const sessions = data ?? [];
  const triggerLabel = t('agentSessionResume.open', {
    defaultValue: 'Recent agent sessions',
  });

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

        {isLoading && (
          <DropdownMenuItem disabled>
            {t('agentSessionResume.loading', {
              defaultValue: 'Loading sessions...',
            })}
          </DropdownMenuItem>
        )}

        {isError && (
          <DropdownMenuItem disabled>
            {t('agentSessionResume.error', {
              defaultValue: 'Failed to load sessions',
            })}
          </DropdownMenuItem>
        )}

        {!isLoading && !isError && sessions.length === 0 && (
          <DropdownMenuItem disabled>
            {t('agentSessionResume.empty', {
              defaultValue: 'No recent sessions',
            })}
          </DropdownMenuItem>
        )}

        {!isLoading &&
          !isError &&
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
              onClick={() => onSelect(session)}
            >
              {session.title}
            </DropdownMenuItem>
          ))}

        {days === RECENT_DAYS && (
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
