import { StatusDot, type SemanticStatus } from './StatusDot';

export interface ToolStatusLike {
  status: string;
}

interface ToolStatusDotProps {
  status: ToolStatusLike;
  className?: string;
  active?: boolean;
}

export function ToolStatusDot({
  status,
  className,
  active = true,
}: ToolStatusDotProps) {
  const statusType = status.status;

  // Map status to visual state
  const isSuccess = statusType === 'success';
  const isError =
    statusType === 'failed' ||
    statusType === 'denied' ||
    statusType === 'timed_out';
  const isPending =
    statusType === 'created' || statusType === 'pending_approval';

  const semanticStatus: SemanticStatus = isSuccess
    ? 'success'
    : isError
      ? 'error'
      : isPending
        ? 'waiting'
        : 'cancelled';

  return (
    <StatusDot
      className={className}
      status={semanticStatus}
      pulse={isPending && active}
    />
  );
}
