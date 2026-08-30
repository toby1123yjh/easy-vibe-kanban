import { describe, expect, it } from 'vitest';
import { AgentRunStatus } from 'shared/types';
import {
  isActiveArenaAgentRunStatus,
  isCancellableArenaAgentRunStatus,
  isRetryableArenaAgentRunStatus,
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

  it('does not send a duplicate cancel after cancellation is in progress', () => {
    expect(isCancellableArenaAgentRunStatus(AgentRunStatus.running)).toBe(true);
    expect(
      isCancellableArenaAgentRunStatus(AgentRunStatus.awaiting_input)
    ).toBe(true);
    expect(isCancellableArenaAgentRunStatus(AgentRunStatus.cancelling)).toBe(
      false
    );
    expect(isCancellableArenaAgentRunStatus(AgentRunStatus.cancelled)).toBe(
      false
    );
  });

  it('only retries attempts that never started or ended unsuccessfully', () => {
    expect(isRetryableArenaAgentRunStatus(null)).toBe(true);
    expect(isRetryableArenaAgentRunStatus(AgentRunStatus.failed)).toBe(true);
    expect(isRetryableArenaAgentRunStatus(AgentRunStatus.cancelled)).toBe(true);
    expect(isRetryableArenaAgentRunStatus(AgentRunStatus.succeeded)).toBe(
      false
    );
    expect(isRetryableArenaAgentRunStatus(AgentRunStatus.running)).toBe(false);
  });
});
