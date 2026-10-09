import { useMemo, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  PlusIcon,
  ArrowBendUpRightIcon,
  ProhibitIcon,
  ArrowsLeftRightIcon,
  CopyIcon,
} from '@phosphor-icons/react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useActions } from '@/shared/hooks/useActions';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { resolveRelationshipsForTask } from '@/shared/lib/resolveRelationships';
import { TaskRelationshipsSection } from '@vibe/ui/components/TaskRelationshipsSection';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@vibe/ui/components/Dropdown';

interface TaskRelationshipsSectionContainerProps {
  taskId: string;
}

export function TaskRelationshipsSectionContainer({
  taskId,
}: TaskRelationshipsSectionContainerProps) {
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const { openRelationshipSelection } = useActions();

  const {
    getRelationshipsForTask,
    removeTaskRelationship,
    tasksById,
    isLoading,
  } = useProjectContext();

  const relationships = useMemo(
    () =>
      resolveRelationshipsForTask(
        taskId,
        getRelationshipsForTask(taskId),
        tasksById
      ),
    [taskId, getRelationshipsForTask, tasksById]
  );

  const handleRelationshipClick = useCallback(
    (relatedTaskId: string) => {
      if (!projectId) {
        return;
      }

      appNavigation.goToProjectTask(projectId, relatedTaskId);
    },
    [projectId, appNavigation]
  );

  const handleRemoveRelationship = useCallback(
    (relationshipId: string) => {
      removeTaskRelationship(relationshipId);
    },
    [removeTaskRelationship]
  );

  const handleSelectType = useCallback(
    (
      relationshipType: 'blocking' | 'related' | 'has_duplicate',
      direction: 'forward' | 'reverse'
    ) => {
      if (projectId) {
        openRelationshipSelection(
          projectId,
          taskId,
          relationshipType,
          direction
        );
      }
    },
    [projectId, taskId, openRelationshipSelection]
  );

  const headerExtra = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="text-low hover:text-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <PlusIcon className="size-icon-xs" weight="bold" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          icon={ArrowBendUpRightIcon}
          onSelect={() => handleSelectType('blocking', 'forward')}
        >
          Blocks...
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ProhibitIcon}
          onSelect={() => handleSelectType('blocking', 'reverse')}
        >
          Blocked by...
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ArrowsLeftRightIcon}
          onSelect={() => handleSelectType('related', 'forward')}
        >
          Related to...
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={CopyIcon}
          onSelect={() => handleSelectType('has_duplicate', 'forward')}
        >
          Duplicate of...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <TaskRelationshipsSection
      relationships={relationships}
      onRelationshipClick={handleRelationshipClick}
      onRemoveRelationship={handleRemoveRelationship}
      isLoading={isLoading}
      headerExtra={headerExtra}
    />
  );
}
