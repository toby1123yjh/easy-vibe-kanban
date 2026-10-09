import { useMemo, useCallback, type ReactNode } from 'react';
import { useShape } from '@/shared/integrations/electric/hooks';
import {
  PROJECT_TASKS_SHAPE,
  PROJECT_PROJECT_STATUSES_SHAPE,
  PROJECT_TAGS_SHAPE,
  PROJECT_TASK_ASSIGNEES_SHAPE,
  PROJECT_TASK_FOLLOWERS_SHAPE,
  PROJECT_TASK_TAGS_SHAPE,
  PROJECT_TASK_RELATIONSHIPS_SHAPE,
  PROJECT_PULL_REQUESTS_SHAPE,
  PROJECT_PULL_REQUEST_TASKS_SHAPE,
  PROJECT_WORKSPACES_SHAPE,
  TASK_MUTATION,
  PROJECT_STATUS_MUTATION,
  TAG_MUTATION,
  TASK_ASSIGNEE_MUTATION,
  TASK_FOLLOWER_MUTATION,
  TASK_TAG_MUTATION,
  TASK_RELATIONSHIP_MUTATION,
  PULL_REQUEST_TASK_MUTATION,
  type Task,
  type ProjectStatus,
  type Tag,
} from 'shared/remote-types';
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/shared/hooks/useProjectContext';

interface ProjectProviderProps {
  projectId: string;
  children: ReactNode;
}

