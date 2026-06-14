import { create, useModal } from '@ebay/nice-modal-react';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Button } from '@vibe/ui/components/Button';
import { CreateModeProvider } from '@/features/create-mode/model/CreateModeProvider';
import { useCreateMode } from '@/features/create-mode/model/useCreateMode';
import { CreateModeRepoPickerBar } from '@/shared/components/CreateModeRepoPickerBar';
import { defineModal } from '@/shared/lib/modals';
import type { CreateModeInitialState } from '@/shared/types/createMode';
import type { DraftWorkspaceRepo } from 'shared/types';

export interface WorkflowRepositoryDialogProps {
  initialState: CreateModeInitialState;
  draftId: string;
}

export type WorkflowRepositoryDialogResult =
  | { kind: 'confirmed'; repos: DraftWorkspaceRepo[] }
  | { kind: 'canceled' };

function WorkflowRepositoryDialogContent() {
  const modal = useModal();
  const { t } = useTranslation('common');
  const {
    repos,
    targetBranches,
    clearDraft,
    hasInitialValue,
    hasResolvedInitialRepoDefaults,
  } = useCreateMode();
  const [error, setError] = useState<string | null>(null);

  const handleCancel = () => {
    modal.resolve({
      kind: 'canceled',
    } satisfies WorkflowRepositoryDialogResult);
    modal.hide();
    void clearDraft();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleCancel();
    }
  };

  const handleCreateCanvas = () => {
    const selectedRepos = repos.map((repo) => ({
      repo_id: repo.id,
      target_branch: targetBranches[repo.id] ?? '',
    }));
    const hasMissingBranch = selectedRepos.some(
      (repo) => !repo.target_branch.trim()
    );

    if (selectedRepos.length === 0) {
      setError(t('workflow.repositoryDialog.errors.repositoryRequired'));
      return;
    }

    if (hasMissingBranch) {
      setError(t('workflow.repositoryDialog.errors.branchRequired'));
      return;
    }

    modal.resolve({
      kind: 'confirmed',
      repos: selectedRepos,
    } satisfies WorkflowRepositoryDialogResult);
    modal.hide();
    void clearDraft();
  };

  const isLoading = !hasInitialValue || !hasResolvedInitialRepoDefaults;

  return (
    <Dialog
      open={modal.visible}
      onOpenChange={handleOpenChange}
      // The shared Dialog panel caps at max-w-xl (576px); this dialog needs to
      // fit the repo picker (w-chat = 768px). cn() here is plain clsx (twMerge
      // is intentionally disabled), so a className override can't reliably beat
      // max-w-xl — set the width via inline style instead.
      style={{ maxWidth: 'min(720px, calc(100vw - 32px))' }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workflow.repositoryDialog.title')}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-low">
            <Loader2 className="mr-half size-icon-sm animate-spin" />
            <span>{t('states.loading')}</span>
          </div>
        ) : (
          <div className="py-base">
            <h2 className="mb-base text-center text-2xl font-medium tracking-tight text-high">
              {t('createMode.headings.repoStep')}
            </h2>
            <CreateModeRepoPickerBar
              continueLabel={t('buttons.create')}
              onContinueToPrompt={handleCreateCanvas}
            />
            {error ? (
              <p
                className="mt-base text-center text-xs text-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex justify-end border-t border-border/60 pt-base">
          <Button variant="ghost" onClick={handleCancel}>
            {t('buttons.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const WorkflowRepositoryDialogImpl = create<WorkflowRepositoryDialogProps>(
  ({ initialState, draftId }) => (
    <CreateModeProvider initialState={initialState} draftId={draftId}>
      <WorkflowRepositoryDialogContent />
    </CreateModeProvider>
  )
);

export const WorkflowRepositoryDialog = defineModal<
  WorkflowRepositoryDialogProps,
  WorkflowRepositoryDialogResult
>(WorkflowRepositoryDialogImpl);
