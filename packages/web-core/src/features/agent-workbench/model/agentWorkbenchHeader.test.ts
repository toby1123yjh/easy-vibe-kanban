import { expect, test } from '@playwright/test';
import type { SessionListItem } from 'shared/types';

import { findAppShellRecentSession } from '@/shared/hooks/useAppShellRecentSessions';
import { deriveAgentWorkbenchHeader } from './agentWorkbenchHeader';

const canonicalSession: SessionListItem = {
  id: 'session-1',
  workspace_id: 'workspace-1',
  task_id: 'task-1',
  project_id: 'project-1',
  issue_id: 'VIB-42',
  title: 'Canonical task title',
  executor: null,
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
};

test('prioritizes canonical task title and composes existing workspace context', () => {
  const selectedCanonicalSession = findAppShellRecentSession(
    [canonicalSession],
    'session-1'
  );
  expect(
    deriveAgentWorkbenchHeader({
      canonicalSession: selectedCanonicalSession,
      fallbackTitle: 'Legacy session title',
      issueLabel: 'Issue VIB-42',
      workspaceContext: {
        containerRef: '/workspaces/task-1',
        branch: 'feature/task-1',
        workspaceKind: 'worktree',
      },
    })
  ).toEqual({
    title: 'Canonical task title',
    subtitle: 'Issue VIB-42 / /workspaces/task-1 / feature/task-1 / Worktree',
  });
});

test('uses a clear fallback when no canonical session mapping exists', () => {
  expect(
    deriveAgentWorkbenchHeader({
      canonicalSession: undefined,
      fallbackTitle: 'New session',
    })
  ).toEqual({ title: 'New session', subtitle: undefined });
});
