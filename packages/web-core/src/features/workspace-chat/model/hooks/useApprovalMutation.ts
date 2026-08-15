import { useMutation } from '@tanstack/react-query';
import type { QuestionAnswer } from 'shared/types';
import {
  canonicalAgentControls,
  serializeCanonicalInputAnswers,
} from '../canonicalAgentControls';

interface ApproveParams {
  approvalId: string;
  agentRunId: string;
}

interface DenyParams extends ApproveParams {
  reason?: string;
}

interface AnswerParams {
  agentRunId: string;
  inputId: string;
  answers: QuestionAnswer[];
}

export function useApprovalMutation() {
  const approveMutation = useMutation({
    mutationFn: ({ approvalId, agentRunId }: ApproveParams) =>
      canonicalAgentControls.approve(agentRunId, approvalId),
    onError: (err) => {
      console.error('Failed to approve:', err);
    },
  });

  const denyMutation = useMutation({
    mutationFn: ({ approvalId, agentRunId, reason }: DenyParams) =>
      canonicalAgentControls.deny(
        agentRunId,
        approvalId,
        reason || 'User denied this request.'
      ),
    onError: (err) => {
      console.error('Failed to deny:', err);
    },
  });

  const answerMutation = useMutation({
    mutationFn: ({ agentRunId, inputId, answers }: AnswerParams) =>
      canonicalAgentControls.submitInput(
        agentRunId,
        inputId,
        serializeCanonicalInputAnswers(answers)
      ),
    onError: (err) => {
      console.error('Failed to answer:', err);
    },
  });

  return {
    approve: approveMutation.mutate,
    approveAsync: approveMutation.mutateAsync,
    deny: denyMutation.mutate,
    denyAsync: denyMutation.mutateAsync,
    answer: answerMutation.mutate,
    answerAsync: answerMutation.mutateAsync,
    isApproving: approveMutation.isPending,
    isDenying: denyMutation.isPending,
    isAnswering: answerMutation.isPending,
    isResponding:
      approveMutation.isPending ||
      denyMutation.isPending ||
      answerMutation.isPending,
    approveError: approveMutation.error,
    denyError: denyMutation.error,
    answerError: answerMutation.error,
    reset: () => {
      approveMutation.reset();
      denyMutation.reset();
      answerMutation.reset();
    },
  };
}
