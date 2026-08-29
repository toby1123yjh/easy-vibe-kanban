import { expect, test } from '@playwright/test';
import type { AgentRunStatus, NormalizedEntry } from 'shared/types';

import type {
  CanonicalConversationProjection,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';
import { projectAgentWorkbenchTimeline } from './agentWorkbenchTimeline';

const describe = test.describe;
const it = test;

function patch(
  patchKey: string,
  entryType: NormalizedEntry['entry_type'],
  content = patchKey,
  sequence = 1,
  active = false
): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    content: { entry_type: entryType, content, timestamp: null },
    patchKey,
    canonical: {
      agentRunId: 'run-1',
      runAttemptId: 'attempt-1',
      runAttemptNumber: 1,
      eventId: `event-${sequence}`,
      eventIds: [`event-${sequence}`],
      sequence: BigInt(sequence),
      active,
    },
  };
}

function tool(name: string, sequence: number, active = false) {
  return patch(
    `tool-${sequence}`,
    {
      type: 'tool_use',
      tool_name: name,
      action_type: {
        action: 'tool',
        tool_name: name,
        arguments: null,
        result: null,
      },
      status: active ? { status: 'created' } : { status: 'success' },
    },
    name,
    sequence,
    active
  );
}

describe('projectAgentWorkbenchTimeline', () => {
  it('groups only two or more truly adjacent tool calls', () => {
    const items = projectAgentWorkbenchTimeline([
      tool('Read', 1),
      tool('Search', 2),
      patch('assistant', { type: 'assistant_message' }, 'Done', 3),
      tool('Shell', 4),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      'tool-group',
      'message',
      'tool',
    ]);
    expect(items[0]?.kind === 'tool-group' && items[0].items).toHaveLength(2);
  });

  it('treats every non-tool row as a hard grouping boundary', () => {
    const items = projectAgentWorkbenchTimeline([
      tool('Read', 1),
      patch('thinking', { type: 'thinking' }, 'Checking', 2),
      tool('Search', 3),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['tool', 'message', 'tool']);
  });

  it('does not group adjacent tools across canonical run attempts', () => {
    const first = tool('Read', 1);
    const second = tool('Search', 2);
    if (second.canonical) {
      second.canonical = {
        ...second.canonical,
        agentRunId: 'run-2',
        runAttemptId: 'attempt-2',
        runAttemptNumber: 2,
      };
    }

    const items = projectAgentWorkbenchTimeline([first, second]);

    expect(items.map((item) => item.kind)).toEqual(['tool', 'tool']);
    expect(items.map((item) => item.agentRunId)).toEqual(['run-1', 'run-2']);
  });

  it('projects canonical interactions, failures, and active status explicitly', () => {
    const items = projectAgentWorkbenchTimeline([
      patch(
        'approval',
        {
          type: 'tool_use',
          tool_name: 'Write',
          action_type: {
            action: 'tool',
            tool_name: 'Write',
            arguments: null,
            result: null,
          },
          status: { status: 'pending_approval', approval_id: 'approval-1' },
        },
        'Approve write?',
        1,
        true
      ),
      patch(
        'input',
        {
          type: 'tool_use',
          tool_name: 'Agent input',
          action_type: {
            action: 'ask_user_question',
            questions: [],
          },
          status: { status: 'pending_approval', approval_id: 'input-1' },
        },
        'Which branch?',
        2,
        true
      ),
      patch(
        'failure',
        { type: 'error_message', error_type: { type: 'other' } },
        'Provider failed',
        3
      ),
      patch('active', { type: 'loading' }, '', 4, true),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      'interaction',
      'interaction',
      'failure',
      'status',
    ]);
    expect(items[0]?.kind === 'interaction' && items[0].interaction).toBe(
      'approval'
    );
    expect(items[1]?.kind === 'interaction' && items[1].interaction).toBe(
      'input'
    );
    expect(items[3]?.active).toBe(true);
  });

  it('projects canonical cancellation without inferring it from text', () => {
    const projection: CanonicalConversationProjection = {
      entries: [],
      activeAgentRunIds: new Set(),
      runCount: 1,
      isLoading: false,
      isRunning: false,
      projectionDegraded: false,
      latestStatus: 'cancelled' as AgentRunStatus,
    };
    expect(projectAgentWorkbenchTimeline(projection)).toMatchObject([
      { kind: 'status', status: 'cancelled' },
    ]);
  });

  it('preserves event identity and source order after replay', () => {
    const entries = [
      patch('user', { type: 'user_message' }, 'Do it', 1),
      tool('Read', 2),
      patch('assistant', { type: 'assistant_message' }, 'Done', 3),
    ];
    const replayed = projectAgentWorkbenchTimeline([...entries]);

    expect(replayed.map((item) => item.patchKey)).toEqual([
      'user',
      'tool-2',
      'assistant',
    ]);
    expect(replayed.map((item) => item.eventId)).toEqual([
      'event-1',
      'event-2',
      'event-3',
    ]);
  });
});
