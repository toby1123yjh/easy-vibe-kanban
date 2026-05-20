import { useCallback, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { buildIssueWorkflowDraft } from '../model/issueWorkflow';
import {
  createIssueWorkflowAttemptDraft,
  toIssueWorkflowAttemptDraftRouteId,
} from '../model/workflowAttemptDraftStorage';
import { useWorkflowRepositorySelection } from './useWorkflowRepositorySelection';
import { getWorkflowDefaultGraphLabels } from './workflowI18n';

interface UseCreateIssueWorkflowAttemptOptions {
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
}

export function useCreateIssueWorkflowAttempt({
  issueId,
  issueTitle,
  issueDescription,
}: UseCreateIssueWorkflowAttemptOptions) {
  const { t } = useTranslation('common');
  const { projectId } = useParams({ strict: false });
  const navigation = useAppNavigation();
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selectWorkflowRepositories } = useWorkflowRepositorySelection({
    projectId,
    issueId,
    issueTitle,
  });

  const createWorkflowAttempt = useCallback(async () => {
    if (!projectId || isPreparingDraft) {
      return null;
    }

    setIsPreparingDraft(true);
    setError(null);
    try {
      const repos = await selectWorkflowRepositories();
      if (!repos) {
        return null;
      }

      const workflowTitle =
        issueTitle.trim() || t('workflow.draft.untitledTask');
      const draftPayload = buildIssueWorkflowDraft({
        title: issueTitle,
        description: issueDescription,
        name: t('workflow.draft.name', { title: workflowTitle }),
        untitledTitle: t('workflow.draft.untitledTask'),
        defaultGraphLabels: getWorkflowDefaultGraphLabels(t),
        repos,
      });
      const draft = createIssueWorkflowAttemptDraft({
        projectId,
        issueId,
        issueTitle,
        issueDescription,
        name:
          draftPayload.name ??
          t('workflow.draft.name', { title: workflowTitle }),
        graphJson: draftPayload.graph_json,
        repos,
      });
      navigation.goToProjectWorkflowEdit(
        projectId,
        toIssueWorkflowAttemptDraftRouteId(draft.id)
      );
      return draft;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('workflow.errors.createDraftFailed')
      );
      return null;
    } finally {
      setIsPreparingDraft(false);
    }
  }, [
    projectId,
    isPreparingDraft,
    issueId,
    issueTitle,
    issueDescription,
    selectWorkflowRepositories,
    navigation,
    t,
  ]);

  return {
    createWorkflowAttempt,
    isCreatingWorkflowAttempt: isPreparingDraft,
    workflowCreateError: error,
  };
}
