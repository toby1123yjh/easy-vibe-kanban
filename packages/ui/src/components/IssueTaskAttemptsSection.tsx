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
  const hasCreateActions =
    !!onCreateWorkflowAttempt || !!onCreateSingleAgentAttempt;

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
        ) : (
          <>
            {hasCreateActions && (
              <div className="grid gap-half sm:grid-cols-2">
                {onCreateWorkflowAttempt && (
                  <button
                    type="button"
                    onClick={onCreateWorkflowAttempt}
                    className="rounded-sm border border-brand/50 bg-brand/10 px-base py-half text-left text-xs font-medium text-high transition-colors hover:bg-brand/15 focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    {t('attempts.newWorkflow', 'New workflow attempt')}
                  </button>
                )}
                {onCreateSingleAgentAttempt && (
                  <button
                    type="button"
                    onClick={onCreateSingleAgentAttempt}
                    className="rounded-sm border border-secondary bg-primary px-base py-half text-left text-xs text-low transition-colors hover:border-border hover:text-high focus:outline-none focus:ring-1 focus:ring-border"
                  >
                    {t('attempts.newSingleAgent', 'New single-agent attempt')}
                  </button>
                )}
              </div>
            )}
            {attempts.length === 0 ? (
              <p className="py-half text-xs text-low">
                {t('attempts.empty', 'No task attempts yet.')}
              </p>
            ) : (
              attempts.map((attempt) => (
                <IssueTaskAttemptCard
                  key={attempt.id}
                  attempt={attempt}
                  onOpen={() => onOpenAttempt?.(attempt)}
                  onRun={
                    attempt.kind === 'workflow' && onRunAttempt
                      ? () => onRunAttempt(attempt)
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
          </>
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
