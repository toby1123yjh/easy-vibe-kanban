import { describe, expect, it } from 'vitest';
import type { WorkspaceFileEntry, WorkspaceFileRepoNode } from 'shared/types';
import {
  filterWorkspaceFileRepos,
  getWorkspaceFileNodeId,
  mapWorkspaceFileRepos,
} from './workspaceFileTree';

function entry(
  repoId: string,
  path: string,
  kind: WorkspaceFileEntry['kind']
): WorkspaceFileEntry {
  return {
    workspace_id: 'workspace-1',
    repo_id: repoId,
    repo_name: repoId === 'repo-1' ? 'api' : 'web',
    path,
    name: path.split('/').pop() ?? path,
    kind,
    size_bytes: kind === 'file' ? 12n : null,
    modified_at: null,
    mime_type: kind === 'file' ? 'text/plain' : null,
    is_binary: kind === 'file' ? false : null,
  };
}

function repo(
  repoId: string,
  entries: WorkspaceFileEntry[]
): WorkspaceFileRepoNode {
  return {
    workspace_id: 'workspace-1',
    repo_id: repoId,
    repo_name: repoId === 'repo-1' ? 'api' : 'web',
    repo_display_name: repoId === 'repo-1' ? 'API' : 'Web',
    entries,
    truncated: false,
  };
}

describe('workspace file tree mapping', () => {
  it('preserves repo boundaries and selected node identities', () => {
    const repos = mapWorkspaceFileRepos([
      repo('repo-1', [entry('repo-1', 'src', 'directory')]),
      repo('repo-2', [entry('repo-2', 'src', 'directory')]),
    ]);

    expect(repos.map((item) => item.repoId)).toEqual(['repo-1', 'repo-2']);
    expect(repos[0].children[0].id).toBe(
      getWorkspaceFileNodeId('repo-1', 'src')
    );
    expect(repos[1].children[0].id).toBe(
      getWorkspaceFileNodeId('repo-2', 'src')
    );
    expect(repos[0].children[0].id).not.toBe(repos[1].children[0].id);
  });

  it('attaches lazy-loaded directory children by repo and path', () => {
    const directoryEntries = new Map<string, WorkspaceFileEntry[]>([
      [
        getWorkspaceFileNodeId('repo-1', 'src'),
        [entry('repo-1', 'src/main.rs', 'file')],
      ],
    ]);

    const repos = mapWorkspaceFileRepos(
      [repo('repo-1', [entry('repo-1', 'src', 'directory')])],
      directoryEntries
    );

    expect(repos[0].children[0].hasLoadedChildren).toBe(true);
    expect(repos[0].children[0].children?.[0]).toMatchObject({
      repoId: 'repo-1',
      path: 'src/main.rs',
      type: 'file',
    });
  });

  it('filters files without mixing matches across repos', () => {
    const repos = mapWorkspaceFileRepos([
      repo('repo-1', [entry('repo-1', 'server.rs', 'file')]),
      repo('repo-2', [entry('repo-2', 'client.tsx', 'file')]),
    ]);

    const filtered = filterWorkspaceFileRepos(repos, 'client');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].repoId).toBe('repo-2');
    expect(filtered[0].children[0].path).toBe('client.tsx');
  });
});
