import { describe, expect, it } from 'vitest';
import {
  AgentProviderCapability,
  AgentProviderReadiness,
  BaseCodingAgent,
  ExecutionProcessStatus,
  type AgentProviderPolicy,
  type ExecutionProcess,
} from 'shared/types';
import { deriveRuntimeActionPolicy } from './runtimeActionPolicy';

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
  started_at: '2026-06-23T00:00:00Z',
  completed_at: null,
  created_at: '2026-06-23T00:00:00Z',
  updated_at: '2026-06-23T00:00:00Z',
} as ExecutionProcess;

const readyPolicy: AgentProviderPolicy = {
  executor: BaseCodingAgent.CODEX,
  readiness: AgentProviderReadiness.READY,
  capabilities: [
    AgentProviderCapability.INITIAL_RUN,
    AgentProviderCapability.FOLLOW_UP,
    AgentProviderCapability.SESSION_RESUME,
  ],
  legacy: false,
  disabled: false,
  diagnostics: [],
};

function makeProcess(overrides: Partial<ExecutionProcess>): ExecutionProcess {
  return {
    ...baseProcess,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof deriveRuntimeActionPolicy>[0]> = {}
): Parameters<typeof deriveRuntimeActionPolicy>[0] {
  return {
    processes: [],
    hasContent: true,
    hasWorkspace: true,
    hasSession: true,
    hasExecutor: true,
    isNewSessionMode: false,
    isWorkspaceBusy: false,
    isSending: false,
    isStopping: false,
    isQueueLoading: false,
    isQueued: false,
    hasPendingApproval: false,
    hasPendingQuestion: false,
    isApprovalTimedOut: false,
    providerPolicy: readyPolicy,
    ...overrides,
  };
}

describe('runtime action policy', () => {
  it('allows idle new session initial send', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        hasSession: false,
        isNewSessionMode: true,
      })
    );

    expect(policy.send_initial.allowed).toBe(true);
    expect(policy.send_follow_up.reason).toBe('no_session');
  });

  it('allows existing idle follow-up after a prior coding run', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [
          makeProcess({
            status: ExecutionProcessStatus.completed,
            completed_at: '2026-06-23T00:01:00Z',
          }),
        ],
      })
    );

    expect(policy.send_follow_up.allowed).toBe(true);
    expect(policy.queue_follow_up.allowed).toBe(false);
  });

  it('blocks direct follow-up and allows queue while running', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [baseProcess],
        isWorkspaceBusy: true,
      })
    );

    expect(policy.send_follow_up.reason).toBe('runtime_busy');
    expect(policy.queue_follow_up.allowed).toBe(true);
    expect(policy.stop.allowed).toBe(true);
  });

  it('blocks duplicate queue and allows queue cancel', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [baseProcess],
        isWorkspaceBusy: true,
        isQueued: true,
      })
    );

    expect(policy.queue_follow_up.reason).toBe('queue_already_present');
    expect(policy.cancel_queue.allowed).toBe(true);
  });

  it('blocks send and queue while stopping', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [baseProcess],
        isWorkspaceBusy: true,
        isStopping: true,
      })
    );

    expect(policy.send_follow_up.reason).toBe('runtime_cancelling');
    expect(policy.queue_follow_up.reason).toBe('runtime_cancelling');
    expect(policy.stop.reason).toBe('runtime_cancelling');
  });

  it('blocks failed terminal follow-up', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [
          makeProcess({
            status: ExecutionProcessStatus.failed,
            completed_at: '2026-06-23T00:01:00Z',
          }),
        ],
      })
    );

    expect(policy.send_follow_up.reason).toBe('runtime_terminal');
  });

  it('preserves approval approve and request-change rules', () => {
    const approvePolicy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [baseProcess],
        isWorkspaceBusy: true,
        hasContent: false,
        hasPendingApproval: true,
      })
    );
    const requestChangesPolicy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [baseProcess],
        isWorkspaceBusy: true,
        hasPendingApproval: true,
      })
    );

    expect(approvePolicy.approve.allowed).toBe(true);
    expect(approvePolicy.request_changes.reason).toBe('no_content');
    expect(requestChangesPolicy.request_changes.allowed).toBe(true);
    expect(requestChangesPolicy.send_follow_up.reason).toBe(
      'approval_required'
    );
  });

  it('allows question answers while question mode owns input', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [baseProcess],
        isWorkspaceBusy: true,
        hasPendingQuestion: true,
      })
    );

    expect(policy.answer_question.allowed).toBe(true);
    expect(policy.send_follow_up.reason).toBe('question_required');
  });

  it('uses provider capability when policy exists', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [
          makeProcess({
            status: ExecutionProcessStatus.completed,
            completed_at: '2026-06-23T00:01:00Z',
          }),
        ],
        providerPolicy: {
          ...readyPolicy,
          capabilities: [AgentProviderCapability.INITIAL_RUN],
        },
      })
    );

    expect(policy.send_follow_up.reason).toBe('provider_capability_missing');
  });

  it('falls back compatibly when provider policy is absent', () => {
    const policy = deriveRuntimeActionPolicy(
      baseInput({
        processes: [
          makeProcess({
            status: ExecutionProcessStatus.completed,
            completed_at: '2026-06-23T00:01:00Z',
          }),
        ],
        providerPolicy: null,
      })
    );

    expect(policy.send_follow_up.allowed).toBe(true);
  });
});
