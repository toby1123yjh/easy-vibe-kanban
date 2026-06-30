import { Binary, ExternalLink } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { formatFileSize } from '@/shared/lib/utils';
import { useOpenInEditor } from '@/shared/hooks/useOpenInEditor';
import type { WorkspaceFileContent } from 'shared/types';
import type { WorkspaceFilePreviewTarget } from '../../model/types';
import { WorkspaceFileEmptyState } from '../WorkspaceFileEmptyState';

interface UnsupportedFileViewerProps {
  target: WorkspaceFilePreviewTarget;
  content?: WorkspaceFileContent | null;
  rawUrl?: string | null;
}

export function UnsupportedFileViewer({
  target,
  content,
  rawUrl,
}: UnsupportedFileViewerProps) {
  const openInEditor = useOpenInEditor(target.workspaceId);

  return (
    <WorkspaceFileEmptyState
      icon={<Binary className="size-5" />}
      title="Preview not available"
      description="This file is binary or not supported by the read-only preview."
      action={
        <div className="flex max-w-full flex-col items-center gap-base">
          <dl className="grid max-w-[420px] grid-cols-[auto_1fr] gap-x-base gap-y-half text-left text-sm">
            <dt className="text-low">Path</dt>
            <dd className="min-w-0 truncate font-ibm-plex-mono text-normal">
              {target.path}
            </dd>
            {content?.mime_type && (
              <>
                <dt className="text-low">MIME</dt>
                <dd className="min-w-0 truncate text-normal">
                  {content.mime_type}
                </dd>
              </>
            )}
            {content && (
              <>
                <dt className="text-low">Size</dt>
                <dd className="text-normal">
                  {formatFileSize(content.size_bytes)}
                </dd>
              </>
            )}
          </dl>
          <div className="flex items-center gap-half">
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => void openInEditor({ filePath: target.path })}
              className="gap-half"
            >
              <ExternalLink className="size-3" />
              Open editor
            </Button>
            {rawUrl && (
              <Button
                asChild
                size="xs"
                variant="secondary"
                className="gap-half"
              >
                <a href={rawUrl} target="_blank" rel="noopener noreferrer">
                  Open raw
                </a>
              </Button>
            )}
          </div>
        </div>
      }
    />
  );
}
