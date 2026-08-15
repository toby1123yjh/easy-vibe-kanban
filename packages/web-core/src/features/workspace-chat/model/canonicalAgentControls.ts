import { agentRunsApi } from '@/shared/lib/agentRunApi';
import type { QuestionAnswer } from 'shared/types';

export interface CanonicalAgentControlClient {
  cancel(agentRunId: string, reason: string): Promise<unknown>;
  submitInput(
    agentRunId: string,
    inputId: string,
    content: string
  ): Promise<unknown>;
  resolveApproval(
    agentRunId: string,
    approvalId: string,
    approved: boolean,
    reason?: string
  ): Promise<unknown>;
}

export function createCanonicalAgentControls(
  client: CanonicalAgentControlClient
) {
  return {
    cancel: (agentRunId: string, reason: string) =>
      client.cancel(agentRunId, reason),
    submitInput: (agentRunId: string, inputId: string, content: string) =>
      client.submitInput(agentRunId, inputId, content),
    approve: (agentRunId: string, approvalId: string) =>
      client.resolveApproval(agentRunId, approvalId, true),
    deny: (agentRunId: string, approvalId: string, reason?: string) =>
      client.resolveApproval(agentRunId, approvalId, false, reason),
  };
}

export function serializeCanonicalInputAnswers(answers: QuestionAnswer[]) {
  return JSON.stringify({
    answers: answers.map(({ question, answer }) => ({ question, answer })),
  });
}

export const canonicalAgentControls =
  createCanonicalAgentControls(agentRunsApi);
