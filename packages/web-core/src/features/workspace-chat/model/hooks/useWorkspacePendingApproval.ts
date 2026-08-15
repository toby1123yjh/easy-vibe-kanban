import { useMemo } from 'react';
import type { AskUserQuestionItem } from 'shared/types';
import {
  deriveCanonicalAgentRunActionPolicy,
  findLatestUnresolvedCanonicalControl,
} from '@/features/agent-runtime';
import { useCanonicalAgentSession } from '../contexts/EntriesContext';

export type WorkspacePendingApproval =
  | {
      kind: 'approval';
      agentRunId: string;
      approvalId: string;
      controlId: string;
      toolName: string;
    }
  | {
      kind: 'input';
      agentRunId: string;
      inputId: string;
      controlId: string;
      prompt: string;
      questions: AskUserQuestionItem[];
    };

/**
 * Single source of truth for "the pending approval a user must act on in this
 * session right now". Canonical AgentRun state and events are the only source
 * of lifecycle and pending-control facts.
 *
 * Consumed by both the composer footer (SessionChatBoxContainer) and the mobile
 * approval banner, so the detection/field-extraction logic lives in one place.
 */
export function useWorkspacePendingApproval(): WorkspacePendingApproval | null {
  const { timeline } = useCanonicalAgentSession();

  return useMemo(() => {
    const run = timeline?.activeRun;
    if (!run) return null;

    const state = run.timeline?.state ?? run.summary.state;
    const events = run.timeline?.events ?? [];
    const policy = deriveCanonicalAgentRunActionPolicy(state, events);
    const agentRunId = run.summary.agent_run_id;

    if (policy.resolve_approval.allowed) {
      const control = findLatestUnresolvedCanonicalControl(events, 'approval');
      if (control?.kind === 'approval') {
        return {
          kind: 'approval',
          agentRunId,
          approvalId: control.controlId,
          controlId: control.controlId,
          toolName: control.toolName,
        };
      }
    }

    if (policy.submit_input.allowed) {
      const control = findLatestUnresolvedCanonicalControl(events, 'input');
      if (control?.kind === 'input') {
        return {
          kind: 'input',
          agentRunId,
          inputId: control.controlId,
          controlId: control.controlId,
          prompt: control.prompt,
          questions: [
            {
              question: control.prompt,
              header: 'Agent input',
              options: [],
              multiSelect: false,
            },
          ],
        };
      }
    }

    return null;
  }, [timeline]);
}
