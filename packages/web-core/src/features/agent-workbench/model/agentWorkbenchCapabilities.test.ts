import { expect, test } from '@playwright/test';

import type { RuntimeActionPolicy } from '@/shared/lib/runtimeActionPolicy';
import { deriveAgentWorkbenchCapabilities } from './agentWorkbenchCapabilities';

function policy(): RuntimeActionPolicy {
  return {
    send_initial: { action: 'send_initial', allowed: true, reason: null },
    send_follow_up: {
      action: 'send_follow_up',
      allowed: false,
      reason: 'provider_capability_missing',
    },
    queue_follow_up: {
      action: 'queue_follow_up',
      allowed: false,
      reason: 'runtime_terminal',
    },
    cancel_queue: {
      action: 'cancel_queue',
      allowed: false,
      reason: 'queue_empty',
    },
    stop: { action: 'stop', allowed: true, reason: null },
    approve: {
      action: 'approve',
      allowed: false,
      reason: 'approval_required',
    },
    request_changes: {
      action: 'request_changes',
      allowed: false,
      reason: 'approval_required',
    },
    answer_question: {
      action: 'answer_question',
      allowed: false,
      reason: 'question_required',
    },
    retry: { action: 'retry', allowed: false, reason: 'unknown_runtime' },
    resume: { action: 'resume', allowed: false, reason: 'unknown_runtime' },
  };
}

test('keeps primary workbench capabilities distinct with blocked reasons', () => {
  const capabilities = deriveAgentWorkbenchCapabilities(policy());
  expect(Object.keys(capabilities)).toEqual([
    'send',
    'follow_up',
    'queue',
    'stop',
  ]);
  expect(capabilities.follow_up.disabledReason).toBe(
    'provider_capability_missing'
  );
  expect(capabilities.queue.disabledReason).toBe('runtime_terminal');
  expect(capabilities.send.disabledReason).toBeNull();
});
