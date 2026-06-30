import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Files } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { cn } from '@/shared/lib/utils';
import { WorkspaceFileBrowserPanel } from './WorkspaceFileBrowserPanel';
import { WorkspaceFilePreviewPanel } from './WorkspaceFilePreviewPanel';
import type {
  WorkspaceFilePreviewSource,
  WorkspaceFilePreviewTarget,
} from '../model/types';
import {
  isSameWorkspaceFileTarget,
  normalizeWorkspaceFilePath,
} from '../model/previewTarget';

interface WorkspaceFilesInlineInspectorProps {
  workspaceId: string;
  target: WorkspaceFilePreviewTarget | null;
  source: WorkspaceFilePreviewSource;
  sessionId?: string | null;
  className?: string;
  compact?: boolean;
  title?: string;
  onSelectFile: (target: WorkspaceFilePreviewTarget) => void;
  onClose?: () => void;
  onClearTarget?: () => void;
}

export function WorkspaceFilesInlineInspector({
  workspaceId,
  target,
  source,
  sessionId,
  className,
  compact = false,
  title = 'Files',
  onSelectFile,
  onClose,
  onClearTarget,
}: WorkspaceFilesInlineInspectorProps) {
  const [compactView, setCompactView] = useState<'browser' | 'preview'>(
    target ? 'preview' : 'browser'
  );

  const selectedTarget = useMemo(() => {
    if (!target) return null;
    if (target.workspaceId !== workspaceId) return null;
    return {
      ...target,
      path: normalizeWorkspaceFilePath(target.path),
    };
  }, [target, workspaceId]);

  const handleSelectFile = useCallback(
    (nextTarget: WorkspaceFilePreviewTarget) => {
      onSelectFile(nextTarget);
      if (compact) {
        setCompactView('preview');
      }
    },
    [compact, onSelectFile]
  );

  const handleClearTarget = useCallback(() => {
    onClearTarget?.();
    if (compact) {
      setCompactView('browser');
    }
  }, [compact, onClearTarget]);

  const browser = (
    <WorkspaceFileBrowserPanel
      workspaceId={workspaceId}
      selectedTarget={selectedTarget}
      source={source}
      sessionId={sessionId ?? undefined}
      className={compact ? 'border-r-0' : 'w-[260px] shrink-0'}
      onSelectFile={handleSelectFile}
    />
  );

  const preview = (
    <WorkspaceFilePreviewPanel
      target={selectedTarget}
      className="min-h-0 flex-1"
      onClearTarget={handleClearTarget}
    />
  );

  const sameTargetActive = selectedTarget
    ? isSameWorkspaceFileTarget(target, selectedTarget)
    : false;

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col bg-primary', className)}
      data-workspace-files-inline-inspector={sameTargetActive ? 'active' : ''}
    >
      <div className="flex shrink-0 items-center gap-half border-b border-border bg-secondary px-base py-half">
        {compact && compactView === 'preview' ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => setCompactView('browser')}
          >
            <ArrowLeft className="mr-half size-3" />
            {title}
          </Button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-half text-sm font-medium text-high">
            <Files className="size-4 shrink-0 text-low" />
            <span className="truncate">{title}</span>
          </div>
        )}
        {compact && compactView === 'preview' && selectedTarget ? (
          <div className="min-w-0 flex-1 truncate text-sm text-low">
            {selectedTarget.path}
          </div>
        ) : null}
        {onClose ? (
          <Button type="button" size="xs" variant="outline" onClick={onClose}>
            Conversation
          </Button>
        ) : null}
      </div>

      {compact ? (
        <div className="min-h-0 flex-1">
          {compactView === 'browser' ? browser : preview}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {browser}
          {preview}
        </div>
      )}
    </div>
  );
}
