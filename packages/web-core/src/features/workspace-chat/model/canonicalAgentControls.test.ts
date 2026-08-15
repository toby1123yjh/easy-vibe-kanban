import { describe, expect, it, vi } from 'vitest';
import {
  createCanonicalAgentControls,
  serializeCanonicalInputAnswers,
  type CanonicalAgentControlClient,
} from './canonicalAgentControls';

describe('canonical AgentRun controls', () => {
  it('dispatches cancel, input, and approval only through AgentRun methods', async () => {
    const client: CanonicalAgentControlClient = {
      cancel: vi.fn(async () => undefined),
      submitInput: vi.fn(async () => undefined),
      resolveApproval: vi.fn(async () => undefined),
    };
    const controls = createCanonicalAgentControls(client);

    await controls.cancel('run-1', 'user request');
    await controls.submitInput('run-1', 'input-1', 'continue');
    await controls.approve('run-1', 'approval-1');
    await controls.deny('run-1', 'approval-2', 'needs changes');

    expect(client.cancel).toHaveBeenCalledWith('run-1', 'user request');
    expect(client.submitInput).toHaveBeenCalledWith(
      'run-1',
      'input-1',
      'continue'
    );
    expect(client.resolveApproval).toHaveBeenNthCalledWith(
      1,
      'run-1',
      'approval-1',
      true
    );
    expect(client.resolveApproval).toHaveBeenNthCalledWith(
      2,
      'run-1',
      'approval-2',
      false,
      'needs changes'
    );
  });

  it('serializes every question and answer without flattening multi-question input', () => {
    expect(
      serializeCanonicalInputAnswers([
        { question: 'Language?', answer: ['Rust'] },
        { question: 'Targets?', answer: ['CLI', 'Web'] },
      ])
    ).toBe(
      '{"answers":[{"question":"Language?","answer":["Rust"]},{"question":"Targets?","answer":["CLI","Web"]}]}'
    );
  });
});
