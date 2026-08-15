import { useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { createHmrContext } from '@/shared/lib/hmrContext';
import { useApprovalMutation } from '../hooks/useApprovalMutation';

interface ActiveApproval {
  approvalId: string;
  agentRunId: string;
}

interface ApprovalFeedbackContextType {
  activeApproval: ActiveApproval | null;
  enterFeedbackMode: (approval: ActiveApproval) => void;
  exitFeedbackMode: () => void;
  submitFeedback: (message: string) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  isTimedOut: boolean;
}

const ApprovalFeedbackContext =
  createHmrContext<ApprovalFeedbackContextType | null>(
    'ApprovalFeedbackContext',
    null
  );

export function useApprovalFeedback() {
  const context = useContext(ApprovalFeedbackContext);
  if (!context) {
    throw new Error(
      'useApprovalFeedback must be used within ApprovalFeedbackProvider'
    );
  }
  return context;
}

// Optional hook that doesn't throw - for components that may render outside provider
export function useApprovalFeedbackOptional() {
  return useContext(ApprovalFeedbackContext);
}

export function ApprovalFeedbackProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [activeApproval, setActiveApproval] = useState<ActiveApproval | null>(
    null
  );
  const { denyAsync, isDenying, denyError, reset } = useApprovalMutation();

  const enterFeedbackMode = useCallback(
    (approval: ActiveApproval) => {
      setActiveApproval(approval);
      reset();
    },
    [reset]
  );

  const exitFeedbackMode = useCallback(() => {
    setActiveApproval(null);
    reset();
  }, [reset]);

  const submitFeedback = useCallback(
    async (message: string) => {
      if (!activeApproval) return;

      await denyAsync({
        approvalId: activeApproval.approvalId,
        agentRunId: activeApproval.agentRunId,
        reason: message.trim() || undefined,
      });
      setActiveApproval(null);
    },
    [activeApproval, denyAsync]
  );

  const value = useMemo(
    () => ({
      activeApproval,
      enterFeedbackMode,
      exitFeedbackMode,
      submitFeedback,
      isSubmitting: isDenying,
      error: denyError?.message ?? null,
      isTimedOut: false,
    }),
    [
      activeApproval,
      enterFeedbackMode,
      exitFeedbackMode,
      submitFeedback,
      isDenying,
      denyError?.message,
    ]
  );

  return (
    <ApprovalFeedbackContext.Provider value={value}>
      {children}
    </ApprovalFeedbackContext.Provider>
  );
}
