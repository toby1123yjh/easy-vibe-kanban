import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/shared/lib/modals';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { CommandDialog } from '@vibe/ui/components/Command';
import {
  CommandBar,
  type CommandBarGroupItem,
} from '@vibe/ui/components/CommandBar';
import type { PageId, ResolvedGroupItem } from '@/shared/types/commandBar';
import type { StatusItem } from '@/shared/types/selectionItems';
import type { Task } from 'shared/remote-types';
import { buildStatusSelectionPages } from './statusSelection';
import { buildPrioritySelectionPages } from './prioritySelection';
import { buildSubTaskSelectionPages } from './subTaskSelection';
import { buildRelationshipSelectionPages } from './relationshipSelection';
import { resolveLabel, type ActionDefinition } from '@/shared/types/actions';
import type { SelectionPage } from '../SelectionDialog';
import type { StatusSelectionResult } from './statusSelection';
import type { PrioritySelectionResult } from './prioritySelection';
import type { SubTaskSelectionResult } from './subTaskSelection';
import type { RelationshipSelectionResult } from './relationshipSelection';

// Union of all selection modes
export type SelectionMode =
  | { type: 'status'; taskIds: string[]; isCreateMode?: boolean }
  | { type: 'priority'; taskIds: string[]; isCreateMode?: boolean }
  | {
      type: 'subTask';
      parentTaskId: string;
      mode: 'addChild' | 'setParent';
    }
  | {
      type: 'relationship';
      taskId: string;
      relationshipType: 'blocking' | 'related' | 'has_duplicate';
      direction: 'forward' | 'reverse';
    };

interface ProjectSelectionDialogProps {
  projectId: string;
  selection: SelectionMode;
}

function getInitialPageId(selectionType: SelectionMode['type']): string {
  switch (selectionType) {
    case 'status':
      return 'selectStatus';
    case 'priority':
      return 'selectPriority';
    case 'subTask':
      return 'selectSubTask';
    case 'relationship':
      return 'selectRelationshipTask';
  }
}

