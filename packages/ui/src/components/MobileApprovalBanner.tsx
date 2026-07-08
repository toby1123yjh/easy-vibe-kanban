import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@phosphor-icons/react';

interface MobileApprovalBannerProps {
  /** Tool name requesting approval, shown for quick context. */
  toolName: string;
  /** Scroll the transcript to the pending approval card. */
  onView: () => void;
}

/**
 * Bottom-anchored (in-flow, above the composer) banner that surfaces a pending
 * approval on mobile so it stays discoverable when the context card scrolls out
 * of view. The approve/deny action lives in the composer footer; this banner
 * only signals that an approval is waiting and jumps to its card.
 */
export function MobileApprovalBanner({
  toolName,
  onView,
}: MobileApprovalBannerProps) {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex justify-center px-base pt-base">
      <div className="w-chat max-w-full">
        <div className="flex items-center gap-base rounded-sm border border-brand bg-brand/10 px-base py-half">
          <WarningIcon
            className="size-icon-base shrink-0 text-brand"
            weight="fill"
          />
          <span className="min-w-0 flex-1 truncate text-sm text-high">
            {t('conversation.actions.pendingApproval')}
            <span className="text-low"> · </span>
            <span className="font-medium">{toolName}</span>
          </span>
          <button
            type="button"
            onClick={onView}
            className="min-h-[44px] shrink-0 rounded-sm px-base text-cta font-medium text-brand hover:bg-brand/20"
          >
            {t('conversation.actions.viewApproval')}
          </button>
        </div>
      </div>
    </div>
  );
}
