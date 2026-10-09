import type { ExecutorConfig } from 'shared/types';

export interface LinkedTask {
  taskId: string;
  simpleId?: string;
  title?: string;
  remoteProjectId: string;
}

export interface CreateModeInitialState {
  initialPrompt?: string | null;
  preferredRepos?: Array<{
    repo_id: string;
    target_branch: string | null;
  }> | null;
  preferredDirectoryPath?: string | null;
  project_id?: string | null;
  linkedTask?: LinkedTask | null;
  executorConfig?: ExecutorConfig | null;
}
