import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import type { PriorityLevel } from './PriorityIcon';
import { InputField } from './InputField';
import { PrimaryButton } from './PrimaryButton';
import { ButtonGroup, ButtonGroupItem } from './IconButtonGroup';

export interface KanbanFilterTag {
  id: string;
  name: string;
  color: string;
}

export interface KanbanFilterUser {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
}

export interface KanbanFilterState<TSortField extends string = string> {
  searchQuery: string;
  priorities: PriorityLevel[];
  assigneeIds: string[];
  tagIds: string[];
  sortField: TSortField;
  sortDirection: 'asc' | 'desc';
}

export interface KanbanProjectViewIds {
  TEAM: string;
  PERSONAL: string;
}

const DEFAULT_KANBAN_PROJECT_VIEW_IDS: KanbanProjectViewIds = {
  TEAM: 'team',
  PERSONAL: 'personal',
};

export interface RenderKanbanFiltersDialogProps<
  TTag extends KanbanFilterTag = KanbanFilterTag,
  TUser extends KanbanFilterUser = KanbanFilterUser,
  TSortField extends string = string,
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: TTag[];
  users: TUser[];
  projectId: string;
  currentUserId: string | null;
  filters: KanbanFilterState<TSortField>;
  showSubIssues: boolean;
  showWorkspaces: boolean;
  onPrioritiesChange: (priorities: PriorityLevel[]) => void;
  onAssigneesChange: (assigneeIds: string[]) => void;
  onTagsChange: (tagIds: string[]) => void;
  onSortChange: (sortField: TSortField, sortDirection: 'asc' | 'desc') => void;
  onShowSubIssuesChange: (show: boolean) => void;
  onShowWorkspacesChange: (show: boolean) => void;
  hideBlocked: boolean;
  onHideBlockedChange: (hide: boolean) => void;
}

interface KanbanFilterBarProps<
  TTag extends KanbanFilterTag = KanbanFilterTag,
  TUser extends KanbanFilterUser = KanbanFilterUser,
  TSortField extends string = string,
> {
  isFiltersDialogOpen: boolean;
  onFiltersDialogOpenChange: (open: boolean) => void;
  tags: TTag[];
  users: TUser[];
  activeViewId: string;
  onViewChange: (viewId: string) => void;
  viewIds?: KanbanProjectViewIds;
  projectId: string;
  currentUserId: string | null;
  filters: KanbanFilterState<TSortField>;
  showSubIssues: boolean;
  showWorkspaces: boolean;
  hasActiveFilters: boolean;
  onSearchQueryChange: (searchQuery: string) => void;
  onPrioritiesChange: (priorities: PriorityLevel[]) => void;
  onAssigneesChange: (assigneeIds: string[]) => void;
  onTagsChange: (tagIds: string[]) => void;
  onSortChange: (sortField: TSortField, sortDirection: 'asc' | 'desc') => void;
  onShowSubIssuesChange: (show: boolean) => void;
  onShowWorkspacesChange: (show: boolean) => void;
  hideBlocked: boolean;
  onHideBlockedChange: (hide: boolean) => void;
  onClearFilters: () => void;
  onCreateIssue: () => void;
  shouldAnimateCreateButton: boolean;
  isMobile?: boolean;
  className?: string;
  renderFiltersDialog?: (
    props: RenderKanbanFiltersDialogProps<TTag, TUser, TSortField>
  ) => ReactNode;
}

export function KanbanFilterBar<
  TTag extends KanbanFilterTag = KanbanFilterTag,
  TUser extends KanbanFilterUser = KanbanFilterUser,
  TSortField extends string = string,
