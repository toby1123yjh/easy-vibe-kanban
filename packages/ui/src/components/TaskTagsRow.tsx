import type { ReactNode } from 'react';
import { PlusIcon, HashIcon, GitPullRequest } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { PRESET_COLORS } from './ColorPicker';
import { PrBadge, type PrBadgeStatus } from './PrBadge';
import { TAG_COLORS } from './SearchableTagDropdown';

// Re-export for backwards compatibility.
export { PRESET_COLORS, TAG_COLORS };

export interface TaskTagBase {
  id: string;
  name: string;
  color: string;
}

export interface LinkedPullRequest {
  id: string;
  number: number;
  url: string;
  status: PrBadgeStatus;
}

export interface LinkedTask {
  id: string;
  displayId: string;
  title: string;
}

export interface TaskTagsRowProps<TTag extends TaskTagBase = TaskTagBase> {
  selectedTagIds: string[];
  availableTags: TTag[];
  linkedPrs?: LinkedPullRequest[];
  linkedTasks?: LinkedTask[];
  onTagsChange: (tagIds: string[]) => void;
  onCreateTag?: (data: { name: string; color: string }) => string;
  renderAddTagControl?: (
    props: TaskTagsRowAddTagControlProps<TTag>
  ) => ReactNode;
  onLinkPr?: () => void;
  disabled?: boolean;
  className?: string;
}

export interface TaskTagsRowAddTagControlProps<
  TTag extends TaskTagBase = TaskTagBase,
> {
  tags: TTag[];
  selectedTagIds: string[];
  onTagToggle: (tagId: string) => void;
  onCreateTag: (data: { name: string; color: string }) => string;
  disabled: boolean;
  trigger: ReactNode;
}

export function TaskTagsRow<TTag extends TaskTagBase>({
  selectedTagIds,
  availableTags,
  linkedPrs = [],
  linkedTasks = [],
  onTagsChange,
  onCreateTag,
  renderAddTagControl,
  onLinkPr,
  disabled,
  className,
}: TaskTagsRowProps<TTag>) {
  const selectedTags = availableTags.filter((tag) =>
    selectedTagIds.includes(tag.id)
  );

  const handleTagToggle = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      onTagsChange(selectedTagIds.filter((id) => id !== tagId));
    } else {
      onTagsChange([...selectedTagIds, tagId]);
    }
  };

  const handleCreateTag = (data: { name: string; color: string }): string => {
    return onCreateTag?.(data) ?? '';
  };

  const addTagTrigger = (
    <button
      type="button"
      className="flex items-center justify-center h-5 w-5 rounded-sm text-low hover:text-normal hover:bg-panel transition-colors disabled:opacity-50"
      disabled={disabled}
      aria-label="Add tag"
    >
      <PlusIcon className="size-icon-xs" weight="bold" />
    </button>
  );

  return (
    <div className={cn('flex items-center gap-half flex-wrap', className)}>
      {/* Selected Tags - clickable to remove on hover */}
      {selectedTags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => handleTagToggle(tag.id)}
          disabled={disabled}
          className={cn(
            'inline-flex items-center justify-center',
            'h-5 px-base gap-half',
            'bg-panel rounded-sm',
            'text-sm text-low font-medium',
            'whitespace-nowrap',
            'transition-colors',
            !disabled &&
              'hover:bg-error/20 hover:text-error hover:line-through cursor-pointer',
            disabled && 'cursor-default'
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: `hsl(${tag.color})` }}
          />
          {tag.name}
        </button>
      ))}

      {/* Linked PRs */}
      {linkedPrs.map((pr) => (
        <PrBadge
          key={pr.id}
          number={pr.number}
          url={pr.url}
          status={pr.status}
        />
      ))}

      {/* Link PR button */}
      {onLinkPr && (
        <button
          type="button"
          onClick={onLinkPr}
          disabled={disabled}
          className="flex items-center justify-center h-5 w-5 rounded-sm text-low hover:text-normal hover:bg-panel transition-colors disabled:opacity-50"
          aria-label="Link pull request"
        >
          <GitPullRequest className="size-icon-xs" weight="bold" />
        </button>
      )}

      {/* Linked Issues */}
      {linkedTasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="inline-flex items-center gap-half h-5 px-base bg-panel rounded-sm text-sm text-low hover:text-normal transition-colors"
          title={task.title}
        >
          <HashIcon className="size-icon-xs" weight="bold" />
          <span>{task.displayId}</span>
        </button>
      ))}

      {/* Add Tag Dropdown */}
      {onCreateTag &&
        (renderAddTagControl?.({
          tags: availableTags,
          selectedTagIds,
          onTagToggle: handleTagToggle,
          onCreateTag: handleCreateTag,
          disabled: disabled ?? false,
          trigger: addTagTrigger,
        }) ??
          addTagTrigger)}
    </div>
  );
}