// Inner component that has access to ProjectContext
function ProjectSelectionContent({ selection }: { selection: SelectionMode }) {
  const modal = useModal();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const {
    statuses,
    tasks,
    taskRelationships,
    updateTask,
    insertTaskRelationship,
  } = useProjectContext();
  const initialPageId = useMemo(
    () => getInitialPageId(selection.type),
    [selection.type]
  );
  const [search, setSearch] = useState('');
  const [currentPageId, setCurrentPageId] = useState(initialPageId);
  const [pageStack, setPageStack] = useState<string[]>([]);

  // Capture focus on mount
  if (!previousFocusRef.current && modal.visible) {
    previousFocusRef.current = document.activeElement as HTMLElement;
  }

  // NiceModal reuses dialog instances; reset local navigation when mode changes.
  useEffect(() => {
    setCurrentPageId(initialPageId);
    setPageStack([]);
    setSearch('');
  }, [initialPageId]);

  const sortedStatuses: StatusItem[] = useMemo(
    () =>
      [...statuses]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({ id: s.id, name: s.name, color: s.color })),
    [statuses]
  );

  // Build filtered issue list for sub-issue selection
  const filteredTasksForSubTask = useMemo((): Task[] => {
    if (selection.type !== 'subTask') return [];
    const { parentTaskId, mode } = selection;

    const tasksById = new Map(tasks.map((i) => [i.id, i]));

    const getAncestorIds = (taskId: string): Set<string> => {
      const ancestors = new Set<string>();
      let current = tasksById.get(taskId);
      while (current?.parent_task_id) {
        ancestors.add(current.parent_task_id);
        current = tasksById.get(current.parent_task_id);
      }
      return ancestors;
    };

    const getDescendantIds = (taskId: string): Set<string> => {
      const descendants = new Set<string>();
      const queue = [taskId];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        for (const task of tasks) {
          if (task.parent_task_id === currentId && !descendants.has(task.id)) {
            descendants.add(task.id);
            queue.push(task.id);
          }
        }
      }
      return descendants;
    };

    const anchorTask = tasksById.get(parentTaskId);

    if (mode === 'addChild') {
      const ancestorIds = getAncestorIds(parentTaskId);
      return tasks.filter((task) => {
        if (task.id === parentTaskId) return false;
        if (task.parent_task_id === parentTaskId) return false;
        if (ancestorIds.has(task.id)) return false;
        return true;
      });
    } else {
      const descendantIds = getDescendantIds(parentTaskId);
      return tasks.filter((task) => {
        if (task.id === parentTaskId) return false;
        if (anchorTask?.parent_task_id === task.id) return false;
        if (descendantIds.has(task.id)) return false;
        return true;
      });
    }
  }, [tasks, selection]);

  // Build filtered issue list for relationship selection
  const filteredTasksForRelationship = useMemo((): Task[] => {
    if (selection.type !== 'relationship') return [];
    const { taskId } = selection;

    const existingRelatedIds = new Set(
      taskRelationships
        .filter((r) => r.task_id === taskId || r.related_task_id === taskId)
        .flatMap((r) => [r.task_id, r.related_task_id])
    );

    return tasks.filter((task) => {
      if (task.id === taskId) return false;
      if (existingRelatedIds.has(task.id)) return false;
      return true;
    });
  }, [tasks, taskRelationships, selection]);

  // Build pages based on selection mode
  const pages = useMemo((): Record<string, SelectionPage> => {
    switch (selection.type) {
      case 'status':
        return buildStatusSelectionPages(sortedStatuses) as Record<
          string,
          SelectionPage
        >;
      case 'priority':
        return buildPrioritySelectionPages() as Record<string, SelectionPage>;
      case 'subTask':
        return buildSubTaskSelectionPages(
          filteredTasksForSubTask,
          selection.mode
        ) as Record<string, SelectionPage>;
      case 'relationship':
        return buildRelationshipSelectionPages(
          filteredTasksForRelationship
        ) as Record<string, SelectionPage>;
    }
  }, [
    selection,
    sortedStatuses,
    filteredTasksForSubTask,
    filteredTasksForRelationship,
  ]);

  // Handle mutation after selection
  const handleResult = useCallback(
    (data: unknown) => {
      if (!data) return;

      if (selection.type === 'status') {
        const result = data as StatusSelectionResult;
        if (selection.isCreateMode) return; // Create mode: caller handles URL update
        for (const taskId of selection.taskIds) {
          updateTask(taskId, { status_id: result.statusId });
        }
      } else if (selection.type === 'priority') {
        const result = data as PrioritySelectionResult;
        if (selection.isCreateMode) return;
        for (const taskId of selection.taskIds) {
          updateTask(taskId, { priority: result.priority });
        }
      } else if (selection.type === 'subTask') {
        const result = data as SubTaskSelectionResult;
        if (result.type === 'selected') {
          if (selection.mode === 'addChild') {
            updateTask(result.taskId, {
              parent_task_id: selection.parentTaskId,
            });
          } else {
            updateTask(selection.parentTaskId, {
              parent_task_id: result.taskId,
            });
          }
        }
        // 'createNew' is handled by the caller (AddSubIssue action)
      } else if (selection.type === 'relationship') {
        const result = data as RelationshipSelectionResult;
        if (selection.direction === 'forward') {
          insertTaskRelationship({
            task_id: selection.taskId,
            related_task_id: result.taskId,
            relationship_type: selection.relationshipType,
          });
        } else {
          insertTaskRelationship({
            task_id: result.taskId,
            related_task_id: selection.taskId,
            relationship_type: selection.relationshipType,
          });
        }
      }
    },
    [selection, updateTask, insertTaskRelationship]
  );

  const fallbackPage = pages[initialPageId] ?? Object.values(pages)[0];
  const currentPage = pages[currentPageId] ?? fallbackPage;

  const resolvedPage = useMemo(
    () =>
      currentPage
        ? {
            id: currentPage.id,
            title: currentPage.title,
            groups: currentPage.buildGroups(),
          }
        : { id: initialPageId, title: '', groups: [] },
    [currentPage, initialPageId]
  );

  const handleSelect = useCallback(
    (item: CommandBarGroupItem<ActionDefinition, PageId>) => {
      const result = currentPage.onSelect(item as ResolvedGroupItem);
      if (result.type === 'complete') {
        handleResult(result.data);
        modal.resolve(result.data);
        modal.hide();
      } else if (result.type === 'navigate') {
        setPageStack((prev) => [...prev, currentPage.id]);
        setCurrentPageId(result.pageId);
        setSearch('');
      }
    },
    [currentPage, modal, handleResult]
  );

  const handleGoBack = useCallback(() => {
    const prevPage = pageStack[pageStack.length - 1];
    if (prevPage) {
      setPageStack((prev) => prev.slice(0, -1));
      setCurrentPageId(prevPage);
      setSearch('');
    }
  }, [pageStack]);

  const handleClose = useCallback(() => {
    modal.resolve(undefined);
    modal.hide();
  }, [modal]);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const activeElement = document.activeElement;
    const isInDialog = activeElement?.closest('[role="dialog"]');
    if (!isInDialog) {
      previousFocusRef.current?.focus();
    }
  }, []);

  if (!currentPage) {
    return null;
  }

  return (
    <CommandDialog
      open={modal.visible}
      onOpenChange={(open) => !open && handleClose()}
      onCloseAutoFocus={handleCloseAutoFocus}
    >
      <CommandBar
        page={resolvedPage}
        canGoBack={pageStack.length > 0}
        onGoBack={handleGoBack}
        onSelect={handleSelect}
        getLabel={(action) => resolveLabel(action)}
        search={search}
        onSearchChange={setSearch}
        statuses={sortedStatuses}
      />
    </CommandDialog>
  );
}

const ProjectSelectionDialogImpl = create<ProjectSelectionDialogProps>(
  ({ projectId, selection }) => {
    return (
      <ProjectProvider projectId={projectId}>
        <ProjectSelectionContent selection={selection} />
      </ProjectProvider>
    );
  }
);

export const ProjectSelectionDialog = defineModal<
  ProjectSelectionDialogProps,
  unknown | undefined
>(ProjectSelectionDialogImpl);
