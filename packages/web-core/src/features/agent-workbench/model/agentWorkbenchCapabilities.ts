import type {
  RuntimeActionDecision,
  RuntimeActionPolicy,
} from '@/shared/lib/runtimeActionPolicy';

export type AgentWorkbenchPrimaryAction =
  | 'send'
  | 'follow_up'
  | 'queue'
  | 'stop';

export interface AgentWorkbenchCapability {
  readonly action: AgentWorkbenchPrimaryAction;
  readonly label: string;
  readonly decision: RuntimeActionDecision;
  readonly disabledReason: RuntimeActionDecision['reason'];
}

export type AgentWorkbenchCapabilities = Record<
  AgentWorkbenchPrimaryAction,
  AgentWorkbenchCapability
>;

function capability(
  action: AgentWorkbenchPrimaryAction,
  label: string,
  decision: RuntimeActionDecision
): AgentWorkbenchCapability {
  return {
    action,
    label,
    decision,
    disabledReason: decision.allowed ? null : decision.reason,
  };
}

/**
 * Presentation adapter for the canonical runtime policy. It intentionally
 * keeps send, follow-up, queue, and stop separate instead of collapsing them
 * into a provider-name-based mode.
 */
export function deriveAgentWorkbenchCapabilities(
  policy: RuntimeActionPolicy
): AgentWorkbenchCapabilities {
  return {
    send: capability('send', 'Send', policy.send_initial),
    follow_up: capability('follow_up', 'Follow up', policy.send_follow_up),
    queue: capability('queue', 'Queue', policy.queue_follow_up),
    stop: capability('stop', 'Stop', policy.stop),
  };
}
