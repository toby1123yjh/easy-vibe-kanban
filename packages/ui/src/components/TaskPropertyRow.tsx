import { cn } from '../lib/cn';
import { PlusIcon, UsersIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from './PrimaryButton';
import { IconButton } from './IconButton';
import { StatusDot } from './StatusDot';
import { PriorityIcon, type PriorityLevel } from './PriorityIcon';
import { UserAvatar, type UserAvatarUser } from './UserAvatar';
import { KanbanAssignee, type KanbanAssigneeUser } from './KanbanAssignee';

export interface TaskPropertyStatus {
  id: string;
  name: string;
  color: string;
}

const priorityLabels: Record<PriorityLevel, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export interface TaskPropertyRowProps {
  statusId: string;
  priority: PriorityLevel | null;
  assigneeIds: string[];
  assigneeUsers?: KanbanAssigneeUser[];
  statuses: TaskPropertyStatus[];
  creatorUser?: UserAvatarUser | null;
  parentTask?: { id: string; simpleId: string } | null;
  onParentTaskClick?: () => void;
  onRemoveParentTask?: () => void;
  onStatusClick: () => void;
  onPriorityClick: () => void;
  onAssigneeClick: () => void;
  onAddClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function TaskPropertyRow({
  statusId,
  priority,
  assigneeUsers,
  statuses,
  creatorUser,
  parentTask,
  onParentTaskClick,
  onRemoveParentTask,
  onStatusClick,
  onPriorityClick,
  onAssigneeClick,
  onAddClick,
  disabled,
  className,
}: TaskPropertyRowProps) {
  const { t } = useTranslation('common');

  return (
    <div className={cn('flex items-center gap-half flex-wrap', className)}>
      <PrimaryButton
        variant="tertiary"
        onClick={onStatusClick}
        disabled={disabled}
      >
        <StatusDot
          color={statuses.find((s) => s.id === statusId)?.color ?? '0 0% 50%'}
        />
        {statuses.find((s) => s.id === statusId)?.name ?? 'Select status'}
      </PrimaryButton>

      <PrimaryButton
        variant="tertiary"
        onClick={onPriorityClick}
        disabled={disabled}
      >
        <PriorityIcon priority={priority} />
        {priority ? priorityLabels[priority] : 'No priority'}
      </PrimaryButton>

      <PrimaryButton
        variant="tertiary"
        onClick={onAssigneeClick}
        disabled={disabled}
      >
        {assigneeUsers && assigneeUsers.length > 0 ? (
          <KanbanAssignee assignees={assigneeUsers} />
        ) : (
          <>
            <UsersIcon className="size-icon-xs" weight="bold" />
            {t('kanban.assignee', 'Assignee')}
          </>
        )}
      </PrimaryButton>

      {creatorUser &&
        (creatorUser.first_name?.trim() || creatorUser.username?.trim()) && (
          <div className="flex items-center gap-half px-base py-half bg-panel rounded-sm text-sm whitespace-nowrap">
            <span className="text-low">
              {t('kanban.createdBy', 'Created by')}
            </span>
            <UserAvatar
              user={creatorUser}
              className="h-5 w-5 text-[9px] border border-border"
            />
            <span className="text-normal truncate max-w-[120px]">
              {creatorUser.first_name?.trim() || creatorUser.username?.trim()}
            </span>
          </div>
        )}

      {parentTask && (
        <div className="flex items-center gap-half">
          <PrimaryButton
            variant="tertiary"
            onClick={onParentTaskClick}
            disabled={disabled}
            className="whitespace-nowrap text-sm"
          >
            <span className="text-low">
              {t('kanban.parentIssue', 'Parent')}:
            </span>
            <span className="font-ibm-plex-mono text-normal">
              {parentTask.simpleId}
            </span>
          </PrimaryButton>
          {onRemoveParentTask && (
            <IconButton
              icon={XIcon}
              onClick={onRemoveParentTask}
              disabled={disabled}
              aria-label="Remove parent task"
              title="Remove parent task"
            />
          )}
        </div>
      )}

      {onAddClick && (
        <IconButton
          icon={PlusIcon}
          onClick={onAddClick}
          disabled={disabled}
          aria-label="Add"
          title="Add"
        />
      )}
    </div>
  );
}
