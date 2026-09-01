import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragCancelEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@vibe/ui/components/Button';
import { DegradedState, LoadingState } from '@vibe/ui/components/StateSurface';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { TaskStatus, TaskSummary } from 'shared/types';
import {
  KANBAN_POINTER_ACTIVATION_DISTANCE,
  findKanbanIssue,
  isInteractiveDragTarget,
  moveKanbanIssue,
  taskStatusLabel,
  type KanbanColumnProjection,
  type KanbanIssueProjection,
  type KanbanMoveUpdate,
} from '../model/project-kanban';
import './project-surfaces.css';

const kanbanKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') {
    return sortableKeyboardCoordinates(event, args);
  }

  event.preventDefault();
  const { active, collisionRect, droppableContainers, droppableRects, over } =
    args.context;
  if (!active || !collisionRect) return undefined;

  const currentContainer = over
    ? droppableContainers.get(over.id)
    : droppableContainers.get(active.id);
  const currentStatusId = currentContainer?.data.current?.statusId;
  if (typeof currentStatusId !== 'string') return undefined;

  const columns = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const data = container.data.current;
      const rect = droppableRects.get(container.id);
      return data?.type === 'column' && rect
        ? [{ container, rect, statusId: String(data.statusId) }]
        : [];
    })
    .sort((left, right) => left.rect.left - right.rect.left);
  const currentColumnIndex = columns.findIndex(
    (column) => column.statusId === currentStatusId
  );
  const direction = event.code === 'ArrowRight' ? 1 : -1;
  const targetColumn = columns[currentColumnIndex + direction];
  if (!targetColumn) return undefined;

  const collisionCenter = collisionRect.top + collisionRect.height / 2;
  const closestIssue = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const data = container.data.current;
      const rect = droppableRects.get(container.id);
      return data?.type === 'issue' &&
        data.statusId === targetColumn.statusId &&
        rect
        ? [
            {
              rect,
              distance: Math.abs(rect.top + rect.height / 2 - collisionCenter),
            },
          ]
        : [];
    })
    .sort((left, right) => left.distance - right.distance)[0];
  const targetRect = closestIssue?.rect ?? targetColumn.rect;
  return { x: targetRect.left, y: targetRect.top };
};

interface ProjectKanbanViewProps {
  projectName: string;
  columns: KanbanColumnProjection[];
  issueCount: number;
  query: string;
  selectedIssueId: string | null;
  dragDisabled: boolean;
  projectSource?: {
    title: string;
    description?: string;
    retry(): void;
    retrying?: boolean;
  };
  taskSource: {
    state: 'ready' | 'loading' | 'degraded';
    title?: string;
    description?: string;
    retry?(): void;
    retrying?: boolean;
  };
  panel?: ReactNode;
  onQueryChange(query: string): void;
  onCreateIssue(statusId?: string): void;
  onOpenIssue(issueId: string, trigger: HTMLElement): void;
  onOpenTask(task: TaskSummary): void;
  onDeleteIssue(issueId: string): Promise<void>;
  getTaskUnavailableReason(task: TaskSummary): string | null;
  onMove(updates: KanbanMoveUpdate[]): Promise<void>;
}

const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  draft: CircleDashed,
  pending: Clock3,
  running: LoaderCircle,
  waiting: Clock3,
  succeeded: CircleCheck,
  failed: CircleAlert,
  cancelled: XCircle,
};

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      className={status === 'running' ? 'vk-task-status-icon--running' : ''}
      data-status={status}
      aria-label={taskStatusLabel(status)}
      size={14}
    />
  );
}

function IssueTaskPreview({
  task,
  onOpen,
  unavailableReason,
}: {
  task: TaskSummary;
  onOpen(): void;
  unavailableReason: string | null;
}) {
  return (
    <button
      type="button"
      className="vk-kanban-task-preview"
      data-no-drag
      aria-disabled={unavailableReason ? true : undefined}
      title={unavailableReason ?? undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (!unavailableReason) onOpen();
      }}
    >
      <TaskStatusIcon status={task.status} />
      <span>{task.title}</span>
      <ArrowRight aria-hidden="true" size={13} />
    </button>
  );
}

