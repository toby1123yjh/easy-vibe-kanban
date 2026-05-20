import { create, useModal } from '@ebay/nice-modal-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { Textarea } from '@vibe/ui/components/Textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { defineModal } from '@/shared/lib/modals';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowAttemptMutations } from '@/shared/hooks/useWorkflowAttempts';
import {
  buildWorkflowRunInput,
  getWorkflowRunErrorMessage,
} from '../model/issueWorkflow';
import { useWorkflowRepositorySelection } from './useWorkflowRepositorySelection';
import type { DraftWorkspaceRepo } from 'shared/types';

const CREATE_WORKFLOW_WORKSPACE_VALUE = '__create_workflow_workspace__';

export interface WorkflowWorkspaceOption {
  id: string;
  label: string;
  branch?: string | null;
}

export interface RunWorkflowDialogProps {
  projectId: string;
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
  attemptId: string;
  attemptName: string;
  workspaces?: WorkflowWorkspaceOption[];
}

export type RunWorkflowDialogResult =
  | { kind: 'started'; runId: string }
  | { kind: 'canceled' };

const RunWorkflowDialogImpl = create<RunWorkflowDialogProps>(
  ({
    projectId,
    issueId,
    issueTitle,
    issueDescription,
    attemptId,
    attemptName,
    workspaces = [],
  }) => {
    const { t } = useTranslation('common');
    const modal = useModal();
    const navigation = useAppNavigation();
    const { runAttempt, isRunningAttempt } = useWorkflowAttemptMutations();
    const { selectWorkflowRepositories } = useWorkflowRepositorySelection({
      projectId,
      issueId,
      issueTitle,
    });

    const [selectedWorkspaceValue, setSelectedWorkspaceValue] = useState(
      CREATE_WORKFLOW_WORKSPACE_VALUE
    );
    const [inputText, setInputText] = useState(() =>
      buildWorkflowRunInput({
        title: issueTitle,
        description: issueDescription,
      })
    );
    const [error, setError] = useState<string | null>(null);
    const [isPreparingRun, setIsPreparingRun] = useState(false);

    const selectedWorkspace = useMemo(
      () =>
        workspaces.find((workspace) => workspace.id === selectedWorkspaceValue),
      [selectedWorkspaceValue, workspaces]
    );

    const handleCancel = () => {
      modal.resolve({ kind: 'canceled' } satisfies RunWorkflowDialogResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        handleCancel();
      }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedInput = inputText.trim();
      if (!trimmedInput) {
        setError(t('workflow.errors.runInputRequired'));
        return;
      }

      setError(null);
      const workspaceId =
        selectedWorkspaceValue === CREATE_WORKFLOW_WORKSPACE_VALUE
          ? null
          : selectedWorkspaceValue;

      setIsPreparingRun(true);
      try {
        let repos: DraftWorkspaceRepo[] = [];
        if (workspaceId === null) {
          const selectedRepos = await selectWorkflowRepositories();
          if (!selectedRepos) {
            return;
          }
          repos = selectedRepos;
        }

        const run = await runAttempt({
          attemptId,
          payload: {
            workspace_id: workspaceId,
            trigger_source: 'manual',
            input_text: trimmedInput,
            repos,
          },
        });
        modal.resolve({
          kind: 'started',
          runId: run.id,
        } satisfies RunWorkflowDialogResult);
        modal.hide();
        navigation.goToProjectWorkflowRun(projectId, run.id);
      } catch (err) {
        setError(
          getWorkflowRunErrorMessage(err, {
            repositoryMessage: t('workflow.errors.repositoryRequired'),
            fallbackMessage: t('workflow.errors.startFailed'),
          })
        );
      } finally {
        setIsPreparingRun(false);
      }
    };

    const canSubmit =
      !isRunningAttempt &&
      !isPreparingRun &&
      inputText.trim().length > 0 &&
      attemptId.length > 0;

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t('workflow.runDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('workflow.runDialog.description')}
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-base" onSubmit={handleSubmit}>
            <div className="rounded-sm border border-secondary bg-panel p-base text-sm text-normal">
              {attemptName || t('workflow.entry.title')}
            </div>

            <div className="flex flex-col gap-half">
              <label
                htmlFor="workflow-workspace"
                className="text-xs font-medium text-low"
              >
                {t('workflow.runDialog.mainWorkspace')}
              </label>
              <select
                id="workflow-workspace"
                value={selectedWorkspaceValue}
                onChange={(event) =>
                  setSelectedWorkspaceValue(event.target.value)
                }
                disabled={isRunningAttempt || isPreparingRun}
                className="h-10 w-full rounded border bg-secondary px-2 text-sm text-normal"
              >
                <option value={CREATE_WORKFLOW_WORKSPACE_VALUE}>
                  {t('workflow.runDialog.createWorkflowWorkspace')}
                </option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-low">
                {selectedWorkspace
                  ? selectedWorkspace.branch
                    ? t('workflow.runDialog.usesExistingWorkspaceWithBranch', {
                        branch: selectedWorkspace.branch,
                      })
                    : t('workflow.runDialog.usesExistingWorkspace')
                  : t('workflow.runDialog.createWorkspaceHint')}
              </p>
            </div>

            <div className="flex flex-col gap-half">
              <label
                htmlFor="workflow-input"
                className="text-xs font-medium text-low"
              >
                {t('workflow.runDialog.runInput')}
              </label>
              <Textarea
                id="workflow-input"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                rows={7}
                disabled={isRunningAttempt || isPreparingRun}
                className="font-ibm-plex-mono"
              />
            </div>

            {error ? (
              <p className="text-xs text-error" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isRunningAttempt || isPreparingRun}
              >
                {t('buttons.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isRunningAttempt || isPreparingRun ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {t('workflow.runDialog.startRun')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
);

export const RunWorkflowDialog = defineModal<
  RunWorkflowDialogProps,
  RunWorkflowDialogResult
>(RunWorkflowDialogImpl);
