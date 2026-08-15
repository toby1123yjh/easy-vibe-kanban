import type {
  PatchTypeWithKey,
  DisplayEntry,
  AggregatedPatchGroup,
  AggregatedFileChangeGroup,
  AggregatedThinkingGroup,
  ToolAggregationType,
} from '@/shared/hooks/useConversationHistory/types';

/**
 * Checks if a patch entry is a user_message entry.
 */
function isUserMessage(entry: PatchTypeWithKey): boolean {
  if (entry.type !== 'NORMALIZED_ENTRY') return false;
  return entry.content.entry_type.type === 'user_message';
}

/**
 * Checks if a patch entry is a thinking entry.
 */
function isThinkingEntry(entry: PatchTypeWithKey): boolean {
  if (entry.type !== 'NORMALIZED_ENTRY') return false;
  return entry.content.entry_type.type === 'thinking';
}

/**
 * Extracts the file path from a file_edit entry, or null if not a file_edit entry.
 */
function getFileEditPath(entry: PatchTypeWithKey): string | null {
  if (entry.type !== 'NORMALIZED_ENTRY') return null;

  const entryType = entry.content.entry_type;
  if (entryType.type !== 'tool_use') return null;

  const { action_type } = entryType;
  if (action_type.action === 'file_edit') {
    return action_type.path;
  }

  return null;
}

/**
 * Determines if a patch entry can be aggregated and returns its aggregation type.
 * Handles file_read, search, web_fetch, and command_run.
 */
function getAggregationType(
  entry: PatchTypeWithKey
): ToolAggregationType | null {
  if (entry.type !== 'NORMALIZED_ENTRY') return null;

  const entryType = entry.content.entry_type;
  if (entryType.type !== 'tool_use') return null;

  const { action_type } = entryType;
  if (action_type.action === 'file_read') return 'file_read';
  if (action_type.action === 'search') return 'search';
  if (action_type.action === 'web_fetch') return 'web_fetch';

  if (action_type.action === 'command_run') {
    return 'command_run';
  }

  return null;
}

function isActiveToolEntry(
  entry: PatchTypeWithKey,
  runningProcessIds: ReadonlySet<string>
): boolean {
  if (entry.type !== 'NORMALIZED_ENTRY') return false;

  const entryType = entry.content.entry_type;
  if (entryType.type !== 'tool_use') return false;

  if (entry.canonical) return entry.canonical.active;
  if (entryType.status.status === 'pending_approval') return true;
  if (entryType.status.status !== 'created') return false;

  return Boolean(
    entry.executionProcessId && runningProcessIds.has(entry.executionProcessId)
  );
}

/**
 * First pass: group consecutive thinking entries within each turn.
 * Previous turns are always grouped. The latest turn is grouped once its
 * execution process is no longer running.
 */
function aggregateThinkingInPreviousTurns(
  entries: PatchTypeWithKey[],
  runningProcessIds: ReadonlySet<string> = new Set()
): PatchTypeWithKey[] {
  if (entries.length === 0) return [];

  // Find all user message indices
  const userMessageIndices: number[] = [];
  entries.forEach((entry, index) => {
    if (isUserMessage(entry)) {
      userMessageIndices.push(index);
    }
  });

  // The last user message index marks the start of the "current" turn
  const lastUserMessageIndex =
    userMessageIndices.length > 1
      ? userMessageIndices[userMessageIndices.length - 1]
      : -1;

  // Process entries, grouping thinking entries in previous turns
  const result: PatchTypeWithKey[] = [];
  let currentThinkingGroup: PatchTypeWithKey[] = [];

  const flushThinkingGroup = () => {
    if (currentThinkingGroup.length === 0) return;

    if (currentThinkingGroup.length === 1) {
      // Single thinking entry - create a group anyway for consistency in collapsed view
      const entry = currentThinkingGroup[0];
      const aggregatedGroup: AggregatedThinkingGroup = {
        type: 'AGGREGATED_THINKING_GROUP',
        entries: [...currentThinkingGroup],
        patchKey: `agg-thinking:${entry.patchKey}`,
        executionProcessId: entry.executionProcessId,
      };
      // Cast to PatchTypeWithKey to maintain the array type
      result.push(aggregatedGroup as unknown as PatchTypeWithKey);
    } else {
      // Multiple entries - create an aggregated thinking group
      const firstEntry = currentThinkingGroup[0];
      const aggregatedGroup: AggregatedThinkingGroup = {
        type: 'AGGREGATED_THINKING_GROUP',
        entries: [...currentThinkingGroup],
        patchKey: `agg-thinking:${firstEntry.patchKey}`,
        executionProcessId: firstEntry.executionProcessId,
      };
      // Cast to PatchTypeWithKey to maintain the array type
      result.push(aggregatedGroup as unknown as PatchTypeWithKey);
    }

    currentThinkingGroup = [];
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isInPreviousTurn = i < lastUserMessageIndex;
    const isInCompletedProcess = entry.canonical
      ? !entry.canonical.active
      : !entry.executionProcessId ||
        !runningProcessIds.has(entry.executionProcessId);

    // Track turn boundaries
    if (isUserMessage(entry)) {
      // Flush any pending thinking group before the user message
      flushThinkingGroup();
      result.push(entry);
      continue;
    }

    // Aggregate previous-turn thinking and completed latest-turn thinking.
    if ((isInPreviousTurn || isInCompletedProcess) && isThinkingEntry(entry)) {
      currentThinkingGroup.push(entry);
    } else {
      // Flush any pending thinking group
      flushThinkingGroup();
      result.push(entry);
    }
  }

  // Flush any remaining thinking group
  flushThinkingGroup();

  return result;
}

