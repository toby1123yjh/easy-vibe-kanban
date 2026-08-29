import {
  projectAgentWorkbenchTimeline,
  type AgentWorkbenchTimelineCopy,
} from '@/features/agent-workbench/model/agentWorkbenchTimeline';
import type {
  DisplayEntry,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';

import {
  buildConversationRowsIncremental,
  type ConversationRow,
} from './conversation-row-model';

export interface DerivedConversationTimeline {
  readonly displayEntries: DisplayEntry[];
  readonly rows: ConversationRow[];
}

function isRenderableConversationEntry(entry: DisplayEntry): boolean {
  if (
    entry.type === 'NORMALIZED_ENTRY' &&
    typeof entry.content !== 'string' &&
    'entry_type' in entry.content
  ) {
    const entryType = entry.content.entry_type.type;
    return entryType !== 'next_action' && entryType !== 'token_usage_info';
  }

  return (
    entry.type === 'NORMALIZED_ENTRY' ||
    entry.type === 'STDOUT' ||
    entry.type === 'STDERR' ||
    entry.type === 'AGGREGATED_GROUP' ||
    entry.type === 'AGGREGATED_DIFF_GROUP' ||
    entry.type === 'AGGREGATED_FILE_CHANGE_GROUP' ||
    entry.type === 'AGGREGATED_THINKING_GROUP'
  );
}

// Final UI-facing timeline step: aggregate display entries and build stable rows
// for virtualization, navigation, and scroll orchestration.

export function deriveConversationTimeline(
  entries: PatchTypeWithKey[],
  _source: import('@/shared/hooks/useConversationHistory/types').ConversationTimelineSource,
  previousDisplayEntries: DisplayEntry[],
  previousRows: ConversationRow[],
  copy?: AgentWorkbenchTimelineCopy
): DerivedConversationTimeline {
  const entriesByKey = new Map(entries.map((entry) => [entry.patchKey, entry]));
  const displayEntries = projectAgentWorkbenchTimeline(
    {
      ..._source.canonical,
      entries,
    },
    copy
  )
    .flatMap((item): DisplayEntry[] => {
      if (item.kind !== 'tool-group') {
        const sourceEntry = entriesByKey.get(item.patchKey);
        if (sourceEntry) return [sourceEntry];
        if (item.kind !== 'status') return [];
        return [
          {
            type: 'NORMALIZED_ENTRY',
            content: {
              entry_type: { type: 'system_message' },
              content: item.content,
              timestamp: item.timestamp,
            },
            patchKey: item.patchKey,
            canonical:
              item.agentRunId &&
              item.runAttemptId &&
              item.runAttemptNumber !== null &&
              item.eventId &&
              item.sequence !== null
                ? {
                    agentRunId: item.agentRunId,
                    runAttemptId: item.runAttemptId,
                    runAttemptNumber: item.runAttemptNumber,
                    eventId: item.eventId,
                    eventIds: item.eventIds,
                    sequence: item.sequence,
                    active: item.active,
                  }
                : undefined,
          },
        ];
      }
      const groupedEntries = item.items.flatMap((tool) => {
        const sourceEntry = entriesByKey.get(tool.patchKey);
        return sourceEntry ? [sourceEntry] : [];
      });
      if (groupedEntries.length < 2) return groupedEntries;
      return [
        {
          type: 'AGGREGATED_GROUP',
          aggregationType: 'tool_calls',
          isRunning: item.active,
          entries: groupedEntries,
          patchKey: item.patchKey,
          executionProcessId:
            groupedEntries[0]?.executionProcessId ?? undefined,
        },
      ];
    })
    .filter(isRenderableConversationEntry);

  const rows = buildConversationRowsIncremental(
    displayEntries,
    previousDisplayEntries,
    previousRows
  );

  return {
    displayEntries,
    rows,
  };
}
