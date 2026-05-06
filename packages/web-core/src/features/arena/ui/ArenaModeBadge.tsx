import type { ArenaGroupResponse } from '@/shared/lib/arenaApi';

const MODE_LABEL: Record<ArenaGroupResponse['mode'], string> = {
  design: 'Design Arena',
  implementation: 'Implementation Arena',
};

const LIFECYCLE_LABEL: Record<ArenaGroupResponse['lifecycle_status'], string> =
  {
    open: 'Open',
    closed: 'Closed',
    adopted: 'Adopted',
    implementation_started: 'Implementation started',
  };

export function ArenaModeBadge({ group }: { group: ArenaGroupResponse }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-low dark:border-zinc-800">
      <span>{MODE_LABEL[group.mode]}</span>
      <span className="text-zinc-300 dark:text-zinc-700">/</span>
      <span>{LIFECYCLE_LABEL[group.lifecycle_status]}</span>
    </span>
  );
}
