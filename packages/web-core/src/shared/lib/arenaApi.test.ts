import { describe, expect, it } from 'vitest';
import { AgentRunStatus } from 'shared/types';
import {
  isActiveArenaAgentRunStatus,
  isSuccessfulArenaAgentRunStatus,
  isTerminalArenaAgentRunStatus,
} from './arenaApi';

const activeStatuses = [
  AgentRunStatus.pending,
  AgentRunStatus.starting,
  AgentRunStatus.running,
  AgentRunStatus.awaiting_input,
  AgentRunStatus.awaiting_approval,
  AgentRunStatus.cancelling,
];

const terminalStatuses = [
  AgentRunStatus.succeeded,
  AgentRunStatus.failed,
  AgentRunStatus.cancelled,
  AgentRunStatus.crashed,
  AgentRunStatus.audit_failed,
];

describe('Arena AgentRun status policy', () => {
  it.each(activeStatuses)('treats %s as active', (status) => {
    expect(isActiveArenaAgentRunStatus(status)).toBe(true);
    expect(isTerminalArenaAgentRunStatus(status)).toBe(false);
  });

  it.each(terminalStatuses)('treats %s as terminal', (status) => {
    expect(isActiveArenaAgentRunStatus(status)).toBe(false);
    expect(isTerminalArenaAgentRunStatus(status)).toBe(true);
  });

  it('only treats succeeded as successful and selectable', () => {
    for (const status of Object.values(AgentRunStatus)) {
      expect(isSuccessfulArenaAgentRunStatus(status)).toBe(
        status === AgentRunStatus.succeeded
      );
    }
    expect(isSuccessfulArenaAgentRunStatus(null)).toBe(false);
  });
});
