import { describe, expect, it } from 'vitest';
import {
  AgentRunLifecycle,
  AgentRuntimeErrorKind,
  BaseCodingAgent,
  ExecutionProcessStatus,
  type ExecutionProcess,
} from 'shared/types';
import {
  getExecutionProcessLifecycle,
  getExecutionProcessRuntimeDisplay,
  isExecutionProcessActive,
  isExecutionProcessFailedLike,
} from './executionProcessRuntime';

const baseProcess = {
  id: 'process-1',
  session_id: 'session-1',
  run_reason: 'codingagent',
  executor_action: {
    typ: {
      type: 'CodingAgentInitialRequest',
      prompt: 'Implement feature',
      executor_config: {
        executor: BaseCodingAgent.CODEX,
      },
      working_dir: null,
    },
    next_action: null,
  },
  status: ExecutionProcessStatus.running,
  exit_code: null,
  dropped: false,
  started_at: '2026-06-22T00:00:00Z',
  completed_at: null,
  created_at: '2026-06-22T00:00:00Z',
  updated_at: '2026-06-22T00:00:00Z',
} as ExecutionProcess;

function makeProcess(overrides: Partial<ExecutionProcess>): ExecutionProcess {
  return {
    ...baseProcess,
    ...overrides,
  };
}

describe('execution process runtime helpers', () => {
  it('prefers normalized waiting lifecycle for active state', () => {
    const process = makeProcess({
      agent_runtime_lifecycle: AgentRunLifecycle.waiting_approval,
      status: ExecutionProcessStatus.running,
    });

    expect(getExecutionProcessLifecycle(process)).toBe('waiting_approval');
    expect(isExecutionProcessActive(process)).toBe(true);
    expect(getExecutionProcessRuntimeDisplay(process)).toMatchObject({
      label: 'waiting for approval',
      source: 'agent_runtime',
      tone: 'warning',
    });
  });

  it('treats crashed runtime lifecycle as failed-like with error details', () => {
    const process = makeProcess({
      agent_runtime_lifecycle: AgentRunLifecycle.crashed,
      agent_runtime_error: {
        kind: AgentRuntimeErrorKind.process_crashed,
        message: 'Codex exited before responding',
        provider: 'codex',
        exit_code: 2,
      },
      status: ExecutionProcessStatus.running,
    });

    const display = getExecutionProcessRuntimeDisplay(process);

    expect(isExecutionProcessActive(process)).toBe(false);
    expect(isExecutionProcessFailedLike(process)).toBe(true);
    expect(display.label).toBe('crashed');
    expect(display.errorLabel).toContain('process crashed');
    expect(display.errorLabel).toContain('Codex exited before responding');
  });

  it('falls back to process status when runtime lifecycle is absent', () => {
    const process = makeProcess({
      status: ExecutionProcessStatus.completed,
    });

    expect(getExecutionProcessLifecycle(process)).toBe('completed');
    expect(isExecutionProcessActive(process)).toBe(false);
    expect(getExecutionProcessRuntimeDisplay(process)).toMatchObject({
      label: 'completed',
      source: 'process_status',
      tone: 'success',
    });
  });

  it('keeps killed fallback distinct from crashed', () => {
    const process = makeProcess({
      status: ExecutionProcessStatus.killed,
    });

    expect(getExecutionProcessLifecycle(process)).toBe('killed');
    expect(isExecutionProcessFailedLike(process)).toBe(true);
    expect(getExecutionProcessRuntimeDisplay(process)).toMatchObject({
      label: 'killed',
      tone: 'neutral',
    });
  });
});