>({
  isFiltersDialogOpen,
  onFiltersDialogOpenChange,
  tags,
  users,
  activeViewId,
  onViewChange,
  viewIds = DEFAULT_KANBAN_PROJECT_VIEW_IDS,
  projectId,
  currentUserId,
  filters,
  showSubIssues,
  showWorkspaces,
  hasActiveFilters,
  onSearchQueryChange,
  onPrioritiesChange,
  onAssigneesChange,
  onTagsChange,
  onSortChange,
  onShowSubIssuesChange,
  onShowWorkspacesChange,
  hideBlocked,
  onHideBlockedChange,
  onClearFilters,
  onCreateIssue,
  shouldAnimateCreateButton,
  isMobile,
  className,
  renderFiltersDialog,
}: KanbanFilterBarProps<TTag, TUser, TSortField>) {
  const { t } = useTranslation('common');
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false);

  const handleClearSearch = () => {
    onSearchQueryChange('');
  };

  return (
    <>
      {isMobile && mobileSearchExpanded ? (
        <div className="flex items-center gap-half">
          <button
            type="button"
            onClick={() => {
              onSearchQueryChange('');
              setMobileSearchExpanded(false);
            }}
            className="p-half rounded-sm text-low hover:text-normal hover:bg-secondary transition-colors shrink-0"
            aria-label={t('kanban.closeSearch', 'Close search')}
          >
            <ArrowLeftIcon className="size-icon-sm" weight="bold" />
          </button>
          <InputField
            value={filters.searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t('kanban.searchPlaceholder', 'Search issues...')}
            variant="search"
            className="min-w-0 flex-1"
          />
        </div>
      ) : (
        <div
          className={cn(
            'flex min-w-0 items-center',
            isMobile ? 'flex-wrap gap-half' : 'w-full flex-nowrap gap-base',
            className
          )}
        >
          <div
            className={cn(
              isMobile
                ? 'contents'
                : 'scrollbar-none flex min-w-0 flex-1 flex-nowrap items-center gap-base overflow-x-auto overflow-y-hidden'
            )}
          >
            <ButtonGroup className={isMobile ? 'flex-wrap' : 'shrink-0'}>
              <ButtonGroupItem
                active={activeViewId === viewIds.TEAM}
                onClick={() => onViewChange(viewIds.TEAM)}
                className={!isMobile ? 'shrink-0 whitespace-nowrap' : undefined}
              >
                {t('kanban.team', 'Team')}
              </ButtonGroupItem>
              <ButtonGroupItem
                active={activeViewId === viewIds.PERSONAL}
                onClick={() => onViewChange(viewIds.PERSONAL)}
                className={!isMobile ? 'shrink-0 whitespace-nowrap' : undefined}
              >
                {t('kanban.personal', 'Personal')}
              </ButtonGroupItem>
            </ButtonGroup>

            {isMobile ? (
              <button
                type="button"
                onClick={() => setMobileSearchExpanded(true)}
                className={cn(
                  'p-half rounded-sm transition-colors',
                  filters.searchQuery
                    ? 'text-brand hover:text-brand'
                    : 'text-low hover:text-normal hover:bg-secondary'
                )}
                aria-label={t('kanban.searchPlaceholder', 'Search issues...')}
              >
                <MagnifyingGlassIcon className="size-icon-sm" weight="bold" />
              </button>
            ) : (
              <InputField
                value={filters.searchQuery}
                onChange={onSearchQueryChange}
                placeholder={t('kanban.searchPlaceholder', 'Search issues...')}
                variant="search"
                actionIcon={filters.searchQuery ? XIcon : undefined}
                onAction={handleClearSearch}
                className="min-w-[160px] w-[220px] max-w-full shrink"
              />
            )}

            <button
              type="button"
              onClick={() => onFiltersDialogOpenChange(true)}
              className={cn(
                'flex items-center justify-center p-half rounded-sm transition-colors',
                !isMobile && 'shrink-0',
                hasActiveFilters
                  ? 'text-brand hover:text-brand'
                  : 'text-low hover:text-normal hover:bg-secondary'
              )}
              aria-label={t('kanban.filters', 'Open filters')}
              title={t('kanban.filters', 'Open filters')}
            >
              <FunnelIcon className="size-icon-sm" weight="bold" />
            </button>

            {hasActiveFilters && (
              <PrimaryButton
                variant="tertiary"
                value={t('kanban.clearFilters', 'Clear filters')}
                actionIcon={XIcon}
                onClick={onClearFilters}
                className="shrink-0 whitespace-nowrap"
              />
            )}
          </div>

          {isMobile ? (
            <button
              type="button"
              onClick={() => onCreateIssue()}
              className={cn(
                'shrink-0 rounded-sm p-half bg-brand hover:bg-brand-hover text-on-brand transition-colors',
                shouldAnimateCreateButton && 'create-issue-attention'
              )}
              aria-label={t('kanban.newIssue', 'New issue')}
            >
              <PlusIcon className="size-icon-sm" weight="bold" />
            </button>
          ) : (
            <PrimaryButton
              variant="secondary"
              value={t('kanban.newIssue', 'New issue')}
              actionIcon={PlusIcon}
              onClick={() => onCreateIssue()}
              className={cn(
                'shrink-0 whitespace-nowrap',
                shouldAnimateCreateButton && 'create-issue-attention'
              )}
            />
          )}
        </div>
      )}

      {renderFiltersDialog?.({
        open: isFiltersDialogOpen,
        onOpenChange: onFiltersDialogOpenChange,
        projectId,
        currentUserId,
        tags,
        users,
        filters,
        showSubIssues,
        showWorkspaces,
        onPrioritiesChange,
        onAssigneesChange,
        onTagsChange,
        onSortChange,
        onShowSubIssuesChange,
        onShowWorkspacesChange,
        hideBlocked,
        onHideBlockedChange,
      })}
    </>
  );
}
