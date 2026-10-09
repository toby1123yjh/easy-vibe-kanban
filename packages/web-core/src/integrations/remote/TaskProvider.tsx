import { useMemo, useCallback, type ReactNode } from 'react';
import { useShape } from '@/shared/integrations/electric/hooks';
import {
  TASK_COMMENTS_SHAPE,
  TASK_REACTIONS_SHAPE,
  TASK_COMMENT_MUTATION,
  TASK_COMMENT_REACTION_MUTATION,
  type TaskComment,
  type TaskCommentReaction,
} from 'shared/remote-types';
import {
  TaskContext,
  type TaskContextValue,
} from '@/shared/hooks/useTaskContext';

interface TaskProviderProps {
  taskId: string;
  children: ReactNode;
}

export function TaskProvider({ taskId, children }: TaskProviderProps) {
  const params = useMemo(() => ({ task_id: taskId }), [taskId]);
  const enabled = Boolean(taskId);

  // Shape subscriptions
  const commentsResult = useShape(TASK_COMMENTS_SHAPE, params, {
    enabled,
    mutation: TASK_COMMENT_MUTATION,
  });
  const reactionsResult = useShape(TASK_REACTIONS_SHAPE, params, {
    enabled,
    mutation: TASK_COMMENT_REACTION_MUTATION,
  });

  // Combined loading state
  const isLoading = commentsResult.isLoading || reactionsResult.isLoading;

  // First error found
  const error = commentsResult.error || reactionsResult.error || null;

  // Combined retry
  const retry = useCallback(() => {
    commentsResult.retry();
    reactionsResult.retry();
  }, [commentsResult, reactionsResult]);

  // Computed Maps for O(1) lookup
  const commentsById = useMemo(() => {
    const map = new Map<string, TaskComment>();
    for (const comment of commentsResult.data) {
      map.set(comment.id, comment);
    }
    return map;
  }, [commentsResult.data]);

  const reactionsByComment = useMemo(() => {
    const map = new Map<string, TaskCommentReaction[]>();
    for (const reaction of reactionsResult.data) {
      const existing = map.get(reaction.comment_id) ?? [];
      existing.push(reaction);
      map.set(reaction.comment_id, existing);
    }
    return map;
  }, [reactionsResult.data]);

  // Lookup helpers
  const getComment = useCallback(
    (commentId: string) => commentsById.get(commentId),
    [commentsById]
  );

  const getReactionsForComment = useCallback(
    (commentId: string) => reactionsByComment.get(commentId) ?? [],
    [reactionsByComment]
  );

  const getReactionCountForComment = useCallback(
    (commentId: string) => (reactionsByComment.get(commentId) ?? []).length,
    [reactionsByComment]
  );

  const hasUserReactedToComment = useCallback(
    (commentId: string, userId: string, emoji: string) => {
      const reactions = reactionsByComment.get(commentId) ?? [];
      return reactions.some((r) => r.user_id === userId && r.emoji === emoji);
    },
    [reactionsByComment]
  );

  const value = useMemo<TaskContextValue>(
    () => ({
      taskId,

      // Data
      comments: commentsResult.data,
      reactions: reactionsResult.data,

      // Loading/error
      isLoading,
      error,
      retry,

      // Comment mutations
      insertComment: commentsResult.insert,
      updateComment: commentsResult.update,
      removeComment: commentsResult.remove,

      // Reaction mutations
      insertReaction: reactionsResult.insert,
      removeReaction: reactionsResult.remove,

      // Lookup helpers
      getComment,
      getReactionsForComment,
      getReactionCountForComment,
      hasUserReactedToComment,

      // Computed aggregations
      commentsById,
      reactionsByComment,
    }),
    [
      taskId,
      commentsResult,
      reactionsResult,
      isLoading,
      error,
      retry,
      getComment,
      getReactionsForComment,
      getReactionCountForComment,
      hasUserReactedToComment,
      commentsById,
      reactionsByComment,
    ]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
