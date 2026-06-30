import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Tooltip } from '@vibe/ui/components/Tooltip';
import { cn } from '@/shared/lib/utils';
import { getActualTheme } from '@/shared/lib/theme';
import { getFileIcon } from '@/shared/lib/fileTypeIcon';
import { useTheme } from '@/shared/hooks/useTheme';
import { useWorkspaceFileTree } from '../model/useWorkspaceFileTree';
import type {
  WorkspaceFilePreviewSource,
  WorkspaceFilePreviewTarget,
  WorkspaceFileRepoTree,
  WorkspaceFileTreeNode,
} from '../model/types';
import {
  filterWorkspaceFileRepos,
  getExpandedWorkspaceFileFolderKeysForSearch,
  getWorkspaceFileSelectedKey,
} from '../model/workspaceFileTree';
import { normalizeWorkspaceFilePath } from '../model/previewTarget';
import { WorkspaceFileEmptyState } from './WorkspaceFileEmptyState';

interface WorkspaceFileBrowserPanelProps {
  workspaceId: string;
  selectedTarget?: WorkspaceFilePreviewTarget | null;
  source: WorkspaceFilePreviewSource;
  sessionId?: string;
  className?: string;
  onSelectFile: (target: WorkspaceFilePreviewTarget) => void;
}

