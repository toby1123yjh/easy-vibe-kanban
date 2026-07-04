import { describe, expect, it } from 'vitest';
import { BaseCodingAgent } from 'shared/types';
import { filterVisibleAgents, isAgentHidden } from './agentVisibility';

describe('agent visibility', () => {
  it('filters hidden agents from new selection lists', () => {
    expect(
      filterVisibleAgents({
        agents: [
          BaseCodingAgent.CLAUDE_CODE,
          BaseCodingAgent.CODEX,
          BaseCodingAgent.GEMINI,
        ],
        hiddenAgents: [BaseCodingAgent.CODEX],
      })
    ).toEqual([BaseCodingAgent.CLAUDE_CODE, BaseCodingAgent.GEMINI]);
  });

  it('preserves a selected hidden agent in its original order', () => {
    expect(
      filterVisibleAgents({
        agents: [
          BaseCodingAgent.CLAUDE_CODE,
          BaseCodingAgent.CODEX,
          BaseCodingAgent.GEMINI,
        ],
        hiddenAgents: [BaseCodingAgent.CODEX],
        preserveAgents: [BaseCodingAgent.CODEX],
      })
    ).toEqual([
      BaseCodingAgent.CLAUDE_CODE,
      BaseCodingAgent.CODEX,
      BaseCodingAgent.GEMINI,
    ]);
  });

  it('appends preserved agents missing from the source list', () => {
    expect(
      filterVisibleAgents({
        agents: [BaseCodingAgent.CLAUDE_CODE],
        hiddenAgents: [BaseCodingAgent.CODEX],
        preserveAgents: [BaseCodingAgent.CODEX],
      })
    ).toEqual([BaseCodingAgent.CLAUDE_CODE, BaseCodingAgent.CODEX]);
  });

  it('deduplicates while preserving first-seen order', () => {
    expect(
      filterVisibleAgents({
        agents: [
          BaseCodingAgent.CODEX,
          BaseCodingAgent.CLAUDE_CODE,
          BaseCodingAgent.CODEX,
        ],
        preserveAgents: [BaseCodingAgent.CLAUDE_CODE],
      })
    ).toEqual([BaseCodingAgent.CODEX, BaseCodingAgent.CLAUDE_CODE]);
  });

  it('checks hidden status defensively', () => {
    expect(isAgentHidden(BaseCodingAgent.CODEX, [BaseCodingAgent.CODEX])).toBe(
      true
    );
    expect(isAgentHidden(null, [BaseCodingAgent.CODEX])).toBe(false);
    expect(isAgentHidden(BaseCodingAgent.GEMINI, null)).toBe(false);
  });
});
