import { expect, test } from '@playwright/test';
import type { WorkflowNotificationView } from 'shared/types';
import type {
  CanonicalConversationProjection,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';
import {
  mergeWorkflowNotifications,
  workflowNotificationEntries,
} from '@/features/workflow/model/workflowNotifications';
import { projectAgentWorkbenchTimeline } from './agentWorkbenchTimeline';

const copy = {
  heading: 'Workflow',
  resolved: 'Resolved',
  pending: 'Awaiting response',
  status: (status: string) => status,
};

function notification(
  overrides: Partial<WorkflowNotificationView> = {}
): WorkflowNotificationView {
  return {
    id: 'notice-1',
    sequence: 1,
    instance_id: 'instance-1',
    run_id: 'workflow-run-1',
    main_session_id: 'session-1',
    event_key: 'run:failed',
    kind: 'failed',
    node_execution_id: null,
    interaction_id: null,
    observed_status: 'failed',
    summary: 'The workflow stopped with an error.',
    created_at: '2026-10-03T12:00:02Z',
    current_status: 'failed',
    is_resolved: false,
    ...overrides,
  };
}

function tool(id: string, timestamp: string): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey: id,
    canonical: {
      agentRunId: 'agent-run-1',
      runAttemptId: 'attempt-1',
      runAttemptNumber: 1,
      eventId: id,
      eventIds: [id],
      sequence: 1n,
      active: false,
    },
    content: {
      timestamp,
      content: id,
      entry_type: {
        type: 'tool_use',
        tool_name: 'Read',
        action_type: {
          action: 'tool',
          tool_name: 'Read',
          arguments: null,
          result: null,
        },
        status: { status: 'success' },
      },
    },
  };
}

test('notification replay deduplicates stable IDs and filters the original Session', () => {
  const first = notification();
  const entries = workflowNotificationEntries(
    [
      notification({ id: 'notice-2', sequence: 2 }),
      first,
      first,
      notification({ id: 'foreign', main_session_id: 'session-2' }),
    ],
    'session-1',
    copy
  );
  expect(entries.map((entry) => entry.patchKey)).toEqual([
    'workflow-notification:notice-1',
    'workflow-notification:notice-2',
  ]);
  expect(
    entries.every((entry) => !entry.canonical && !entry.executionProcessId)
  ).toBe(true);
});

test('resolved historical wait updates its content in place, without a new identity', () => {
  const wait = notification({
    interaction_id: 'interaction-1',
    current_status: 'waiting_human',
  });
  const before = workflowNotificationEntries([wait], 'session-1', copy);
  const after = workflowNotificationEntries(
    [{ ...wait, is_resolved: true, current_status: 'succeeded' }],
    'session-1',
    copy
  );
  expect(after[0].patchKey).toBe(before[0].patchKey);
  expect(
    after[0].type === 'NORMALIZED_ENTRY' && after[0].content.content
  ).toContain('Resolved');
  expect(
    after[0].type === 'NORMALIZED_ENTRY' && after[0].content.content
  ).not.toContain('Awaiting response');
});

test('runtime messages preserve native ordering and break adjacent tool grouping', () => {
  const native = [
    tool('first', '2026-10-03T12:00:01Z'),
    tool('second', '2026-10-03T12:00:03Z'),
  ];
  const facts = workflowNotificationEntries(
    [notification()],
    'session-1',
    copy
  );
  const merged = mergeWorkflowNotifications(native, facts);
  expect(merged.map((entry) => entry.patchKey)).toEqual([
    'first',
    facts[0].patchKey,
    'second',
  ]);
  expect(
    projectAgentWorkbenchTimeline(merged).map((item) => item.kind)
  ).toEqual(['tool', 'message', 'tool']);
  expect(merged.filter((entry) => entry.canonical)).toEqual(native);
});

test('a trailing workflow fact cannot take over the real AgentRun terminal identity', () => {
  const native = tool('tool-1', '2026-10-03T12:00:01Z');
  const source: CanonicalConversationProjection = {
    entries: mergeWorkflowNotifications(
      [native],
      workflowNotificationEntries([notification()], 'session-1', copy)
    ),
    activeAgentRunIds: new Set(),
    runCount: 1,
    isLoading: false,
    isRunning: false,
    projectionDegraded: false,
    latestStatus: 'failed',
  };
  const terminal = projectAgentWorkbenchTimeline(source).at(-1);
  expect(terminal?.kind).toBe('status');
  expect(terminal?.agentRunId).toBe('agent-run-1');
  expect(terminal?.runAttemptId).toBe('attempt-1');
  expect(terminal?.eventId).toBe('tool-1');
  expect(source.runCount).toBe(1);
  expect(source.isRunning).toBe(false);
});

test('notification-only Sessions have system messages and no synthetic AgentRun', () => {
  const source: CanonicalConversationProjection = {
    entries: workflowNotificationEntries([notification()], 'session-1', copy),
    activeAgentRunIds: new Set(),
    runCount: 0,
    isLoading: false,
    isRunning: false,
    projectionDegraded: false,
    latestStatus: null,
  };
  const items = projectAgentWorkbenchTimeline(source);
  expect(items).toHaveLength(1);
  expect(items[0].kind === 'message' && items[0].role).toBe('system');
  expect(items[0].agentRunId).toBeNull();
  expect(source.runCount).toBe(0);
  expect(source.activeAgentRunIds.size).toBe(0);
});
