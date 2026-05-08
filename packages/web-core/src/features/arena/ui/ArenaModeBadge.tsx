import { useTranslation } from 'react-i18next';
import type { ArenaGroupResponse } from '@/shared/lib/arenaApi';

export function ArenaModeBadge({ group }: { group: ArenaGroupResponse }) {
  const { t } = useTranslation('common');

  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-low dark:border-zinc-800">
      <span>{t(`arena.modes.${group.mode}`)}</span>
      <span className="text-zinc-300 dark:text-zinc-700">/</span>
      <span>
        {t(
          group.lifecycle_status === 'implementation_started'
            ? 'arena.lifecycle.implementationStarted'
            : `arena.lifecycle.${group.lifecycle_status}`
        )}
      </span>
    </span>
  );
}