/**
 * Aggregates consecutive tool activity into grouped entries for accordion-style
 * display.
 *
 * Also aggregates consecutive file_edit entries into one file-change group.
 * Also aggregates thinking entries in previous conversation turns.
 *
 * Rules:
 * - Read/search/fetch/command entries are grouped together even when they are
 *   different tool types
 * - Consecutive file_edit entries are grouped even when they touch different paths
 * - Thinking entries in previous turns (before the last user message) are collapsed
 * - Preserve the original order of entries
 * - Completed tool activity is grouped even when it contains one entry
 */
export function aggregateConsecutiveEntries(
  entries: PatchTypeWithKey[],
  runningProcessIds: ReadonlySet<string> = new Set()
): DisplayEntry[] {
  if (entries.length === 0) return [];

  // First pass: aggregate thinking entries in previous turns
  const entriesWithThinkingAggregated = aggregateThinkingInPreviousTurns(
    entries,
    runningProcessIds
  );

  const result: DisplayEntry[] = [];

  // State for tool aggregation (file_read, search, web_fetch, command_run_*)
  let currentToolGroup: PatchTypeWithKey[] = [];
  let currentAggregationType: ToolAggregationType | null = null;

  // State for file-change aggregation (file_edit across one or more paths)
  let currentFileChangeGroup: PatchTypeWithKey[] = [];

  const flushToolGroup = () => {
    if (currentToolGroup.length === 0) return;

    if (
      currentToolGroup.length === 1 &&
      currentAggregationType !== 'tool_calls'
    ) {
      // Single entry - don't aggregate, return as-is
      result.push(currentToolGroup[0]);
    } else {
      // Multiple entries - create an aggregated group
      const firstEntry = currentToolGroup[0];
      const aggregatedGroup: AggregatedPatchGroup = {
        type: 'AGGREGATED_GROUP',
        aggregationType: currentAggregationType!,
        isRunning: currentToolGroup.some((entry) =>
          isActiveToolEntry(entry, runningProcessIds)
        ),
        entries: [...currentToolGroup],
        patchKey: `agg:${firstEntry.patchKey}`,
        executionProcessId: firstEntry.executionProcessId,
      };
      result.push(aggregatedGroup);
    }

    currentToolGroup = [];
    currentAggregationType = null;
  };

  const flushFileChangeGroup = () => {
    if (currentFileChangeGroup.length === 0) return;

    if (currentFileChangeGroup.length === 1) {
      // Single entry - don't aggregate, return as-is
      result.push(currentFileChangeGroup[0]);
    } else {
      // Multiple file edits - create an aggregated file-change group
      const firstEntry = currentFileChangeGroup[0];
      const aggregatedFileChangeGroup: AggregatedFileChangeGroup = {
        type: 'AGGREGATED_FILE_CHANGE_GROUP',
        entries: [...currentFileChangeGroup],
        patchKey: `agg-file-change:${firstEntry.patchKey}`,
        executionProcessId: firstEntry.executionProcessId,
      };
      result.push(aggregatedFileChangeGroup);
    }

    currentFileChangeGroup = [];
  };

  for (const entry of entriesWithThinkingAggregated) {
    // Check if this is already an aggregated thinking group (from first pass)
    if (
      (entry as unknown as AggregatedThinkingGroup).type ===
      'AGGREGATED_THINKING_GROUP'
    ) {
      flushToolGroup();
      flushFileChangeGroup();
      result.push(entry as unknown as DisplayEntry);
      continue;
    }

    const aggregationType = getAggregationType(entry);
    const shouldWrapToolActivity = aggregationType !== null;
    const fileEditPath = getFileEditPath(entry);

    // Handle file_edit entries
    if (fileEditPath !== null) {
      // Flush any pending tool group first
      flushToolGroup();
      currentFileChangeGroup.push(entry);
    }
    // Handle tool aggregation (file_read, search, web_fetch, command_run)
    else if (shouldWrapToolActivity) {
      // Flush any pending file-change group first
      flushFileChangeGroup();

      if (currentToolGroup.length > 0) {
        const currentGroupIsRunning = currentToolGroup.some((groupEntry) =>
          isActiveToolEntry(groupEntry, runningProcessIds)
        );
        const nextEntryIsRunning = isActiveToolEntry(entry, runningProcessIds);

        if (
          currentAggregationType !== 'tool_calls' ||
          (!currentGroupIsRunning && nextEntryIsRunning)
        ) {
          flushToolGroup();
        }
      }

      currentAggregationType = 'tool_calls';
      currentToolGroup.push(entry);
    }
    // Non-aggregatable entry
    else {
      // Flush any pending groups and add this entry
      flushToolGroup();
      flushFileChangeGroup();
      result.push(entry);
    }
  }

  // Flush any remaining groups
  flushToolGroup();
  flushFileChangeGroup();

  return result;
}
