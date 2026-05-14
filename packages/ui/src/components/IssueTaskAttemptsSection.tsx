import { useTranslation } from 'react-i18next';
import {
  CollapsibleSectionHeader,
  type SectionAction,
} from './CollapsibleSectionHeader';
import {
  IssueTaskAttemptCard,
  type IssueTaskAttemptCardData,
} from './IssueTaskAttemptCard';

export interface IssueTaskAttemptsSectionProps {
  attempts: IssueTaskAttemptCardData[];
  isLoading?: boolean;
  actions?: SectionAction[];
  onOpenAttempt?: (attempt: IssueTaskAttemptCardData) => void;
  onRunAttempt?: (attempt: IssueTaskAttemptCardData) => void;
  onUnlinkAttempt?: (attempt: IssueTaskAttemptCardData) => void;
  onDeleteAttempt?: (attempt: IssueTaskAttemptCardData) => void;
  onCreateWorkflowAttempt?: () => void;
  onCreateSingleAgentAttempt?: () => void;
}

export function IssueTaskAttemptsSection({
  attempts,
  isLoading,
  actions = [],
  onOpenAttempt,
  onRunAttempt,
  onUnlinkAttempt,
  onDeleteAttempt,
  onCreateWorkflowAttempt,
  onCreateSingleAgentAttempt,
}: IssueTaskAttemptsSectionProps) {
  const { t } = useTranslation('common');

  return (
    <CollapsibleSectionHeader
      title={t('attempts.title', 'Task Attempts')}
      persistKey="kanban-issue-task-attempts"
      defaultExpanded={true}
      actions={actions}
    >
      <div className="flex flex-col gap-base border-t p-base px-base">
        {isLoading ? (
          <p className="py-half text-low">
            {t('attempts.loading', 'Loading attempts...')}
          </p>
        ) : attempts.length === 0 ? (
          <div className="grid gap-half">
            <button
              type="button"
              onClick={onCreateWorkflowAttempt}
              className="rounded-sm border border-dashed border-border bg-panel p-base text-left text-sm text-low transition-colors hover:bg-secondary/70"
            >
              {t(
                'attempts.empty',
                'Create a task attempt to solve this issue.'
              )}
            </button>
            {onCreateSingleAgentAttempt && (
              <button
                type="button"
                onClick={onCreateSingleAgentAttempt}
                className="rounded-sm border border-secondary bg-primary p-base text-left text-xs text-low transition-colors hover:text-high"
              >
                {t('attempts.newSingleAgent', 'New single-agent attempt')}
              </button>
            )}
          </div>
        ) : (
          attempts.map((attempt) => (
            <IssueTaskAttemptCard
              key={attempt.id}
              attempt={attempt}
              onOpen={() => onOpenAttempt?.(attempt)}
              onRun={
                attempt.kind === 'workflow'
                  ? () => onRunAttempt?.(attempt)
                  : undefined
              }
              onUnlink={
                attempt.kind === 'single_agent' && onUnlinkAttempt
                  ? () => onUnlinkAttempt(attempt)
                  : undefined
              }
              onDelete={
                attempt.kind === 'single_agent' && onDeleteAttempt
                  ? () => onDeleteAttempt(attempt)
                  : undefined
              }
            />
          ))
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
