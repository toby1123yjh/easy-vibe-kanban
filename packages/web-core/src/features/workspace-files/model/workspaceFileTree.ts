import type { WorkspaceFileEntry, WorkspaceFileRepoNode } from 'shared/types';
import type { WorkspaceFileRepoTree, WorkspaceFileTreeNode } from './types';
import { normalizeWorkspaceFilePath } from './previewTarget';

export function getWorkspaceFileNodeId(repoId: string, path: string): string {
  return `${repoId}:${normalizeWorkspaceFilePath(path)}`;
}

export function getWorkspaceFileSelectedKey(
  repoId: string,
  path: string
): string {
  return getWorkspaceFileNodeId(repoId, path);
}

export function mapWorkspaceFileRepos(
  repos: WorkspaceFileRepoNode[],
  directoryEntries: Map<string, WorkspaceFileEntry[]> = new Map(),
  truncatedDirectories: Set<string> = new Set()
): WorkspaceFileRepoTree[] {
  return repos.map((repo) => ({
    repoId: repo.repo_id,
    repoName: repo.repo_name,
    repoDisplayName: repo.repo_display_name || repo.repo_name,
    workspaceId: repo.workspace_id,
    children: mapWorkspaceFileEntries(
      repo.entries,
      directoryEntries,
      truncatedDirectories
    ),
    truncated: repo.truncated,
  }));
}

export function mapWorkspaceFileEntries(
  entries: WorkspaceFileEntry[],
  directoryEntries: Map<string, WorkspaceFileEntry[]> = new Map(),
  truncatedDirectories: Set<string> = new Set()
): WorkspaceFileTreeNode[] {
  return sortWorkspaceFileNodes(
    entries.map((entry) => {
      const normalizedPath = normalizeWorkspaceFilePath(entry.path);
      const directoryKey = getWorkspaceFileNodeId(
        entry.repo_id,
        normalizedPath
      );
      const loadedChildren = directoryEntries.get(directoryKey);
      const isFolder = entry.kind === 'directory';

      return {
        id: directoryKey,
        repoId: entry.repo_id,
        repoName: entry.repo_name,
        name: entry.name,
        path: normalizedPath,
        type: isFolder ? 'folder' : 'file',
        entry,
        children: loadedChildren
          ? mapWorkspaceFileEntries(
              loadedChildren,
              directoryEntries,
              truncatedDirectories
            )
          : undefined,
        hasLoadedChildren: loadedChildren !== undefined,
        truncated: truncatedDirectories.has(directoryKey),
      };
    })
  );
}

export function filterWorkspaceFileRepos(
  repos: WorkspaceFileRepoTree[],
  searchQuery: string
): WorkspaceFileRepoTree[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return repos;

  return repos
    .map((repo) => {
      const children = filterWorkspaceFileNodes(repo.children, query);
      const repoMatches =
        repo.repoDisplayName.toLowerCase().includes(query) ||
        repo.repoName.toLowerCase().includes(query);

      if (!repoMatches && children.length === 0) return null;

      return {
        ...repo,
        children: repoMatches ? repo.children : children,
      };
    })
    .filter((repo): repo is WorkspaceFileRepoTree => repo !== null);
}

export function getExpandedWorkspaceFileFolderKeysForSearch(
  repos: WorkspaceFileRepoTree[],
  searchQuery: string
): Set<string> {
  const query = searchQuery.trim().toLowerCase();
  const keys = new Set<string>();
  if (!query) return keys;

  const visit = (node: WorkspaceFileTreeNode, parents: string[]) => {
    const matches =
      node.name.toLowerCase().includes(query) ||
      node.path.toLowerCase().includes(query);
    if (node.type === 'file' && matches) {
      parents.forEach((key) => keys.add(key));
    }

    node.children?.forEach((child) =>
      visit(child, node.type === 'folder' ? [...parents, node.id] : parents)
    );
  };

  repos.forEach((repo) => repo.children.forEach((node) => visit(node, [])));
  return keys;
}

export function getAllWorkspaceFileFolderKeys(
  repos: WorkspaceFileRepoTree[]
): string[] {
  const keys: string[] = [];

  const visit = (node: WorkspaceFileTreeNode) => {
    if (node.type === 'folder') {
      keys.push(node.id);
      node.children?.forEach(visit);
    }
  };

  repos.forEach((repo) => repo.children.forEach(visit));
  return keys;
}

function filterWorkspaceFileNodes(
  nodes: WorkspaceFileTreeNode[],
  query: string
): WorkspaceFileTreeNode[] {
  return nodes
    .map((node) => {
      const selfMatches =
        node.name.toLowerCase().includes(query) ||
        node.path.toLowerCase().includes(query);

      if (node.type === 'folder') {
        const children = node.children
          ? filterWorkspaceFileNodes(node.children, query)
          : [];

        if (selfMatches) return node;
        if (children.length > 0) return { ...node, children };
        return null;
      }

      return selfMatches ? node : null;
    })
    .filter((node): node is WorkspaceFileTreeNode => node !== null);
}

function sortWorkspaceFileNodes(
  nodes: WorkspaceFileTreeNode[]
): WorkspaceFileTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'folder' ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}
