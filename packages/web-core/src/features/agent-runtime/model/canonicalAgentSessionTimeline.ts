import {
  AgentRunStatus,
  type AgentRunSummary,
  type RunState,
} from 'shared/types';
import type { CanonicalAgentTimeline } from './canonicalAgentTimeline';

export interface CanonicalAgentSessionRun {
  readonly summary: AgentRunSummary;
  readonly timeline: CanonicalAgentTimeline | null;
}

export interface CanonicalAgentSessionTimeline {
  readonly sessionId: string;
  readonly runs: readonly CanonicalAgentSessionRun[];
  readonly activeRun: CanonicalAgentSessionRun | null;
  readonly latestRun: CanonicalAgentSessionRun | null;
  readonly isRunning: boolean;
  readonly isTerminal: boolean;
  readonly projectionDegraded: boolean;
}

const TERMINAL_STATUSES = new Set<RunState['status']>([
  AgentRunStatus.succeeded,
  AgentRunStatus.failed,
  AgentRunStatus.cancelled,
  AgentRunStatus.crashed,
  AgentRunStatus.audit_failed,
]);

export function isCanonicalRunTerminal(state: RunState | null | undefined) {
  return Boolean(state && TERMINAL_STATUSES.has(state.status));
}

export function isCanonicalRunActive(state: RunState | null | undefined) {
  if (!state) return false;
  return (
    state.status === AgentRunStatus.pending ||
    state.status === AgentRunStatus.starting ||
    state.status === AgentRunStatus.running ||
    state.status === AgentRunStatus.awaiting_input ||
    state.status === AgentRunStatus.awaiting_approval
  );
}

function runSort(a: CanonicalAgentSessionRun, b: CanonicalAgentSessionRun) {
  const created =
    new Date(a.summary.created_at).getTime() -
    new Date(b.summary.created_at).getTime();
  return (
    created || a.summary.agent_run_id.localeCompare(b.summary.agent_run_id)
  );
}

/** Build the session-level canonical projection used by chat and history. */
export function buildCanonicalAgentSessionTimeline(
  sessionId: string,
  summaries: readonly AgentRunSummary[],
  timelines: ReadonlyMap<string, CanonicalAgentTimeline | null> = new Map()
): CanonicalAgentSessionTimeline {
  const byId = new Map<string, AgentRunSummary>();
  for (const summary of summaries) {
    if (summary.session_id === sessionId) {
      byId.set(summary.agent_run_id, summary);
    }
  }

  const runs = [...byId.values()]
    .map((summary) => ({
      summary,
      timeline: timelines.get(summary.agent_run_id) ?? null,
    }))
    .sort(runSort);
  const activeRuns = runs.filter((run) =>
    isCanonicalRunActive(run.timeline?.state ?? run.summary.state)
  );
  const latestRun = runs.at(-1) ?? null;
  const activeRun = activeRuns.at(-1) ?? null;

  return {
    sessionId,
    runs,
    activeRun,
    latestRun,
    isRunning: activeRuns.length > 0,
    isTerminal: Boolean(
      latestRun &&
        isCanonicalRunTerminal(
          latestRun.timeline?.state ?? latestRun.summary.state
        )
    ),
    projectionDegraded: runs.some(
      (run) =>
        (run.timeline?.state ?? run.summary.state).projection_status !==
        'current'
    ),
  };
}
