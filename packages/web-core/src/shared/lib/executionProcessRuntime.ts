import type { ExecutionProcess, ExecutionProcessStatus } from 'shared/types';

export type ExecutionProcessRuntimeStatus = `${ExecutionProcessStatus}`;

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
  source: 'process_status';
  error: null;
  errorLabel: string | null;
}

const RUNTIME_DISPLAY: Record<
  ExecutionProcessRuntimeStatus,
  Pick<ExecutionProcessRuntimeDisplay, 'label' | 'tone'>
> = {
  running: { label: 'running', tone: 'active' },
  completed: { label: 'completed', tone: 'success' },
  failed: { label: 'failed', tone: 'danger' },
  killed: { label: 'killed', tone: 'neutral' },
};

export function getExecutionProcessLifecycle(
  process: ExecutionProcess
): ExecutionProcessRuntimeStatus {
  return process.status;
}

export function isExecutionProcessActive(process: ExecutionProcess): boolean {
  switch (getExecutionProcessLifecycle(process)) {
    case 'running':
      return true;
    case 'completed':
    case 'failed':
    case 'killed':
      return false;
  }
}

export function isExecutionProcessFailedLike(
  process: ExecutionProcess
): boolean {
  switch (getExecutionProcessLifecycle(process)) {
    case 'failed':
    case 'killed':
      return true;
    case 'running':
    case 'completed':
      return false;
  }
}

export function isExecutionProcessCompleted(
  process: ExecutionProcess
): boolean {
  return getExecutionProcessLifecycle(process) === 'completed';
}

export function getExecutionProcessRuntimeDisplay(
  process: ExecutionProcess
): ExecutionProcessRuntimeDisplay {
  const status = getExecutionProcessLifecycle(process);
  const display = RUNTIME_DISPLAY[status];

  return {
    status,
    label: display.label,
    tone: display.tone,
    source: 'process_status',
    error: null,
    errorLabel: null,
  };
}
