import type { TaskPriority } from 'shared/remote-types';

export interface RepoItem {
  id: string;
  display_name: string;
}

export interface StatusItem {
  id: string;
  name: string;
  color: string;
}

export interface PriorityItem {
  id: TaskPriority | null;
  name: string;
}

export interface BranchItem {
  name: string;
  isCurrent: boolean;
}
