import { useMemo, useState } from 'react';
import { ArrowLeft, GitCompare } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { cn } from '@/shared/lib/utils';
import { useChangesViewActions } from '@/shared/hooks/useChangesView';
import {
  useWorkspaceFilesSelection,
  WorkspaceFileBrowserPanel,
  WorkspaceFilePreviewPanel,
} from '@/features/workspace-files';

interface WorkspaceFilesSurfaceContainerProps {
  workspaceId: string;
  className?: string;
  mobile?: boolean;
}

export function WorkspaceFilesSurfaceContainer({
  workspaceId,
  className,
  mobile = false,
}: WorkspaceFilesSurfaceContainerProps) {
  const { target, openTarget, clearTarget } =
    useWorkspaceFilesSelection(workspaceId);
  const { findMatchingDiffPath, viewFileInChanges } = useChangesViewActions();
  const [mobileView, setMobileView] = useState<'browser' | 'preview'>(
    'browser'
  );

  const matchingDiffPath = useMemo(() => {
    if (!target) return null;
    return findMatchingDiffPath(target.path);
  }, [findMatchingDiffPath, target]);

  const handleViewChanges = () => {
    if (!matchingDiffPath) return;
    viewFileInChanges(matchingDiffPath);
  };

  if (mobile) {
    const showPreview = mobileView === 'preview' && target;

    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-primary', className)}>
        {showPreview ? (
          <>
            <div className="flex shrink-0 items-center gap-half border-b border-border bg-secondary px-base py-half">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => setMobileView('browser')}
              >
                <ArrowLeft className="mr-half size-3" />
                Files
              </Button>
              <div className="min-w-0 flex-1 truncate text-sm text-low">
                {target.path}
              </div>
              {matchingDiffPath && (
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={handleViewChanges}
                >
                  <GitCompare className="mr-half size-3" />
                  Changes
                </Button>
              )}
            </div>
            <WorkspaceFilePreviewPanel
              target={target}
              className="min-h-0 flex-1"
              onClearTarget={() => {
                clearTarget();
                setMobileView('browser');
              }}
            />
          </>
        ) : (
          <WorkspaceFileBrowserPanel
            workspaceId={workspaceId}
            selectedTarget={target}
            source="file-tree"
            onSelectFile={(nextTarget) => {
              openTarget(nextTarget);
              setMobileView('preview');
            }}
            className="border-r-0"
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-primary', className)}>
      {target && matchingDiffPath && (
        <div className="flex shrink-0 items-center justify-end border-b border-border bg-secondary px-base py-half">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={handleViewChanges}
          >
            <GitCompare className="mr-half size-3" />
            View changes
          </Button>
        </div>
      )}
      <WorkspaceFilePreviewPanel
        target={target}
        className="min-h-0 flex-1"
        onClearTarget={clearTarget}
      />
    </div>
  );
}
