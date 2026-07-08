import { useMemo } from 'react';
import type { AskUserQuestionItem } from 'shared/types';
import { useApprovals } from '@/shared/hooks/useApprovals';
import { useWorkspaceExecution } from '@/shared/hooks/useWorkspaceExecution';
import { isExecutionProcessActive } from '@/shared/lib/executionProcessRuntime';
import { useEntries } from '../contexts/EntriesContext';

export interface WorkspacePendingApproval {
  approvalId: string;
  executionProcessId: string;
  /** Raw tool name (e.g. the executor tool requesting approval). */
  toolName: string;
  timeoutAt: string;
  /** True when this is an ask_user_question rather than a tool approval. */
  isQuestion: boolean;
  /** Populated only for ask_user_question approvals. */
  questions?: AskUserQuestionItem[];
}

/**
 * Single source of truth for "the pending approval a user must act on in this
 * workspace right now". Scopes the global approvals stream to the workspace's
 * running processes and returns the first actionable approval (mirroring the
 * composer's one-at-a-time behavior).
 *
 * Consumed by both the composer footer (SessionChatBoxContainer) and the mobile
 * approval banner, so the detection/field-extraction logic lives in one place.
 */
export function useWorkspacePendingApproval(
  workspaceId: string | undefined
): WorkspacePendingApproval | null {
  const { getPendingForProcess } = useApprovals();
  const { processes } = useWorkspaceExecution(workspaceId);
  const { entries } = useEntries();

  return useMemo(() => {
    const runningProcesses = processes.filter((process) =>
      isExecutionProcessActive(process)
    );
    for (const proc of runningProcesses) {
      const info = getPendingForProcess(proc.id);
      if (info) {
        let questions: AskUserQuestionItem[] | undefined;
        for (const entry of entries) {
          if (entry.type !== 'NORMALIZED_ENTRY') continue;
          const entryType = entry.content.entry_type;
          if (
            entryType.type === 'tool_use' &&
            entryType.status.status === 'pending_approval' &&
            entryType.status.approval_id === info.approval_id &&
            entryType.action_type.action === 'ask_user_question'
          ) {
            questions = entryType.action_type.questions;
            break;
          }
        }
        return {
          approvalId: info.approval_id,
          executionProcessId: info.execution_process_id,
          toolName: info.tool_name,
          timeoutAt: info.timeout_at,
          isQuestion: info.is_question,
          questions,
        };
      }
    }
    return null;
  }, [processes, getPendingForProcess, entries]);
}
