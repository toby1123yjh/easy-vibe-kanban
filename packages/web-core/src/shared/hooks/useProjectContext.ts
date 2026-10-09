import { useContext } from 'react';
import { createHmrContext } from '@/shared/lib/hmrContext';
import type { InsertResult, MutationResult } from '@/shared/lib/electric/types';
import type { SyncError } from '@/shared/lib/electric/types';
import type {
  Task,
  ProjectStatus,
  Tag,
  TaskAssignee,
  TaskFollower,
  TaskTag,
  TaskRelationship,
  PullRequest,
  PullRequestTask,
  Workspace,
  CreateTaskRequest,
  UpdateTaskRequest,
  CreateProjectStatusRequest,
  UpdateProjectStatusRequest,
  CreateTagRequest,
  UpdateTagRequest,
  CreateTaskAssigneeRequest,
  CreateTaskFollowerRequest,
  CreateTaskTagRequest,
  CreateTaskRelationshipRequest,
  CreatePullRequestTaskRequest,
} from 'shared/remote-types';

/**
 * ProjectContext provides project-scoped data and mutations.
 *
 * Entities synced at project scope:
 * - Issues (data + mutations)
 * - ProjectStatuses (data + mutations)
 * - Tags (data + mutations)
 * - IssueAssignees (data + mutations)
 * - IssueFollowers (data + mutations)
 * - IssueTags (data + mutations)
 * - IssueRelationships (data + mutations)
 * - PullRequests (data only)
 * - PullRequestIssues (data + mutations)
 * - Workspaces (data only)
 */
export interface ProjectContextValue {
  projectId: string;

  // Normalized data arrays
  tasks: Task[];
  statuses: ProjectStatus[];
  tags: Tag[];
  taskAssignees: TaskAssignee[];
  taskFollowers: TaskFollower[];
  taskTags: TaskTag[];
  taskRelationships: TaskRelationship[];
  pullRequests: PullRequest[];
  pullRequestTasks: PullRequestTask[];
  workspaces: Workspace[];

  // Loading/error state
  isLoading: boolean;
  error: SyncError | null;
  retry: () => void;

  // Issue mutations
  insertTask: (data: CreateTaskRequest) => InsertResult<Task>;
  updateTask: (
    id: string,
    changes: Partial<UpdateTaskRequest>
  ) => MutationResult;
  removeTask: (id: string) => MutationResult;

  // Status mutations
  insertStatus: (
    data: CreateProjectStatusRequest
  ) => InsertResult<ProjectStatus>;
  updateStatus: (
    id: string,
    changes: Partial<UpdateProjectStatusRequest>
  ) => MutationResult;
  removeStatus: (id: string) => MutationResult;

  // Tag mutations
  insertTag: (data: CreateTagRequest) => InsertResult<Tag>;
  updateTag: (id: string, changes: Partial<UpdateTagRequest>) => MutationResult;
  removeTag: (id: string) => MutationResult;

  // IssueAssignee mutations
  insertTaskAssignee: (
    data: CreateTaskAssigneeRequest
  ) => InsertResult<TaskAssignee>;
  removeTaskAssignee: (id: string) => MutationResult;

  // IssueFollower mutations
  insertTaskFollower: (
    data: CreateTaskFollowerRequest
  ) => InsertResult<TaskFollower>;
  removeTaskFollower: (id: string) => MutationResult;

  // IssueTag mutations
  insertTaskTag: (data: CreateTaskTagRequest) => InsertResult<TaskTag>;
  removeTaskTag: (id: string) => MutationResult;

  // IssueRelationship mutations
  insertTaskRelationship: (
    data: CreateTaskRelationshipRequest
  ) => InsertResult<TaskRelationship>;
  removeTaskRelationship: (id: string) => MutationResult;

  // PullRequestIssue mutations
  insertPullRequestTask: (
    data: CreatePullRequestTaskRequest
  ) => InsertResult<PullRequestTask>;
  removePullRequestTask: (id: string) => MutationResult;

  // Lookup helpers
  getTask: (taskId: string) => Task | undefined;
  getTasksForStatus: (statusId: string) => Task[];
  getAssigneesForTask: (taskId: string) => TaskAssignee[];
  getFollowersForTask: (taskId: string) => TaskFollower[];
  getTagsForTask: (taskId: string) => TaskTag[];
  getTagObjectsForTask: (taskId: string) => Tag[];
  getRelationshipsForTask: (taskId: string) => TaskRelationship[];
  getStatus: (statusId: string) => ProjectStatus | undefined;
  getTag: (tagId: string) => Tag | undefined;
  getPullRequestsForTask: (taskId: string) => PullRequest[];
  getWorkspacesForTask: (taskId: string) => Workspace[];

  // Computed aggregations (Maps for O(1) lookup)
  tasksById: Map<string, Task>;
  statusesById: Map<string, ProjectStatus>;
  tagsById: Map<string, Tag>;
}

export const ProjectContext = createHmrContext<ProjectContextValue | null>(
  'RemoteProjectContext',
  null
);

export function useProjectContext(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectProvider');
  }
  return context;
}
