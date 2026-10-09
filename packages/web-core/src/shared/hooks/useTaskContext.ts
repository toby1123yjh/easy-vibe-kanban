import { useContext } from 'react';
import { createHmrContext } from '@/shared/lib/hmrContext';
import type { InsertResult, MutationResult } from '@/shared/lib/electric/types';
import type {
  TaskComment,
  TaskCommentReaction,
  CreateTaskCommentRequest,
  UpdateTaskCommentRequest,
  CreateTaskCommentReactionRequest,
} from 'shared/remote-types';
import type { SyncError } from '@/shared/lib/electric/types';

export interface TaskContextValue {
  taskId: string;

  // Normalized data arrays (Electric syncs only this issue's data)
  comments: TaskComment[];
  reactions: TaskCommentReaction[];

  // Loading/error state
  isLoading: boolean;
  error: SyncError | null;
  retry: () => void;

  // Comment mutations
  insertComment: (data: CreateTaskCommentRequest) => InsertResult<TaskComment>;
  updateComment: (
    id: string,
    changes: Partial<UpdateTaskCommentRequest>
  ) => MutationResult;
  removeComment: (id: string) => MutationResult;

  // Reaction mutations
  insertReaction: (
    data: CreateTaskCommentReactionRequest
  ) => InsertResult<TaskCommentReaction>;
  removeReaction: (id: string) => MutationResult;

  // Lookup helpers (within this issue's data)
  getComment: (commentId: string) => TaskComment | undefined;
  getReactionsForComment: (commentId: string) => TaskCommentReaction[];
  getReactionCountForComment: (commentId: string) => number;
  hasUserReactedToComment: (
    commentId: string,
    userId: string,
    emoji: string
  ) => boolean;

  // Computed aggregations
  commentsById: Map<string, TaskComment>;
  reactionsByComment: Map<string, TaskCommentReaction[]>;
}

export const TaskContext = createHmrContext<TaskContextValue | null>(
  'TaskContext',
  null
);

export function useTaskContext(): TaskContextValue {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error('useIssueContext must be used within an IssueProvider');
  }
  return context;
}

export function useTaskContextOptional(): TaskContextValue | null {
  return useContext(TaskContext);
}
