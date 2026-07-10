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
import { deriveConversationEntries } from './deriveConversationEntries';
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

function userEntry(
  content: string,
  metadata?: Record<string, unknown>
): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey: content,
    executionProcessId: staticProcess.id,
    content: {
      timestamp: null,
      content,
      entry_type: {
        type: 'user_message',
      },
      ...(metadata ? { metadata } : {}),
    },
  } as PatchTypeWithKey;
}

function nativeBackfillEntry(
  role: 'user_message' | 'assistant_message',
  content: string
): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey: content,
    executionProcessId: staticProcess.id,
    content: {
      timestamp: null,
      content,
      entry_type: {
        type: role,
      },
      metadata: {
        native_history_backfill: true,
      },
    },
  } as PatchTypeWithKey;
}

describe('deriveConversationSemanticTimeline', () => {
  it('treats created tool entries as inactive once the process is completed', () => {
    const source = makeSource({
      ...liveProcessBase,
      status: ExecutionProcessStatus.completed,
      completed_at: '2026-06-22T00:01:00Z',
    });
    source.executionProcessState[staticProcess.id].entries = [
      {
        type: 'NORMALIZED_ENTRY',
        patchKey: 'tool-1',
        executionProcessId: staticProcess.id,
        content: {
          timestamp: null,
          content: 'Bash',
          entry_type: {
            type: 'tool_use',
            tool_name: 'Bash',
            action_type: {
              action: 'command_run',
              command: 'pnpm test',
              result: null,
              category: 'other',
            },
            status: { status: 'created' },
          },
        },
      },
    ];

    const timeline = deriveConversationSemanticTimeline(source);

    expect(timeline.processes[0]).toMatchObject({
      isRunning: false,
      failedOrKilled: false,
    });
    expect(timeline.processes[0].visibleEntries).toHaveLength(1);
  });

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

  it('keeps native history user messages while hiding provider user echoes', () => {
    const source = makeSource({
      ...liveProcessBase,
      status: ExecutionProcessStatus.completed,
      completed_at: '2026-06-22T00:01:00Z',
    });
    source.executionProcessState[staticProcess.id].entries = [
      userEntry('provider echo'),
      nativeBackfillEntry('user_message', 'old question'),
    ];

    const timeline = deriveConversationSemanticTimeline(source);

    expect(
      timeline.processes[0].visibleEntries.map((entry) =>
        entry.type === 'NORMALIZED_ENTRY' ? entry.content.content : ''
      )
    ).toEqual(['old question']);
  });

  it('emits native history backfill before the current prompt', () => {
    const source = makeSource(liveProcessBase);
    source.executionProcessState[staticProcess.id].entries = [
      nativeBackfillEntry('user_message', 'old question'),
      nativeBackfillEntry('assistant_message', 'old answer'),
    ];

    const derived = deriveConversationEntries({
      source,
      scriptOutputCache: new Map(),
    });

    expect(
      derived.entries.map((entry) =>
        entry.type === 'NORMALIZED_ENTRY'
          ? [entry.content.entry_type.type, entry.content.content]
          : [entry.type, entry.content]
      )
    ).toEqual([
      ['user_message', 'old question'],
      ['assistant_message', 'old answer'],
      ['user_message', 'Implement feature'],
      ['loading', ''],
    ]);
  });
});
