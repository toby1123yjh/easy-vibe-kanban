import type {
  AgentRunLifecycle,
  AgentRuntimeError,
  ExecutionProcess,
  ExecutionProcessStatus,
} from 'shared/types';

export type ExecutionProcessRuntimeStatus =
  | `${AgentRunLifecycle}`
  | `${ExecutionProcessStatus}`;

export type ExecutionProcessRuntimeTone =
  | 'active'
  | 'danger'
  | 'neutral'
  | 'success'
  | 'warning';

export interface ExecutionProcessRuntimeDisplay {
  status: ExecutionProcessRuntimeStatus;
  label: string;
  tone: ExecutionProcessRuntimeTone;
  source: 'agent_runtime' | 'process_status';
  error: AgentRuntimeError | null;
  errorLabel: string | null;
}

const RUNTIME_DISPLAY: Record<
  ExecutionProcessRuntimeStatus,
  Pick<ExecutionProcessRuntimeDisplay, 'label' | 'tone'>
> = {
  starting: { label: 'starting', tone: 'active' },
  running: { label: 'running', tone: 'active' },
  waiting_approval: { label: 'waiting for approval', tone: 'warning' },
  waiting_input: { label: 'waiting for input', tone: 'warning' },
  cancelling: { label: 'cancelling', tone: 'warning' },
  completed: { label: 'completed', tone: 'success' },
  failed: { label: 'failed', tone: 'danger' },
  crashed: { label: 'crashed', tone: 'danger' },
  killed: { label: 'killed', tone: 'neutral' },
};

export function getExecutionProcessLifecycle(
  process: ExecutionProcess
): ExecutionProcessRuntimeStatus {
  return (process.agent_runtime_lifecycle ??
    process.status) as ExecutionProcessRuntimeStatus;
}

export function isExecutionProcessActive(process: ExecutionProcess): boolean {
  switch (getExecutionProcessLifecycle(process)) {
    case 'starting':
    case 'running':
    case 'waiting_approval':
    case 'waiting_input':
    case 'cancelling':
      return true;
    case 'completed':
    case 'failed':
    case 'crashed':
    case 'killed':
      return false;
  }
}

export function isExecutionProcessFailedLike(
  process: ExecutionProcess
): boolean {
  switch (getExecutionProcessLifecycle(process)) {
    case 'failed':
    case 'crashed':
    case 'killed':
      return true;
    case 'starting':
    case 'running':
    case 'waiting_approval':
    case 'waiting_input':
    case 'cancelling':
    case 'completed':
      return false;
  }
}

export function isExecutionProcessCompleted(
  process: ExecutionProcess
): boolean {
  return getExecutionProcessLifecycle(process) === 'completed';
}

function formatAgentRuntimeErrorKind(error: AgentRuntimeError): string {
  return error.kind.replaceAll('_', ' ');
}

export function formatAgentRuntimeError(error: AgentRuntimeError): string {
  const details = [formatAgentRuntimeErrorKind(error)];
  if (error.provider) details.push(error.provider);
  if (error.exit_code != null) details.push(`exit ${error.exit_code}`);

  return error.message
    ? `${details.join(' / ')}: ${error.message}`
    : details.join(' / ');
}

export function getExecutionProcessRuntimeDisplay(
  process: ExecutionProcess
): ExecutionProcessRuntimeDisplay {
  const status = getExecutionProcessLifecycle(process);
  const display = RUNTIME_DISPLAY[status];
  const error = process.agent_runtime_error ?? null;

  return {
    status,
    label: display.label,
    tone: display.tone,
    source:
      process.agent_runtime_lifecycle != null
        ? 'agent_runtime'
        : 'process_status',
    error,
    errorLabel: error ? formatAgentRuntimeError(error) : null,
  };
}
