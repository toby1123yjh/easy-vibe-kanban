import { expect, test } from '@playwright/test';
import type { AgentEventEnvelope } from '../../../shared/types';
import { emptyCanonicalAgentTimeline, mergeCanonicalAgentTimeline } from '../../../packages/web-core/src/features/agent-runtime/model/canonicalAgentTimeline';

test('file evidence can be replayed in the conversation without breaking its cursor or duplicating entries', () => {
  const evidence: AgentEventEnvelope = {
    schema_version: 1, payload_version: 1, event_id: 'file-event',
    session_id: 'session', agent_run_id: 'run', turn_id: 'turn',
    run_attempt_id: 'attempt', run_attempt_number: 1, sequence: 2,
    correlation_id: 'correlation', timestamp: '2026-09-29T00:00:00Z', native_refs: [],
    payload: { type: 'file_changes', data: { tool_call_id: 'edit-1', changes: [{ path: 'report.txt', change_type: 'modified' }] } },
  };
  const timeline = mergeCanonicalAgentTimeline(emptyCanonicalAgentTimeline(), [evidence]);
  expect(timeline.items[0]).toMatchObject({ kind: 'tool', content: 'report.txt', payload: evidence.payload });
  expect(mergeCanonicalAgentTimeline(timeline, [evidence]).items).toHaveLength(1);
  expect(timeline.cursor).toEqual({ run_attempt_number: 1, sequence: 2n });
});
