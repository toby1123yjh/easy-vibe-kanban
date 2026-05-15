import { describe, expect, it } from 'vitest';
import {
  consumeWorkflowRunNodeFocus,
  queueWorkflowRunNodeFocus,
} from './workflowRunNodeFocus';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('workflow run node focus', () => {
  it('queues a node conversation target for the next run canvas load', () => {
    const storage = createStorage();

    queueWorkflowRunNodeFocus(
      'run-1',
      { nodeId: 'agent-1', panel: 'conversation' },
      storage
    );

    expect(consumeWorkflowRunNodeFocus('run-1', storage)).toEqual({
      nodeId: 'agent-1',
      panel: 'conversation',
    });
    expect(consumeWorkflowRunNodeFocus('run-1', storage)).toBeNull();
  });
});
