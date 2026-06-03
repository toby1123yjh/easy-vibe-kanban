import { describe, expect, it } from 'vitest';
import { buildTaskAttempts } from './taskAttempt';

describe('task attempt view model', () => {
  it('merges single-agent and workflow attempts newest first', () => {
    const attempts = buildTaskAttempts({
      workspaceAttempts: [
        {
          id: 'remote-workspace-1',
          localWorkspaceId: 'workspace-1',
          name: 'Codex try',
          archived: false,
          updatedAt: '2026-05-14T01:00:00Z',
          latestProcessStatus: 'completed',
          filesChanged: 2,
          linesAdded: 10,
          linesRemoved: 1,
          prs: [],
          owner: null,
          isOwnedByCurrentUser: true,
        },
      ],
      workflowAttempts: [
        {
          id: 'workflow-attempt-1',
          project_id: 'project-1',
          issue_id: 'issue-1',
          workflow_id: 'workflow-1',
          latest_run_id: 'run-1',
          workspace_id: 'workspace-2',
          name: 'Plan -> Implement',
          status: 'running',
          created_at: '2026-05-14T00:00:00Z',
          updated_at: '2026-05-14T02:00:00Z',
        },
      ],
    });

    expect(attempts.map((attempt) => attempt.id)).toEqual([
      'workflow-attempt-1',
      'remote-workspace-1',
    ]);
    expect(attempts[0]).toMatchObject({
      kind: 'workflow',
      title: 'Plan -> Implement',
      statusLabel: 'Running',
      primaryActionLabel: 'Open workflow',
    });
    expect(attempts[1]).toMatchObject({
      kind: 'single_agent',
      title: 'Codex try',
      statusLabel: 'Completed',
      primaryActionLabel: 'Open session',
    });
  });

  it('does not duplicate workflow-backed workspaces as single-agent attempts', () => {
    const attempts = buildTaskAttempts({
      workspaceAttempts: [
        {
          id: 'workflow-workspace-1',
          localWorkspaceId: 'local-workflow-workspace-1',
          name: 'Workflow backing workspace',
          archived: false,
          updatedAt: '2026-05-14T03:00:00Z',
          latestProcessStatus: 'running',
          filesChanged: 0,
          linesAdded: 0,
          linesRemoved: 0,
          prs: [],
          owner: null,
          isOwnedByCurrentUser: true,
        },
        {
          id: 'single-agent-workspace-1',
          localWorkspaceId: 'local-single-agent-workspace-1',
          name: 'Manual attempt',
          archived: false,
          updatedAt: '2026-05-14T02:00:00Z',
          latestProcessStatus: 'completed',
          filesChanged: 1,
          linesAdded: 2,
          linesRemoved: 0,
          prs: [],
          owner: null,
          isOwnedByCurrentUser: true,
        },
      ],
      workflowAttempts: [
        {
          id: 'workflow-attempt-1',
          project_id: 'project-1',
          issue_id: 'issue-1',
          workflow_id: 'workflow-1',
          latest_run_id: null,
          workspace_id: 'workflow-workspace-1',
          name: 'Workflow attempt',
          status: 'draft',
          created_at: '2026-05-14T00:00:00Z',
          updated_at: '2026-05-14T04:00:00Z',
        },
      ],
    });

    expect(attempts.map((attempt) => attempt.id)).toEqual([
      'workflow-attempt-1',
      'single-agent-workspace-1',
    ]);
  });
});
