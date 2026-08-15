import {
  AgentProviderCapability,
  type AgentProviderPolicy,
} from 'shared/types';
import { getAgentProviderBlockedReason } from './agentProviderOptions';

export type RuntimeAction =
  | 'send_initial'
  | 'send_follow_up'
  | 'queue_follow_up'
  | 'cancel_queue'
  | 'stop'
  | 'approve'
  | 'request_changes'
  | 'answer_question'
  | 'retry'
  | 'resume';

export type RuntimeActionBlockedReason =
  | 'no_content'
  | 'no_workspace'
  | 'no_session'
  | 'no_executor'
  | 'provider_not_ready'
  | 'provider_capability_missing'
  | 'runtime_starting'
  | 'runtime_busy'
  | 'runtime_cancelling'
  | 'runtime_terminal'
  | 'approval_timed_out'
  | 'approval_required'
  | 'question_required'
  | 'queue_already_present'
  | 'queue_empty'
  | 'unknown_runtime';

export interface RuntimeActionDecision {
  action: RuntimeAction;
  allowed: boolean;
  reason: RuntimeActionBlockedReason | null;
}

export type RuntimeActionPolicy = Record<RuntimeAction, RuntimeActionDecision>;

export interface RuntimeActionPolicyInput {
  hasContent: boolean;
  hasWorkspace: boolean;
  hasSession: boolean;
  hasExecutor: boolean;
  isNewSessionMode: boolean;
  hasPriorAgentRun: boolean;
  isAgentRunActive: boolean;
  isAgentRunCancelling: boolean;
  isLatestAgentRunTerminal: boolean;
  isStandaloneScriptActive: boolean;
  canCancelAgentRun: boolean;
  canResolveApproval: boolean;
  canSubmitInput: boolean;
  isSending: boolean;
  isStopping: boolean;
  isQueueLoading: boolean;
  isQueued: boolean;
  hasPendingApproval: boolean;
  hasPendingQuestion: boolean;
  isApprovalTimedOut: boolean;
  isApprovalSubmitting?: boolean;
  isQuestionSubmitting?: boolean;
  providerPolicy?: AgentProviderPolicy | null;
}

function allow(action: RuntimeAction): RuntimeActionDecision {
  return { action, allowed: true, reason: null };
}

function block(
  action: RuntimeAction,
  reason: RuntimeActionBlockedReason
): RuntimeActionDecision {
  return { action, allowed: false, reason };
}

function mutationBlockReason(
  input: RuntimeActionPolicyInput
): RuntimeActionBlockedReason | null {
  if (input.isStopping) return 'runtime_cancelling';
  if (input.isSending || input.isQueueLoading) return 'runtime_starting';
  return null;
}

function ownedInputModeBlockReason(
  input: RuntimeActionPolicyInput
): RuntimeActionBlockedReason | null {
  if (input.hasPendingQuestion) return 'question_required';
  if (input.hasPendingApproval) return 'approval_required';
  return null;
}

