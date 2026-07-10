import type { PatchTypeWithKey } from '@/shared/hooks/useConversationHistory/types';

const NATIVE_HISTORY_BACKFILL_METADATA_KEY = 'native_history_backfill';

type RuntimeNormalizedEntryMetadata = {
  metadata?: Record<string, unknown> | null;
};

export function isNativeHistoryBackfillEntry(entry: PatchTypeWithKey): boolean {
  if (entry.type !== 'NORMALIZED_ENTRY') return false;

  const metadata = (entry.content as RuntimeNormalizedEntryMetadata).metadata;
  return metadata?.[NATIVE_HISTORY_BACKFILL_METADATA_KEY] === true;
}
