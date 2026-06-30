import { FileSearch, Loader2 } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { cn } from '@/shared/lib/utils';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { useWorkspaceFileContent } from '../model/useWorkspaceFileContent';
import type { WorkspaceFilePreviewTarget } from '../model/types';
import { classifyWorkspaceFile } from '../model/fileClassification';
import { scopeWorkspaceFileRawUrl } from '../model/workspaceFileRawUrl';
import { WorkspaceFileEmptyState } from './WorkspaceFileEmptyState';
import { WorkspaceFilePreviewHeader } from './WorkspaceFilePreviewHeader';
import { CodeTextViewer } from './viewers/CodeTextViewer';
import { MarkdownFileViewer } from './viewers/MarkdownFileViewer';
import { ImageFileViewer } from './viewers/ImageFileViewer';
import { UnsupportedFileViewer } from './viewers/UnsupportedFileViewer';

interface WorkspaceFilePreviewPanelProps {
  target: WorkspaceFilePreviewTarget | null;
  className?: string;
  onClearTarget?: () => void;
}

export function WorkspaceFilePreviewPanel({
  target,
  className,
  onClearTarget,
}: WorkspaceFilePreviewPanelProps) {
  const hostId = useHostId();
  const { data, isLoading, isFetching, error, refresh, refetch } =
    useWorkspaceFileContent(target);
  const displayInfo = data ? classifyWorkspaceFile(data) : null;
  const scopedRawUrl = scopeWorkspaceFileRawUrl(data?.raw_url, hostId);

  if (!target) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-primary', className)}>
        <WorkspaceFileEmptyState
          icon={<FileSearch className="size-5" />}
          title="Select a file"
          description="Open a workspace file to inspect it here."
        />
      </div>
    );
  }

  const handleRefresh = () => {
    void refresh();
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-primary', className)}>
      <WorkspaceFilePreviewHeader
        target={target}
        content={data}
        displayInfo={displayInfo}
        isRefreshing={isFetching && !isLoading}
        onRefresh={handleRefresh}
        onClearTarget={onClearTarget}
      />
      {data?.truncated && (
        <div className="shrink-0 border-b border-border bg-secondary px-base py-half text-sm text-low">
          Large file preview truncated by the backend.
        </div>
      )}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <WorkspaceFileEmptyState
            icon={<Loader2 className="size-5 animate-spin" />}
            title="Loading preview"
            description="Reading file content from the workspace."
          />
        ) : error ? (
          <WorkspaceFileEmptyState
            title="Could not load preview"
            description={
              error instanceof Error ? error.message : 'The preview failed.'
            }
            action={
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => void refetch()}
              >
                Retry
              </Button>
            }
          />
        ) : !data ? (
          <WorkspaceFileEmptyState
            title="File missing"
            description="The file was not returned by the workspace API."
          />
        ) : displayInfo?.viewKind === 'markdown' ? (
          <MarkdownFileViewer content={data.content ?? ''} />
        ) : displayInfo?.viewKind === 'image' ? (
          <ImageFileViewer src={scopedRawUrl} alt={data.name} />
        ) : displayInfo?.viewKind === 'code' ||
          displayInfo?.viewKind === 'text' ? (
          <CodeTextViewer
            content={data.content ?? ''}
            language={displayInfo.language}
          />
        ) : (
          <UnsupportedFileViewer
            target={target}
            content={data}
            rawUrl={scopedRawUrl}
          />
        )}
      </div>
    </div>
  );
}
