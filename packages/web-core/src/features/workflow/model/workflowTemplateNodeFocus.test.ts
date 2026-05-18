import { describe, expect, it } from 'vitest';
import {
  consumeWorkflowTemplateNodeFocus,
  queueWorkflowTemplateNodeFocus,
} from './workflowTemplateNodeFocus';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('workflow template node focus', () => {
  it('queues a node edit target for the next template editor load', () => {
    const storage = createStorage();

    queueWorkflowTemplateNodeFocus(
      'workflow-1',
      { nodeId: 'agent-1', panel: 'edit' },
      storage
    );

    expect(consumeWorkflowTemplateNodeFocus('workflow-1', storage)).toEqual({
      nodeId: 'agent-1',
      panel: 'edit',
    });
    expect(consumeWorkflowTemplateNodeFocus('workflow-1', storage)).toBeNull();
  });
});