export function WorkspaceFileBrowserPanel({
  workspaceId,
  selectedTarget,
  source,
  sessionId,
  className,
  onSelectFile,
}: WorkspaceFileBrowserPanelProps) {
  const { theme } = useTheme();
  const actualTheme = getActualTheme(theme);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const {
    repos,
    isLoading,
    isFetching,
    error,
    refetch,
    loadDirectory,
    loadingDirectoryKeys,
    directoryErrors,
  } = useWorkspaceFileTree(workspaceId);

  const filteredRepos = useMemo(
    () => filterWorkspaceFileRepos(repos, searchQuery),
    [repos, searchQuery]
  );

  useEffect(() => {
    if (!searchQuery) return;
    const keys = getExpandedWorkspaceFileFolderKeysForSearch(
      repos,
      searchQuery
    );
    setExpandedKeys((prev) => new Set([...prev, ...keys]));
  }, [repos, searchQuery]);

  const selectedKey = selectedTarget
    ? getWorkspaceFileSelectedKey(
        selectedTarget.repoId,
        normalizeWorkspaceFilePath(selectedTarget.path)
      )
    : null;

  const handleToggleFolder = useCallback(
    (node: WorkspaceFileTreeNode) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
          void loadDirectory(node.repoId, node.path);
        }
        return next;
      });
    },
    [loadDirectory]
  );

  const handleSelectFile = useCallback(
    (node: WorkspaceFileTreeNode) => {
      onSelectFile({
        workspaceId,
        repoId: node.repoId,
        path: node.path,
        source,
        ...(sessionId ? { sessionId } : {}),
      });
    },
    [onSelectFile, sessionId, source, workspaceId]
  );

  const renderFileIcon = useCallback(
    (fileName: string) => {
      const FileIcon = getFileIcon(fileName, actualTheme);
      return <FileIcon className="size-icon-sm" />;
    },
    [actualTheme]
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col border-r border-border bg-secondary',
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-half border-b border-border p-base">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-low" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search files"
            className="h-8 w-full rounded border border-border bg-primary pl-7 pr-2 text-sm text-normal outline-none placeholder:text-low focus:ring-1 focus:ring-brand"
          />
        </div>
        <Tooltip content="Refresh files" side="bottom">
          <button
            type="button"
            onClick={handleRefresh}
            className="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-primary text-low transition-colors hover:text-normal focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
            aria-label="Refresh files"
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-base">
        {isLoading ? (
          <WorkspaceFileEmptyState
            icon={<Loader2 className="size-5 animate-spin" />}
            title="Loading files"
            description="Reading the workspace repositories."
          />
        ) : error ? (
          <WorkspaceFileEmptyState
            title="Could not load files"
            description={
              error instanceof Error ? error.message : 'The file tree failed.'
            }
            action={
              <button
                type="button"
                onClick={handleRefresh}
                className="rounded border border-border bg-primary px-base py-half text-sm text-normal hover:text-high focus:outline-none focus:ring-1 focus:ring-brand"
              >
                Retry
              </button>
            }
          />
        ) : repos.length === 0 ? (
          <WorkspaceFileEmptyState
            title="No repositories"
            description="This workspace has no repository files to inspect."
          />
        ) : filteredRepos.length === 0 ? (
          <WorkspaceFileEmptyState
            title="No matches"
            description="Try a different file name or path."
          />
        ) : (
          <div className="space-y-base">
            {filteredRepos.map((repo) => (
              <RepoGroup
                key={repo.repoId}
                repo={repo}
                selectedKey={selectedKey}
                expandedKeys={expandedKeys}
                loadingDirectoryKeys={loadingDirectoryKeys}
                directoryErrors={directoryErrors}
                onToggleFolder={handleToggleFolder}
                onSelectFile={handleSelectFile}
                renderFileIcon={renderFileIcon}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface RepoGroupProps {
  repo: WorkspaceFileRepoTree;
  selectedKey: string | null;
  expandedKeys: Set<string>;
  loadingDirectoryKeys: Set<string>;
  directoryErrors: Map<string, Error>;
  onToggleFolder: (node: WorkspaceFileTreeNode) => void;
  onSelectFile: (node: WorkspaceFileTreeNode) => void;
  renderFileIcon: (fileName: string) => ReactNode;
}

function RepoGroup({
  repo,
  selectedKey,
  expandedKeys,
  loadingDirectoryKeys,
  directoryErrors,
  onToggleFolder,
  onSelectFile,
  renderFileIcon,
}: RepoGroupProps) {
  return (
    <section className="min-w-0">
      <div className="mb-half flex h-6 min-w-0 items-center gap-half px-half text-xs font-semibold uppercase text-low">
        <span className="truncate">{repo.repoDisplayName}</span>
        {repo.truncated && (
          <span className="shrink-0 rounded border border-border px-1 py-0.5 font-normal normal-case text-low">
            partial
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {repo.children.length === 0 ? (
          <div className="px-half py-base text-sm text-low">No files</div>
        ) : (
          repo.children.map((node) => (
            <WorkspaceFileNodeRow
              key={node.id}
              node={node}
              depth={0}
              selectedKey={selectedKey}
              expandedKeys={expandedKeys}
              loadingDirectoryKeys={loadingDirectoryKeys}
              directoryErrors={directoryErrors}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              renderFileIcon={renderFileIcon}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface WorkspaceFileNodeRowProps extends Omit<RepoGroupProps, 'repo'> {
  node: WorkspaceFileTreeNode;
  depth: number;
}

function WorkspaceFileNodeRow({
  node,
  depth,
  selectedKey,
  expandedKeys,
  loadingDirectoryKeys,
  directoryErrors,
  onToggleFolder,
  onSelectFile,
  renderFileIcon,
}: WorkspaceFileNodeRowProps) {
  const isFolder = node.type === 'folder';
  const isExpanded = expandedKeys.has(node.id);
  const isSelected = selectedKey === node.id;
  const isLoading = loadingDirectoryKeys.has(node.id);
  const error = directoryErrors.get(node.id);

  const handleClick = () => {
    if (isFolder) {
      onToggleFolder(node);
    } else {
      onSelectFile(node);
    }
  };

  return (
    <div>
      <button
        type="button"
        data-workspace-file-path={node.path}
        onClick={handleClick}
        className={cn(
          'flex h-[28px] w-full min-w-0 items-center gap-half rounded px-half text-left text-sm text-low transition-colors hover:bg-panel hover:text-normal focus:outline-none focus:ring-1 focus:ring-brand',
          isSelected && 'bg-panel text-high ring-1 ring-border'
        )}
      >
        <span
          className="flex min-w-0 flex-1 items-center gap-half"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          <span className="flex w-3 shrink-0 items-center justify-center">
            {isFolder ? (
              isLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )
            ) : null}
          </span>
          <span className="flex size-4 shrink-0 items-center justify-center text-low">
            {isFolder ? (
              <Folder className="size-4 fill-current" />
            ) : (
              renderFileIcon(node.name)
            )}
          </span>
          <span className="min-w-0 truncate">{node.name}</span>
          {error && (
            <span className="shrink-0 text-xs text-error" title={error.message}>
              error
            </span>
          )}
        </span>
      </button>
      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <WorkspaceFileNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              expandedKeys={expandedKeys}
              loadingDirectoryKeys={loadingDirectoryKeys}
              directoryErrors={directoryErrors}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              renderFileIcon={renderFileIcon}
            />
          ))}
          {node.truncated && (
            <div
              className="h-[28px] truncate px-half text-xs text-low"
              style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
            >
              Directory truncated
            </div>
          )}
        </div>
      )}
    </div>
  );
}
