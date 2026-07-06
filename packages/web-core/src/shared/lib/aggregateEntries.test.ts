import { describe, expect, it } from 'vitest';
import type { ActionType } from 'shared/types';
import type { PatchTypeWithKey } from '@/shared/hooks/useConversationHistory/types';

import { aggregateConsecutiveEntries } from './aggregateEntries';

function toolEntry(patchKey: string, actionType: ActionType): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey,
    executionProcessId: 'process-1',
    content: {
      timestamp: null,
      content: '',
      entry_type: {
        type: 'tool_use',
        tool_name: actionType.action === 'command_run' ? 'Bash' : 'Tool',
        action_type: actionType,
        status: { status: 'success' },
      },
    },
  };
}

function userEntry(patchKey: string): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey,
    executionProcessId: 'process-1',
    content: {
      timestamp: null,
      content: 'Prompt',
      entry_type: {
        type: 'user_message',
      },
    },
  };
}

function thinkingEntry(
  patchKey: string,
  executionProcessId = 'process-1'
): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    patchKey,
    executionProcessId,
    content: {
      timestamp: null,
      content: 'Thinking text',
      entry_type: {
        type: 'thinking',
      },
    },
  };
}

describe('aggregateConsecutiveEntries', () => {
  it('wraps running command runs into an in-progress tool call group', () => {
    const result = aggregateConsecutiveEntries(
      [
        toolEntry('1', {
          action: 'command_run',
          command: 'pnpm test',
          category: 'other',
          result: null,
        }),
        toolEntry('2', {
          action: 'command_run',
          command: 'pnpm build',
          category: 'other',
          result: null,
        }),
      ],
      new Set(['process-1'])
    );

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('AGGREGATED_GROUP');
    if (result[0].type === 'AGGREGATED_GROUP') {
      expect(result[0].aggregationType).toBe('tool_calls');
      expect(result[0].isRunning).toBe(true);
      expect(result[0].entries).toHaveLength(2);
    }
  });

  it('wraps completed mixed tool activity into one group', () => {
    const result = aggregateConsecutiveEntries([
      toolEntry('1', {
        action: 'search',
        query: '**/*.md',
      }),
      toolEntry('2', {
        action: 'file_read',
        path: 'README.md',
      }),
      toolEntry('3', {
        action: 'command_run',
        command: 'ls -la',
        category: 'read',
        result: null,
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('AGGREGATED_GROUP');
    if (result[0].type === 'AGGREGATED_GROUP') {
      expect(result[0].aggregationType).toBe('tool_calls');
      expect(result[0].isRunning).toBe(false);
      expect(result[0].entries.map((entry) => entry.patchKey)).toEqual([
        '1',
        '2',
        '3',
      ]);
    }
  });

  it('groups consecutive file edits across different files', () => {
    const result = aggregateConsecutiveEntries([
      toolEntry('1', {
        action: 'file_edit',
        path: 'src/a.ts',
        changes: [{ action: 'write', content: 'export const a = 1;\n' }],
      }),
      toolEntry('2', {
        action: 'file_edit',
        path: 'src/b.ts',
        changes: [{ action: 'write', content: 'export const b = 1;\n' }],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('AGGREGATED_FILE_CHANGE_GROUP');
    if (result[0].type === 'AGGREGATED_FILE_CHANGE_GROUP') {
      expect(result[0].entries).toHaveLength(2);
    }
  });

  it('collapses thinking for a completed latest turn', () => {
    const result = aggregateConsecutiveEntries([
      userEntry('user-1'),
      thinkingEntry('thinking-1'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('AGGREGATED_THINKING_GROUP');
    if (result[1].type === 'AGGREGATED_THINKING_GROUP') {
      expect(result[1].entries).toHaveLength(1);
    }
  });

  it('keeps thinking expanded for a running latest turn', () => {
    const result = aggregateConsecutiveEntries(
      [userEntry('user-1'), thinkingEntry('thinking-1')],
      new Set(['process-1'])
    );

    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('NORMALIZED_ENTRY');
    if (result[1].type === 'NORMALIZED_ENTRY') {
      expect(result[1].content.entry_type.type).toBe('thinking');
    }
  });
});
