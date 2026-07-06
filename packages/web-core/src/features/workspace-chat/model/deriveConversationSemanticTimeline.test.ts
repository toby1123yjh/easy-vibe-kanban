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
  PatchTypeWithKey,
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

function systemEntry(content: string): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey: content,
    executionProcessId: staticProcess.id,
    content: {
      timestamp: null,
      content,
      entry_type: {
        type: 'system_message',
      },
    },
  };
}

function loadingEntry(): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey: 'loading',
    executionProcessId: staticProcess.id,
    content: {
      timestamp: null,
      content: '',
      entry_type: {
        type: 'loading',
      },
    },
  };
}

function assistantEntry(content: string): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey: content,
    executionProcessId: staticProcess.id,
    content: {
      timestamp: null,
      content,
      entry_type: {
        type: 'assistant_message',
      },
    },
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

  it('hides internal agent system messages from visible entries', () => {
    const source = makeSource({
      ...liveProcessBase,
      status: ExecutionProcessStatus.completed,
      completed_at: '2026-06-22T00:01:00Z',
    });
    source.executionProcessState[staticProcess.id].entries = [
      systemEntry('System: api_retry'),
      systemEntry('System: thinking_tokens'),
      systemEntry('System initialized with model: claude-opus-4-8'),
      systemEntry(
        'Unsupported Codex event: userMessage\n{"type":"userMessage"}'
      ),
      systemEntry('requesting'),
      systemEntry('User-visible system message'),
    ];

    const timeline = deriveConversationSemanticTimeline(source);

    expect(
      timeline.processes[0].visibleEntries.map((entry) =>
        entry.type === 'NORMALIZED_ENTRY' ? entry.content.content : ''
      )
    ).toEqual(['User-visible system message']);
  });

  it('hides loading placeholders for completed processes', () => {
    const source = makeSource({
      ...liveProcessBase,
      status: ExecutionProcessStatus.completed,
      completed_at: '2026-06-22T00:01:00Z',
    });
    source.executionProcessState[staticProcess.id].entries = [loadingEntry()];

    const timeline = deriveConversationSemanticTimeline(source);

    expect(timeline.processes[0].visibleEntries).toEqual([]);
  });

  it('hides loading placeholders when a running process has output', () => {
    const source = makeSource(liveProcessBase);
    source.executionProcessState[staticProcess.id].entries = [
      loadingEntry(),
      assistantEntry('Done'),
    ];

    const timeline = deriveConversationSemanticTimeline(source);

    expect(
      timeline.processes[0].visibleEntries.map((entry) =>
        entry.type === 'NORMALIZED_ENTRY' ? entry.content.content : ''
      )
    ).toEqual(['Done']);
  });

  it('keeps loading placeholders while a running process has no output', () => {
    const source = makeSource(liveProcessBase);
    source.executionProcessState[staticProcess.id].entries = [loadingEntry()];

    const timeline = deriveConversationSemanticTimeline(source);

    expect(timeline.processes[0].visibleEntries).toHaveLength(1);
    expect(
      timeline.processes[0].visibleEntries[0].type === 'NORMALIZED_ENTRY'
        ? timeline.processes[0].visibleEntries[0].content.entry_type.type
        : null
    ).toBe('loading');
  });
});
