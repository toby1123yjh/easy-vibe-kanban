import type { ExecutionProcess } from 'shared/types';
import {
  isExecutionProcessActive,
  isExecutionProcessFailedLike,
} from '@/shared/lib/executionProcessRuntime';

import type {
  ConversationTimelineSource,
  ExecutionProcessState,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';
import { isNativeHistoryBackfillEntry } from './nativeHistoryBackfill';

// Agent runs are projected from the canonical AgentRun stream. Execution
// processes are retained here only for standalone script rendering.
export type ConversationSemanticProcessKind = 'script' | 'unknown';

export interface ConversationSemanticProcessItem {
  readonly executionProcessId: string;
  readonly executionProcess: ExecutionProcessState['executionProcess'];
  readonly kind: ConversationSemanticProcessKind;
  readonly liveExecutionProcess: ExecutionProcess | null;
  readonly rawEntries: PatchTypeWithKey[];
  readonly visibleEntries: PatchTypeWithKey[];
  readonly latestTokenUsageEntry: PatchTypeWithKey | null;
  readonly hasPendingApprovalEntry: boolean;
  readonly isRunning: boolean;
  readonly failedOrKilled: boolean;
}

export interface ConversationSemanticTimeline {
  readonly processes: ConversationSemanticProcessItem[];
  readonly hasSetupScriptProcess: boolean;
  readonly hasSetupScriptWithPrompt: boolean;
}

// This is the first semantic reshape after the raw source model.
// It keeps process-level information but removes direct store traversal from later stages.

function toConversationSemanticProcessKind(
  executionProcess: ExecutionProcessState['executionProcess']
): ConversationSemanticProcessKind {
  const actionType = executionProcess.executor_action.typ.type;

  if (actionType === 'ScriptRequest') {
    return 'script';
  }

  return 'unknown';
}

function isInternalSystemEntry(entry: PatchTypeWithKey): boolean {
  if (entry.type !== 'NORMALIZED_ENTRY') return false;
  if (entry.content.entry_type.type !== 'system_message') return false;

  const content = entry.content.content.trim();
  return (
    content === 'requesting' ||
    content === 'System: api_retry' ||
    content === 'System: hook_started' ||
    content === 'System: hook_response' ||
    content === 'System: thinking_tokens' ||
    content.startsWith('System initialized with model:') ||
    content.startsWith('Unsupported Codex event: userMessage')
  );
}

function isLoadingEntry(entry: PatchTypeWithKey): boolean {
  return (
    entry.type === 'NORMALIZED_ENTRY' &&
    entry.content.entry_type.type === 'loading'
  );
}

function isAgentOutputEntry(entry: PatchTypeWithKey): boolean {
  if (entry.type !== 'NORMALIZED_ENTRY') return true;

  switch (entry.content.entry_type.type) {
    case 'system_message':
    case 'token_usage_info':
    case 'loading':
      return false;
    case 'user_message':
      return false;
    default:
      return !isNativeHistoryBackfillEntry(entry);
  }
}

export function deriveConversationSemanticTimeline(
  source: ConversationTimelineSource
): ConversationSemanticTimeline {
  const liveExecutionProcessesById = new Map(
    source.liveExecutionProcesses.map((process) => [process.id, process])
  );

  const processes = Object.values(source.executionProcessState)
    .sort(
      (a, b) =>
        new Date(a.executionProcess.created_at as unknown as string).getTime() -
        new Date(b.executionProcess.created_at as unknown as string).getTime()
    )
    .map((processState) => {
      const executionProcessId = processState.executionProcess.id;
      const liveExecutionProcess =
        liveExecutionProcessesById.get(executionProcessId) ?? null;
      const isRunning = liveExecutionProcess
        ? isExecutionProcessActive(liveExecutionProcess)
        : false;
      const failedOrKilled = liveExecutionProcess
        ? isExecutionProcessFailedLike(liveExecutionProcess)
        : false;
      const latestTokenUsageEntry =
        processState.entries.findLast(
          (entry) =>
            entry.type === 'NORMALIZED_ENTRY' &&
            entry.content.entry_type.type === 'token_usage_info'
        ) ?? null;

      const candidateVisibleEntries = processState.entries.filter(
        (entry) =>
          entry.type !== 'NORMALIZED_ENTRY' ||
          ((entry.content.entry_type.type !== 'user_message' ||
            isNativeHistoryBackfillEntry(entry)) &&
            entry.content.entry_type.type !== 'token_usage_info' &&
            !isInternalSystemEntry(entry))
      );
      const hasAgentOutput = candidateVisibleEntries.some(isAgentOutputEntry);
      const visibleEntries = candidateVisibleEntries.filter(
        (entry) => !isLoadingEntry(entry) || (isRunning && !hasAgentOutput)
      );

      const hasPendingApprovalEntry = visibleEntries.some((entry) => {
        if (entry.type !== 'NORMALIZED_ENTRY') return false;
        const entryType = entry.content.entry_type;
        return (
          entryType.type === 'tool_use' &&
          entryType.status.status === 'pending_approval'
        );
      });

      return {
        executionProcessId,
        executionProcess: processState.executionProcess,
        kind: toConversationSemanticProcessKind(processState.executionProcess),
        liveExecutionProcess,
        rawEntries: processState.entries,
        visibleEntries,
        latestTokenUsageEntry,
        hasPendingApprovalEntry,
        isRunning,
        failedOrKilled,
      } satisfies ConversationSemanticProcessItem;
    });

  return {
    processes,
    hasSetupScriptProcess: processes.some(
      (process) =>
        process.executionProcess.executor_action.typ.type === 'ScriptRequest' &&
        process.executionProcess.executor_action.typ.context === 'SetupScript'
    ),
    // The initial prompt is now a canonical AgentRun message. Never infer it
    // from an ExecutionProcess action chain.
    hasSetupScriptWithPrompt: false,
  };
}