interface KanbanIssueCardProps {
  issue: KanbanIssueProjection;
  selected: boolean;
  dragDisabled: boolean;
  onOpen(trigger: HTMLElement): void;
  onOpenTask(task: TaskSummary): void;
  onDelete(): Promise<void>;
  getTaskUnavailableReason(task: TaskSummary): string | null;
}

function KanbanIssueCard({
  issue,
  selected,
  dragDisabled,
  onOpen,
  onOpenTask,
  onDelete,
  getTaskUnavailableReason,
}: KanbanIssueCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { type: 'issue', statusId: issue.statusId },
    disabled: dragDisabled,
  });
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const pointerMoved = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !menuTriggerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      menuTriggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target;
    const touchHandle =
      target instanceof Element
        ? target.closest('[data-touch-drag-handle]')
        : null;
    if (
      (event.pointerType === 'touch' && !touchHandle) ||
      (isInteractiveDragTarget(target, event.currentTarget) && !touchHandle)
    ) {
      return;
    }
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    pointerMoved.current = false;
    if (!dragDisabled) listeners?.onPointerDown?.(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pointerOrigin.current) return;
    const distance = Math.hypot(
      event.clientX - pointerOrigin.current.x,
      event.clientY - pointerOrigin.current.y
    );
    if (distance >= KANBAN_POINTER_ACTIVATION_DISTANCE) {
      pointerMoved.current = true;
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (
      isDragging ||
      pointerMoved.current ||
      isInteractiveDragTarget(event.target, event.currentTarget)
    ) {
      pointerMoved.current = false;
      return;
    }
    onOpen(event.currentTarget);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.target !== event.currentTarget &&
      isInteractiveDragTarget(event.target, event.currentTarget)
    ) {
      return;
    }
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      onOpen(event.currentTarget);
      return;
    }
    if (!dragDisabled) listeners?.onKeyDown?.(event);
  };

  return (
    <article
      ref={setNodeRef}
      className="vk-kanban-issue-card"
      data-issue-id={issue.id}
      data-selected={selected}
      data-dragging={isDragging}
      data-drag-disabled={dragDisabled}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={() => {
        pointerOrigin.current = null;
      }}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      aria-label={`${issue.simpleId}: ${issue.title}. ${
        dragDisabled ? '' : 'Press Space to move or '
      }press Enter to open.`}
    >
      <header className="vk-kanban-issue-card__meta">
        <span>{issue.simpleId}</span>
        <button
          ref={menuTriggerRef}
          type="button"
          className="vk-kanban-issue-card__menu"
          data-no-drag
          aria-label={`More actions for ${issue.simpleId}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <MoreHorizontal aria-hidden="true" size={16} />
        </button>
        <button
          type="button"
          className="vk-kanban-card-drag-handle"
          data-touch-drag-handle
          aria-label={`Drag ${issue.simpleId}`}
          title="Drag issue"
        >
          <GripVertical aria-hidden="true" size={16} />
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            className="vk-kanban-issue-card__menu-popover"
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              data-no-drag
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                void onDelete();
              }}
            >
              <Trash2 aria-hidden="true" size={15} />
              Delete issue
            </button>
          </div>
        ) : null}
      </header>
      <h3 title={issue.title}>{issue.title}</h3>
      <div className="vk-kanban-issue-card__labels">
        {issue.priority ? (
          <span
            className="vk-priority"
            data-priority={issue.priority}
            data-no-drag
          >
            {issue.priority}
          </span>
        ) : null}
        {issue.tags.map((tag) => (
          <span key={tag.id} className="vk-issue-tag" data-no-drag>
            {tag.name}
          </span>
        ))}
      </div>
      {issue.tasks.length > 0 ? (
        <div className="vk-kanban-issue-card__tasks" data-no-drag>
          <small>{issue.tasks.length} tasks</small>
          {issue.tasks.slice(0, 2).map((task) => (
            <IssueTaskPreview
              key={task.id}
              task={task}
              onOpen={() => onOpenTask(task)}
              unavailableReason={getTaskUnavailableReason(task)}
            />
          ))}
          {issue.tasks.length > 2 ? (
            <button
              type="button"
              className="vk-kanban-more-tasks"
              data-no-drag
              onClick={(event) => {
                event.stopPropagation();
                onOpen(event.currentTarget);
              }}
            >
              +{issue.tasks.length - 2} tasks
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function KanbanColumn({
  column,
  selectedIssueId,
  dragDisabled,
  onCreateIssue,
  onOpenIssue,
  onOpenTask,
  onDeleteIssue,
  getTaskUnavailableReason,
}: {
  column: KanbanColumnProjection;
  selectedIssueId: string | null;
  dragDisabled: boolean;
  onCreateIssue(): void;
  onOpenIssue(issueId: string, trigger: HTMLElement): void;
  onOpenTask(task: TaskSummary): void;
  onDeleteIssue(issueId: string): Promise<void>;
  getTaskUnavailableReason(task: TaskSummary): string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', statusId: column.id },
  });
  return (
    <section
      ref={setNodeRef}
      className="vk-kanban-column"
      data-over={isOver}
      aria-labelledby={`kanban-column-${column.id}`}
    >
      <header className="vk-kanban-column__header">
        <span
          className="vk-kanban-column__dot"
          style={
            { '--vk-status-color': `hsl(${column.color})` } as CSSProperties
          }
          aria-hidden="true"
        />
        <h2 id={`kanban-column-${column.id}`}>{column.name}</h2>
        <span className="vk-kanban-column__count">{column.issues.length}</span>
        <button
          type="button"
          onClick={onCreateIssue}
          aria-label={`Create issue in ${column.name}`}
        >
          <Plus aria-hidden="true" size={16} />
        </button>
      </header>
      <SortableContext
        items={column.issues.map((issue) => issue.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="vk-kanban-column__cards">
          {column.issues.map((issue) => (
            <KanbanIssueCard
              key={issue.id}
              issue={issue}
              selected={issue.id === selectedIssueId}
              dragDisabled={dragDisabled}
              onOpen={(trigger) => onOpenIssue(issue.id, trigger)}
              onOpenTask={onOpenTask}
              onDelete={() => onDeleteIssue(issue.id)}
              getTaskUnavailableReason={getTaskUnavailableReason}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

export function ProjectKanbanView({
  projectName,
  columns,
  issueCount,
  query,
  selectedIssueId,
  dragDisabled,
  projectSource,
  taskSource,
  panel,
  onQueryChange,
  onCreateIssue,
  onOpenIssue,
  onOpenTask,
  onDeleteIssue,
  getTaskUnavailableReason,
  onMove,
}: ProjectKanbanViewProps) {
  const { t } = useTranslation('common');
  const [displayColumns, setDisplayColumns] = useState(columns);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: KANBAN_POINTER_ACTIVATION_DISTANCE },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: kanbanKeyboardCoordinates })
  );
  const sourceStates = [
    projectSource
      ? {
          id: 'project',
          state: 'degraded' as const,
          ...projectSource,
        }
      : null,
    taskSource.state === 'ready' ? null : { id: 'tasks', ...taskSource },
  ].filter((source) => source !== null);

  useEffect(() => setDisplayColumns(columns), [columns]);

  const activeIssue = useMemo(
    () =>
      activeIssueId ? findKanbanIssue(displayColumns, activeIssueId) : null,
    [activeIssueId, displayColumns]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const issue = findKanbanIssue(displayColumns, String(event.active.id));
    setActiveIssueId(issue?.id ?? null);
    if (issue) setAnnouncement(`Picked up ${issue.simpleId}.`);
  };

  const handleDragCancel = (event?: DragCancelEvent) => {
    const cancelledIssue = event
      ? findKanbanIssue(displayColumns, String(event.active.id))
      : activeIssue;
    if (cancelledIssue) {
      setAnnouncement(`Movement cancelled for ${cancelledIssue.simpleId}.`);
    }
    setActiveIssueId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const issue = findKanbanIssue(displayColumns, String(event.active.id));
    const overId = event.over ? String(event.over.id) : null;
    if (!issue || !overId) {
      handleDragCancel();
      return;
    }

    const targetIssue = findKanbanIssue(displayColumns, overId);
    if (targetIssue?.id === issue.id) {
      setAnnouncement(`No valid destination for ${issue.simpleId}.`);
      setActiveIssueId(null);
      return;
    }
    const targetColumn = targetIssue
      ? displayColumns.find((column) => column.id === targetIssue.statusId)
      : displayColumns.find((column) => column.id === overId);
    if (!targetColumn) {
      setAnnouncement(`No valid destination for ${issue.simpleId}.`);
      setActiveIssueId(null);
      return;
    }

    const targetIndex = targetIssue
      ? targetColumn.issues.findIndex(
          (candidate) => candidate.id === targetIssue.id
        )
      : targetColumn.issues.length;
    const move = moveKanbanIssue(displayColumns, {
      issueId: issue.id,
      sourceStatusId: issue.statusId,
      targetStatusId: targetColumn.id,
      targetIndex,
    });
    setActiveIssueId(null);
    if (!move) {
      setAnnouncement(`No valid destination for ${issue.simpleId}.`);
      return;
    }

    const previousColumns = displayColumns;
    setDisplayColumns(move.columns);
    setAnnouncement(`Moved ${issue.simpleId} to ${targetColumn.name}.`);
    try {
      await onMove(move.updates);
    } catch {
      setDisplayColumns(previousColumns);
      setAnnouncement(
        `Move failed. ${issue.simpleId} was returned to its previous position.`
      );
    }
  };

  return (
    <section className="vk-project-kanban" aria-label={`${projectName} board`}>
      <header className="vk-project-kanban__toolbar">
        <div className="vk-project-kanban__identity">
          <span aria-hidden="true">
            {projectName.slice(0, 1).toLocaleUpperCase()}
          </span>
          <strong>{projectName}</strong>
        </div>
        <label className="vk-kanban-search">
          <Search aria-hidden="true" size={16} />
          <span className="vk-visually-hidden">
            Search issues in {projectName}
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search issues"
          />
        </label>
        <span className="vk-project-kanban__issue-count">
          {issueCount} {issueCount === 1 ? 'Issue' : 'Issues'}
        </span>
        <button
          type="button"
          className="vk-primary-action"
          onClick={() => onCreateIssue()}
        >
          <Plus aria-hidden="true" size={16} />
          New issue
        </button>
      </header>

      {sourceStates.length > 0 ? (
        <div className="vk-project-kanban__task-source !flex-col !items-stretch !gap-0 !p-0">
          {sourceStates.map((source) => {
            const SourceState =
              source.state === 'loading' ? LoadingState : DegradedState;
            return (
              <SourceState
                key={source.id}
                compact
                className="w-full !flex-row !justify-start !rounded-none !text-left"
                title={source.title ?? 'Loading execution tasks…'}
                description={source.description}
                action={
                  source.retry ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      loading={source.retrying}
                      loadingLabel={t('buttons.retry')}
                      onClick={source.retry}
                    >
                      {t('buttons.retry')}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      ) : null}

      <div className="vk-kanban-dnd-root">
        <DndContext
          sensors={sensors}
          collisionDetection={(args) =>
            args.pointerCoordinates ? pointerWithin(args) : closestCorners(args)
          }
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={(event) => void handleDragEnd(event)}
          autoScroll={{ enabled: true, threshold: { x: 0.12, y: 0.12 } }}
        >
          <div
            className="vk-kanban-scroll"
            tabIndex={0}
            aria-label="Kanban columns"
          >
            <div className="vk-kanban-columns">
              {displayColumns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  selectedIssueId={selectedIssueId}
                  dragDisabled={dragDisabled}
                  onCreateIssue={() => onCreateIssue(column.id)}
                  onOpenIssue={onOpenIssue}
                  onOpenTask={onOpenTask}
                  onDeleteIssue={onDeleteIssue}
                  getTaskUnavailableReason={getTaskUnavailableReason}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeIssue ? (
              <div className="vk-kanban-drag-preview">
                <span>{activeIssue.simpleId}</span>
                <strong>{activeIssue.title}</strong>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <p className="vk-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {panel}
    </section>
  );
}
