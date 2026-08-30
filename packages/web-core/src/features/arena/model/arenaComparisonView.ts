import { AgentRunStatus, type AgentRunSummary } from 'shared/types';
import {
  isActiveArenaAgentRunStatus,
  isCancellableArenaAgentRunStatus,
  isRetryableArenaAgentRunStatus,
  isSuccessfulArenaAgentRunStatus,
  type ArenaGroupResponse,
  type ArenaWorkspacePurpose,
  type ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';

export interface ArenaComparisonCandidate {
  candidateId: string;
  order: number;
  workspaceId: string;
  sessionId: string | null;
  purpose: ArenaWorkspacePurpose;
  label: string;
  executorLabel: string;
  branch: string;
  arenaStatus: ArenaWorkspaceSummary['arena_status'];
  agentRunStatus: AgentRunStatus | null;
  isWinner: boolean;
  isSuccessful: boolean;
  canSelectWinner: boolean;
  canRetry: boolean;
  canCancel: boolean;
  workspace: ArenaWorkspaceSummary;
}

export interface ArenaComparisonLabels {
  attempt: (order: number) => string;
  synthesis: (order: number) => string;
}

export interface ArenaComparisonView {
  candidates: ArenaComparisonCandidate[];
  attemptCount: number;
  synthesisCount: number;
  completedCount: number;
  activeCount: number;
  cancellableSessionIds: string[];
  canClose: boolean;
  canDissolve: boolean;
  hasWinner: boolean;
}

function getCandidateLabel(
  workspace: ArenaWorkspaceSummary,
  index: number,
  labels: ArenaComparisonLabels
): string {
  if (workspace.name) return workspace.name;
  if (workspace.purpose === 'synthesis') return labels.synthesis(index + 1);
  return workspace.executor || labels.attempt(index + 1);
}

function getExecutorLabel(workspace: ArenaWorkspaceSummary): string {
  return [workspace.executor, workspace.variant].filter(Boolean).join(' / ');
}

export function buildArenaComparisonView(
  group: ArenaGroupResponse,
  labels: ArenaComparisonLabels
): ArenaComparisonView {
  const hasWinner = group.winner_candidate_id !== null;
  const isOpen = group.lifecycle_status === 'open';
  const candidates = group.workspaces.map((workspace, index) => {
    const agentRunStatus = workspace.latest_agent_run_status;
    const isWinner = group.winner_candidate_id === workspace.candidate_id;
    const isSuccessful = isSuccessfulArenaAgentRunStatus(agentRunStatus);
    const canCancel =
      workspace.session_id !== null &&
      isCancellableArenaAgentRunStatus(agentRunStatus);

    return {
      candidateId: workspace.candidate_id,
      order: index,
      workspaceId: workspace.workspace_id,
      sessionId: workspace.session_id,
      purpose: workspace.purpose,
      label: getCandidateLabel(workspace, index, labels),
      executorLabel: getExecutorLabel(workspace),
      branch: workspace.branch,
      arenaStatus: workspace.arena_status,
      agentRunStatus,
      isWinner,
      isSuccessful,
      canSelectWinner:
        isOpen &&
        !hasWinner &&
        workspace.arena_status === 'active' &&
        isSuccessful,
      canRetry:
        isOpen &&
        !hasWinner &&
        workspace.purpose === 'attempt' &&
        workspace.arena_status === 'active' &&
        isRetryableArenaAgentRunStatus(agentRunStatus),
      canCancel,
      workspace,
    } satisfies ArenaComparisonCandidate;
  });

  return {
    candidates,
    attemptCount: candidates.filter(({ purpose }) => purpose === 'attempt')
      .length,
    synthesisCount: candidates.filter(({ purpose }) => purpose === 'synthesis')
      .length,
    completedCount: candidates.filter(({ isSuccessful }) => isSuccessful)
      .length,
    activeCount: candidates.filter(({ agentRunStatus }) =>
      isActiveArenaAgentRunStatus(agentRunStatus)
    ).length,
    cancellableSessionIds: candidates.flatMap((candidate) =>
      candidate.canCancel && candidate.sessionId ? [candidate.sessionId] : []
    ),
    canClose: group.lifecycle_status === 'open',
    canDissolve: !hasWinner,
    hasWinner,
  };
}

export function reconcileArenaCandidateSelection(
  selectedCandidateId: string | null,
  candidates: readonly ArenaComparisonCandidate[]
): string | null {
  if (
    selectedCandidateId &&
    candidates.some(({ candidateId }) => candidateId === selectedCandidateId)
  ) {
    return selectedCandidateId;
  }
  return candidates[0]?.candidateId ?? null;
}

export function selectCurrentArenaAgentRun(
  runs: readonly AgentRunSummary[]
): AgentRunSummary | null {
  return runs.reduce<AgentRunSummary | null>((current, candidate) => {
    if (!current) return candidate;

    const createdAtComparison = candidate.created_at.localeCompare(
      current.created_at
    );
    if (createdAtComparison !== 0) {
      return createdAtComparison > 0 ? candidate : current;
    }

    return candidate.agent_run_id.localeCompare(current.agent_run_id) > 0
      ? candidate
      : current;
  }, null);
}

export function getArenaAgentRunResultSummary(
  run: AgentRunSummary | null | undefined
): string | null {
  const content = run?.state.terminal_output?.content.trim();
  return content ? content : null;
}
