import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FloatingPanel,
  FloatingPanelDescription,
  FloatingPanelHeader,
  FloatingPanelTitle,
} from '@vibe/ui/components/FloatingPanel';

export interface WorkflowConfigurationFrameProps {
  open: boolean;
  title: string;
  description: string;
  objectKey: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}

export function WorkflowConfigurationFrame({
  open,
  title,
  description,
  objectKey,
  closeLabel,
  onClose,
  children,
}: WorkflowConfigurationFrameProps) {
  const { t } = useTranslation('common');
  const scrollPositionsRef = useRef(new Map<string, number>());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const scrollPositions = scrollPositionsRef.current;
    if (!open || !container) return;
    container.scrollTop = scrollPositions.get(objectKey) ?? 0;
  }, [objectKey, open]);

  return (
    <FloatingPanel
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      closeLabel={
        closeLabel ??
        t('workflow.inspector.closeConfiguration', {
          defaultValue: 'Close configuration',
        })
      }
      autoFocus={false}
      restoreFocus={false}
      portal={false}
      className="workflow-configuration-frame absolute bottom-4 right-4 top-4 w-[min(440px,calc(100%-2rem))]"
      contentClassName="flex min-h-0 flex-col overflow-hidden"
      data-object-key={objectKey}
    >
      <div
        key={objectKey}
        className="workflow-side-panel-content flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <FloatingPanelHeader className="gap-1 px-4 py-3">
          <FloatingPanelTitle>{title}</FloatingPanelTitle>
          <FloatingPanelDescription
            className="truncate text-xs"
            title={description}
          >
            {description}
          </FloatingPanelDescription>
        </FloatingPanelHeader>
        <div
          ref={scrollContainerRef}
          data-object-content-key={objectKey}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            // The keyed content is detached before layout-effect cleanup;
            // reading scrollTop there would overwrite its position with zero.
            scrollPositionsRef.current.set(
              objectKey,
              event.currentTarget.scrollTop
            );
          }}
        >
          {children}
        </div>
      </div>
    </FloatingPanel>
  );
}
