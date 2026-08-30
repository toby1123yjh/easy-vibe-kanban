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
    return () => {
      scrollPositions.set(objectKey, container.scrollTop);
    };
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
      className="workflow-configuration-frame bottom-6 right-6 top-[calc(var(--vk-app-header-height,0px)+1.5rem)] w-[min(440px,calc(100vw-3rem))]"
      contentClassName="flex min-h-0 flex-col overflow-hidden"
      data-object-key={objectKey}
    >
      <div
        key={objectKey}
        className="workflow-side-panel-content flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <FloatingPanelHeader>
          <FloatingPanelTitle>{title}</FloatingPanelTitle>
          <FloatingPanelDescription>{description}</FloatingPanelDescription>
        </FloatingPanelHeader>
        <div
          ref={scrollContainerRef}
          data-object-content-key={objectKey}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </div>
    </FloatingPanel>
  );
}
