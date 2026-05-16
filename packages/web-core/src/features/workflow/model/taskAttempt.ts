import type { WorkflowAttemptResponse } from 'shared/types';
import type { WorkspaceWithStats } from '@vibe/ui/components/IssueWorkspaceCard';

export type TaskAttemptKind = 'single_agent' | 'workflow';
export type TaskAttemptStatusTone =
  | 'draft'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'neutral';

export interface TaskAttemptView {
  id: string;
  kind: TaskAttemptKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: TaskAttemptStatusTone;
  updatedAt: string;
  primaryActionLabel: string;
  localWorkspaceId?: string | null;
  workflowId?: string;
  workflowAttemptId?: string;
  latestRunId?: string | null;
  workspaceId?: string | null;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  isOwnedByCurrentUser?: boolean;
}

export interface BuildTaskAttemptsInput {
  workspaceAttempts: WorkspaceWithStats[];
  workflowAttempts: WorkflowAttemptResponse[];
}

export function buildTaskAttempts({
  workspaceAttempts,
  workflowAttempts,
}: BuildTaskAttemptsInput): TaskAttemptView[] {
  return [
    ...workflowAttempts.map(workflowAttemptToTaskAttempt),
    ...workspaceAttempts.map(workspaceToTaskAttempt),
  ].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function workflowAttemptToTaskAttempt(
  attempt: WorkflowAttemptResponse
): TaskAttemptView {
  return {
    id: attempt.id,
    kind: 'workflow',
    title: attempt.name || 'Workflow attempt',
    subtitle: attempt.latest_run_id
      ? `Run ${attempt.latest_run_id.slice(0, 8)}`
      : 'Draft workflow attempt',
    statusLabel: workflowAttemptStatusLabel(attempt.status),
    statusTone: workflowAttemptStatusTone(attempt.status),
    updatedAt: attempt.updated_at,
    primaryActionLabel: 'Open canvas',
    workflowId: attempt.workflow_id,
    workflowAttemptId: attempt.id,
    latestRunId: attempt.latest_run_id,
    workspaceId: attempt.workspace_id,
  };
}

function workspaceToTaskAttempt(
  workspace: WorkspaceWithStats
): TaskAttemptView {
  return {
    id: workspace.id,
    kind: 'single_agent',
    title: workspace.name || 'Single agent attempt',
    subtitle: workspace.localWorkspaceId
      ? `Workspace ${workspace.localWorkspaceId.slice(0, 8)}`
      : 'Remote workspace',
    statusLabel: workspaceStatusLabel(workspace),
    statusTone: workspaceStatusTone(workspace),
    updatedAt: workspace.latestProcessCompletedAt ?? workspace.updatedAt,
    primaryActionLabel: 'Open session',
    localWorkspaceId: workspace.localWorkspaceId,
    filesChanged: workspace.filesChanged,
    linesAdded: workspace.linesAdded,
    linesRemoved: workspace.linesRemoved,
    isOwnedByCurrentUser: workspace.isOwnedByCurrentUser,
  };
}

function workflowAttemptStatusLabel(
  status: WorkflowAttemptResponse['status']
): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'ready':
      return 'Ready';
    case 'running':
      return 'Running';
    case 'awaiting_human':
      return 'Waiting for human';
    case 'awaiting_arena':
      return 'Waiting for arena';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
  }
}

function workflowAttemptStatusTone(
  status: WorkflowAttemptResponse['status']
): TaskAttemptStatusTone {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'ready':
      return 'neutral';
    case 'running':
      return 'running';
    case 'awaiting_human':
    case 'awaiting_arena':
      return 'waiting';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
  }
}

function workspaceStatusLabel(workspace: WorkspaceWithStats): string {
  if (workspace.archived) return 'Archived';
  switch (workspace.latestProcessStatus) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'killed':
      return 'Canceled';
    default:
      return 'Active';
  }
}

function workspaceStatusTone(
  workspace: WorkspaceWithStats
): TaskAttemptStatusTone {
  if (workspace.archived) return 'canceled';
  switch (workspace.latestProcessStatus) {
    case 'running':
      return 'running';
    case 'completed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'killed':
      return 'canceled';
    default:
      return 'neutral';
  }
}