export function ProjectProvider({ projectId, children }: ProjectProviderProps) {
  const params = useMemo(() => ({ project_id: projectId }), [projectId]);
  const enabled = Boolean(projectId);

  // Shape subscriptions (with mutations where needed)
  const tasksResult = useShape(PROJECT_TASKS_SHAPE, params, {
    enabled,
    mutation: TASK_MUTATION,
  });
  const statusesResult = useShape(PROJECT_PROJECT_STATUSES_SHAPE, params, {
    enabled,
    mutation: PROJECT_STATUS_MUTATION,
  });
  const tagsResult = useShape(PROJECT_TAGS_SHAPE, params, {
    enabled,
    mutation: TAG_MUTATION,
  });
  const taskAssigneesResult = useShape(PROJECT_TASK_ASSIGNEES_SHAPE, params, {
    enabled,
    mutation: TASK_ASSIGNEE_MUTATION,
  });
  const taskFollowersResult = useShape(PROJECT_TASK_FOLLOWERS_SHAPE, params, {
    enabled,
    mutation: TASK_FOLLOWER_MUTATION,
  });
  const taskTagsResult = useShape(PROJECT_TASK_TAGS_SHAPE, params, {
    enabled,
    mutation: TASK_TAG_MUTATION,
  });
  const taskRelationshipsResult = useShape(
    PROJECT_TASK_RELATIONSHIPS_SHAPE,
    params,
    { enabled, mutation: TASK_RELATIONSHIP_MUTATION }
  );
  const pullRequestsResult = useShape(PROJECT_PULL_REQUESTS_SHAPE, params, {
    enabled,
  });
  const pullRequestTasksResult = useShape(
    PROJECT_PULL_REQUEST_TASKS_SHAPE,
    params,
    { enabled, mutation: PULL_REQUEST_TASK_MUTATION }
  );
  const workspacesResult = useShape(PROJECT_WORKSPACES_SHAPE, params, {
    enabled,
  });

  // Board readiness depends on core kanban data only.
  // Other project-scoped shapes hydrate opportunistically after render.
  const isLoading = tasksResult.isLoading || statusesResult.isLoading;

  // First error found
  const error =
    tasksResult.error ||
    statusesResult.error ||
    tagsResult.error ||
    taskAssigneesResult.error ||
    taskFollowersResult.error ||
    taskTagsResult.error ||
    taskRelationshipsResult.error ||
    pullRequestsResult.error ||
    pullRequestTasksResult.error ||
    workspacesResult.error ||
    null;

  // Combined retry
  const retry = useCallback(() => {
    tasksResult.retry();
    statusesResult.retry();
    tagsResult.retry();
    taskAssigneesResult.retry();
    taskFollowersResult.retry();
    taskTagsResult.retry();
    taskRelationshipsResult.retry();
    pullRequestsResult.retry();
    pullRequestTasksResult.retry();
    workspacesResult.retry();
  }, [
    tasksResult,
    statusesResult,
    tagsResult,
    taskAssigneesResult,
    taskFollowersResult,
    taskTagsResult,
    taskRelationshipsResult,
    pullRequestsResult,
    pullRequestTasksResult,
    workspacesResult,
  ]);

  // Computed Maps for O(1) lookup
  const tasksById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasksResult.data) {
      map.set(task.id, task);
    }
    return map;
  }, [tasksResult.data]);

  const statusesById = useMemo(() => {
    const map = new Map<string, ProjectStatus>();
    for (const status of statusesResult.data) {
      map.set(status.id, status);
    }
    return map;
  }, [statusesResult.data]);

  const tagsById = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const tag of tagsResult.data) {
      map.set(tag.id, tag);
    }
    return map;
  }, [tagsResult.data]);

  // Lookup helpers
  const getTask = useCallback(
    (taskId: string) => tasksById.get(taskId),
    [tasksById]
  );

  const getTasksForStatus = useCallback(
    (statusId: string) =>
      tasksResult.data.filter((i) => i.status_id === statusId),
    [tasksResult.data]
  );

  const getAssigneesForTask = useCallback(
    (taskId: string) =>
      taskAssigneesResult.data.filter((a) => a.task_id === taskId),
    [taskAssigneesResult.data]
  );

  const getFollowersForTask = useCallback(
    (taskId: string) =>
      taskFollowersResult.data.filter((f) => f.task_id === taskId),
    [taskFollowersResult.data]
  );

  const getTagsForTask = useCallback(
    (taskId: string) => taskTagsResult.data.filter((t) => t.task_id === taskId),
    [taskTagsResult.data]
  );

  const getTagObjectsForTask = useCallback(
    (taskId: string) => {
      const taskTags = taskTagsResult.data.filter((t) => t.task_id === taskId);
      return taskTags
        .map((it) => tagsById.get(it.tag_id))
        .filter((t): t is Tag => t !== undefined);
    },
    [taskTagsResult.data, tagsById]
  );

  const getRelationshipsForTask = useCallback(
    (taskId: string) =>
      taskRelationshipsResult.data.filter(
        (r) => r.task_id === taskId || r.related_task_id === taskId
      ),
    [taskRelationshipsResult.data]
  );

  const getStatus = useCallback(
    (statusId: string) => statusesById.get(statusId),
    [statusesById]
  );

  const getTag = useCallback(
    (tagId: string) => tagsById.get(tagId),
    [tagsById]
  );

  const getPullRequestsForTask = useCallback(
    (taskId: string) => {
      const prIds = pullRequestTasksResult.data
        .filter((link) => link.task_id === taskId)
        .map((link) => link.pull_request_id);
      const prIdSet = new Set(prIds);
      return pullRequestsResult.data.filter((pr) => prIdSet.has(pr.id));
    },
    [pullRequestTasksResult.data, pullRequestsResult.data]
  );

  const getWorkspacesForTask = useCallback(
    (taskId: string) =>
      workspacesResult.data.filter((w) => w.task_id === taskId),
    [workspacesResult.data]
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projectId,

      // Data
      tasks: tasksResult.data,
      statuses: statusesResult.data,
      tags: tagsResult.data,
      taskAssignees: taskAssigneesResult.data,
      taskFollowers: taskFollowersResult.data,
      taskTags: taskTagsResult.data,
      taskRelationships: taskRelationshipsResult.data,
      pullRequests: pullRequestsResult.data,
      pullRequestTasks: pullRequestTasksResult.data,
      workspaces: workspacesResult.data,

      // Loading/error
      isLoading,
      error,
      retry,

      // Issue mutations
      insertTask: tasksResult.insert,
      updateTask: tasksResult.update,
      removeTask: tasksResult.remove,

      // Status mutations
      insertStatus: statusesResult.insert,
      updateStatus: statusesResult.update,
      removeStatus: statusesResult.remove,

      // Tag mutations
      insertTag: tagsResult.insert,
      updateTag: tagsResult.update,
      removeTag: tagsResult.remove,

      // IssueAssignee mutations
      insertTaskAssignee: taskAssigneesResult.insert,
      removeTaskAssignee: taskAssigneesResult.remove,

      // IssueFollower mutations
      insertTaskFollower: taskFollowersResult.insert,
      removeTaskFollower: taskFollowersResult.remove,

      // IssueTag mutations
      insertTaskTag: taskTagsResult.insert,
      removeTaskTag: taskTagsResult.remove,

      // IssueRelationship mutations
      insertTaskRelationship: taskRelationshipsResult.insert,
      removeTaskRelationship: taskRelationshipsResult.remove,

      // PullRequestIssue mutations
      insertPullRequestTask: pullRequestTasksResult.insert,
      removePullRequestTask: pullRequestTasksResult.remove,

      // Lookup helpers
      getTask,
      getTasksForStatus,
      getAssigneesForTask,
      getFollowersForTask,
      getTagsForTask,
      getTagObjectsForTask,
      getRelationshipsForTask,
      getStatus,
      getTag,
      getPullRequestsForTask,
      getWorkspacesForTask,

      // Computed aggregations
      tasksById,
      statusesById,
      tagsById,
    }),
    [
      projectId,
      tasksResult,
      statusesResult,
      tagsResult,
      taskAssigneesResult,
      taskFollowersResult,
      taskTagsResult,
      taskRelationshipsResult,
      pullRequestsResult,
      pullRequestTasksResult,
      workspacesResult,
      isLoading,
      error,
      retry,
      getTask,
      getTasksForStatus,
      getAssigneesForTask,
      getFollowersForTask,
      getTagsForTask,
      getTagObjectsForTask,
      getRelationshipsForTask,
      getStatus,
      getTag,
      getPullRequestsForTask,
      getWorkspacesForTask,
      tasksById,
      statusesById,
      tagsById,
    ]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
