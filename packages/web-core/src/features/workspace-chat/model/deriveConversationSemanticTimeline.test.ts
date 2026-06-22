import { describe, expect, it } from 'vitest';
import {
  AgentRunLifecycle,
  BaseCodingAgent,
  ExecutionProcessStatus,
  type ExecutionProcess,
} from 'shared/types';
import type {
  ConversationTimelineSource,
  ExecutionProcessState,
} from '@/shared/hooks/useConversationHistory/types';
import { deriveConversationSemanticTimeline } from './deriveConversationSemanticTimeline';

const staticProcess: ExecutionProcessState['executionProcess'] = {
  id: 'process-1',
  created_at: '2026-06-22T00:00:00Z',
  updated_at: '2026-06-22T00:00:00Z',
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
};

const liveProcessBase = {
  id: 'process-1',
  session_id: 'session-1',
  run_reason: 'codingagent',
  executor_action: staticProcess.executor_action,
  status: ExecutionProcessStatus.running,
  exit_code: null,
  dropped: false,
  started_at: '2026-06-22T00:00:00Z',
  completed_at: null,
  created_at: '2026-06-22T00:00:00Z',
  updated_at: '2026-06-22T00:00:00Z',
} satisfies ExecutionProcess;

function makeSource(liveProcess: ExecutionProcess): ConversationTimelineSource {
  return {
    executionProcessState: {
      [staticProcess.id]: {
        executionProcess: staticProcess,
        entries: [],
      },
    },
    liveExecutionProcesses: [liveProcess],
  };
}

describe('deriveConversationSemanticTimeline', () => {
  it('keeps waiting runtime lifecycle active', () => {
    const timeline = deriveConversationSemanticTimeline(
      makeSource({
        ...liveProcessBase,
        agent_runtime_lifecycle: AgentRunLifecycle.waiting_input,
      })
    );

    expect(timeline.processes[0]).toMatchObject({
      isRunning: true,
      failedOrKilled: false,
    });
  });

  it('treats crashed runtime lifecycle as failed-like', () => {
    const timeline = deriveConversationSemanticTimeline(
      makeSource({
        ...liveProcessBase,
        agent_runtime_lifecycle: AgentRunLifecycle.crashed,
      })
    );

    expect(timeline.processes[0]).toMatchObject({
      isRunning: false,
      failedOrKilled: true,
    });
  });
});