export function deriveRuntimeActionPolicy(
  input: RuntimeActionPolicyInput
): RuntimeActionPolicy {
  const isCancelling = input.isStopping || input.isAgentRunCancelling;

  const providerInitialBlock = getAgentProviderBlockedReason(
    input.providerPolicy,
    [AgentProviderCapability.INITIAL_RUN]
  );
  const providerFollowUpBlock = getAgentProviderBlockedReason(
    input.providerPolicy,
    [AgentProviderCapability.FOLLOW_UP]
  );
  const mutationBlock = mutationBlockReason(input);
  const ownedInputBlock = ownedInputModeBlockReason(input);

  let sendInitial = block('send_initial', 'no_content');
  if (!input.hasWorkspace) {
    sendInitial = block('send_initial', 'no_workspace');
  } else if (!input.hasExecutor) {
    sendInitial = block('send_initial', 'no_executor');
  } else if (!input.hasContent) {
    sendInitial = block('send_initial', 'no_content');
  } else if (!input.isNewSessionMode && input.hasPriorAgentRun) {
    sendInitial = block('send_initial', 'unknown_runtime');
  } else if (mutationBlock) {
    sendInitial = block('send_initial', mutationBlock);
  } else if (isCancelling) {
    sendInitial = block('send_initial', 'runtime_cancelling');
  } else if (input.isAgentRunActive || input.isStandaloneScriptActive) {
    sendInitial = block('send_initial', 'runtime_busy');
  } else if (providerInitialBlock) {
    sendInitial = block('send_initial', providerInitialBlock);
  } else {
    sendInitial = allow('send_initial');
  }

  let sendFollowUp = block('send_follow_up', 'no_content');
  if (!input.hasWorkspace) {
    sendFollowUp = block('send_follow_up', 'no_workspace');
  } else if (!input.hasSession) {
    sendFollowUp = block('send_follow_up', 'no_session');
  } else if (!input.hasExecutor) {
    sendFollowUp = block('send_follow_up', 'no_executor');
  } else if (!input.hasContent) {
    sendFollowUp = block('send_follow_up', 'no_content');
  } else if (!input.hasPriorAgentRun) {
    sendFollowUp = block('send_follow_up', 'unknown_runtime');
  } else if (ownedInputBlock) {
    sendFollowUp = block('send_follow_up', ownedInputBlock);
  } else if (input.isQueued) {
    sendFollowUp = block('send_follow_up', 'queue_already_present');
  } else if (mutationBlock) {
    sendFollowUp = block('send_follow_up', mutationBlock);
  } else if (isCancelling) {
    sendFollowUp = block('send_follow_up', 'runtime_cancelling');
  } else if (input.isAgentRunActive || input.isStandaloneScriptActive) {
    sendFollowUp = block('send_follow_up', 'runtime_busy');
  } else if (providerFollowUpBlock) {
    sendFollowUp = block('send_follow_up', providerFollowUpBlock);
  } else {
    sendFollowUp = allow('send_follow_up');
  }

  let queueFollowUp = block('queue_follow_up', 'no_content');
  if (!input.hasWorkspace) {
    queueFollowUp = block('queue_follow_up', 'no_workspace');
  } else if (!input.hasSession) {
    queueFollowUp = block('queue_follow_up', 'no_session');
  } else if (!input.hasExecutor) {
    queueFollowUp = block('queue_follow_up', 'no_executor');
  } else if (!input.hasContent) {
    queueFollowUp = block('queue_follow_up', 'no_content');
  } else if (ownedInputBlock) {
    queueFollowUp = block('queue_follow_up', ownedInputBlock);
  } else if (input.isQueued) {
    queueFollowUp = block('queue_follow_up', 'queue_already_present');
  } else if (mutationBlock) {
    queueFollowUp = block('queue_follow_up', mutationBlock);
  } else if (isCancelling) {
    queueFollowUp = block('queue_follow_up', 'runtime_cancelling');
  } else if (!input.isAgentRunActive) {
    queueFollowUp = block(
      'queue_follow_up',
      input.isLatestAgentRunTerminal ? 'runtime_terminal' : 'unknown_runtime'
    );
  } else if (providerFollowUpBlock) {
    queueFollowUp = block('queue_follow_up', providerFollowUpBlock);
  } else {
    queueFollowUp = allow('queue_follow_up');
  }

  let cancelQueue = block('cancel_queue', 'queue_empty');
  if (!input.hasSession) {
    cancelQueue = block('cancel_queue', 'no_session');
  } else if (input.isQueueLoading) {
    cancelQueue = block('cancel_queue', 'runtime_starting');
  } else if (!input.isQueued) {
    cancelQueue = block('cancel_queue', 'queue_empty');
  } else {
    cancelQueue = allow('cancel_queue');
  }

  let stop = block('stop', 'unknown_runtime');
  if (!input.hasWorkspace) {
    stop = block('stop', 'no_workspace');
  } else if (isCancelling) {
    stop = block('stop', 'runtime_cancelling');
  } else if (!input.canCancelAgentRun && !input.isStandaloneScriptActive) {
    stop = block(
      'stop',
      input.isLatestAgentRunTerminal ? 'runtime_terminal' : 'unknown_runtime'
    );
  } else {
    stop = allow('stop');
  }

  let approve = block('approve', 'approval_required');
  if (!input.hasSession) {
    approve = block('approve', 'no_session');
  } else if (!input.hasPendingApproval) {
    approve = block('approve', 'approval_required');
  } else if (!input.canResolveApproval) {
    approve = block('approve', 'unknown_runtime');
  } else if (input.isApprovalTimedOut) {
    approve = block('approve', 'approval_timed_out');
  } else if (input.isApprovalSubmitting || input.isStopping) {
    approve = block('approve', 'runtime_starting');
  } else {
    approve = allow('approve');
  }

  let requestChanges = block('request_changes', 'approval_required');
  if (!input.hasSession) {
    requestChanges = block('request_changes', 'no_session');
  } else if (!input.hasPendingApproval) {
    requestChanges = block('request_changes', 'approval_required');
  } else if (!input.canResolveApproval) {
    requestChanges = block('request_changes', 'unknown_runtime');
  } else if (input.isApprovalTimedOut) {
    requestChanges = block('request_changes', 'approval_timed_out');
  } else if (!input.hasContent) {
    requestChanges = block('request_changes', 'no_content');
  } else if (input.isApprovalSubmitting || input.isStopping) {
    requestChanges = block('request_changes', 'runtime_starting');
  } else {
    requestChanges = allow('request_changes');
  }

  let answerQuestion = block('answer_question', 'question_required');
  if (!input.hasSession) {
    answerQuestion = block('answer_question', 'no_session');
  } else if (!input.hasPendingQuestion) {
    answerQuestion = block('answer_question', 'question_required');
  } else if (!input.canSubmitInput) {
    answerQuestion = block('answer_question', 'unknown_runtime');
  } else if (input.isApprovalTimedOut) {
    answerQuestion = block('answer_question', 'approval_timed_out');
  } else if (input.isQuestionSubmitting || input.isStopping) {
    answerQuestion = block('answer_question', 'runtime_starting');
  } else {
    answerQuestion = allow('answer_question');
  }

  const retry = block('retry', 'unknown_runtime');
  const resume = block('resume', 'unknown_runtime');

  return {
    send_initial: sendInitial,
    send_follow_up: sendFollowUp,
    queue_follow_up: queueFollowUp,
    cancel_queue: cancelQueue,
    stop,
    approve,
    request_changes: requestChanges,
    answer_question: answerQuestion,
    retry,
    resume,
  };
}

export function getRuntimeActionDecision(
  policy: RuntimeActionPolicy,
  action: RuntimeAction
): RuntimeActionDecision {
  return policy[action];
}
