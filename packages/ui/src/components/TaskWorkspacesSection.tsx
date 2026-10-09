import { useTranslation } from 'react-i18next';
import {
  TaskWorkspaceCard,
  TaskWorkspaceCreateCard,
  type WorkspaceWithStats,
} from './TaskWorkspaceCard';
import {
  CollapsibleSectionHeader,
  type SectionAction,
} from './CollapsibleSectionHeader';

export interface TaskWorkspacesSectionProps {
  workspaces: WorkspaceWithStats[];
  isLoading?: boolean;
  actions?: SectionAction[];
  onWorkspaceClick?: (localWorkspaceId: string | null) => void;
  onCreateWorkspace?: () => void;
  onUnlinkWorkspace?: (localWorkspaceId: string) => void;
  onDeleteWorkspace?: (localWorkspaceId: string) => void;
  shouldAnimateCreateButton?: boolean;
}

/**
 * View component for the workspaces section in the issue panel.
 * Displays a collapsible list of workspace cards.
 */
export function TaskWorkspacesSection({
  workspaces,
  isLoading,
  actions = [],
  onWorkspaceClick,
  onCreateWorkspace,
  onUnlinkWorkspace,
  onDeleteWorkspace,
  shouldAnimateCreateButton = false,
}: TaskWorkspacesSectionProps) {
  const { t } = useTranslation('common');

  return (
    <CollapsibleSectionHeader
      title={t('workspaces.title')}
      persistKey="kanban-task-workspaces"
      defaultExpanded={true}
      actions={actions}
    >
      <div className="px-base p-base flex flex-col gap-base border-t">
        {isLoading ? (
          <p className="text-low py-half">{t('workspaces.loading')}</p>
        ) : workspaces.length === 0 ? (
          <TaskWorkspaceCreateCard
            onClick={onCreateWorkspace}
            shouldAnimateCreateButton={shouldAnimateCreateButton}
          />
        ) : (
          workspaces.map((workspace) => {
            const { localWorkspaceId } = workspace;
            return (
              <TaskWorkspaceCard
                key={workspace.id}
                workspace={workspace}
                onClick={
                  onWorkspaceClick &&
                  localWorkspaceId &&
                  workspace.isOwnedByCurrentUser
                    ? () => onWorkspaceClick(localWorkspaceId)
                    : undefined
                }
                onUnlink={
                  onUnlinkWorkspace && localWorkspaceId
                    ? () => onUnlinkWorkspace(localWorkspaceId)
                    : undefined
                }
                onDelete={
                  onDeleteWorkspace &&
                  localWorkspaceId &&
                  workspace.isOwnedByCurrentUser
                    ? () => onDeleteWorkspace(localWorkspaceId)
                    : undefined
                }
              />
            );
          })
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
