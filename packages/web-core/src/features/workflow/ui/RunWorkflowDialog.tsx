import { create, useModal } from '@ebay/nice-modal-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { useWorkflowTemplates } from '@/shared/hooks/useWorkflowTemplates';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import {
  buildWorkflowRunInput,
  getWorkflowRunErrorMessage,
} from '../model/issueWorkflow';

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
  workspaces?: WorkflowWorkspaceOption[];
}

export type RunWorkflowDialogResult =
  | { kind: 'started'; runId: string }
  | { kind: 'canceled' };

const RunWorkflowDialogImpl = create<RunWorkflowDialogProps>(
  ({ projectId, issueId, issueTitle, issueDescription, workspaces = [] }) => {
    const modal = useModal();
    const navigation = useAppNavigation();
    const { data: templateData, isLoading: templatesLoading } =
      useWorkflowTemplates(projectId);
    const { triggerRun, isTriggering } = useWorkflowRunMutations();

    const templates = templateData?.workflows ?? [];
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
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

    useEffect(() => {
      if (!selectedTemplateId && templates.length > 0) {
        setSelectedTemplateId(templates[0].id);
      }
    }, [selectedTemplateId, templates]);

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
      if (!selectedTemplateId) {
        setError('Select a workflow template before starting the run.');
        return;
      }
      if (!trimmedInput) {
        setError('Add run input before starting the workflow.');
        return;
      }

      setError(null);
      const workspaceId =
        selectedWorkspaceValue === CREATE_WORKFLOW_WORKSPACE_VALUE
          ? null
          : selectedWorkspaceValue;

      try {
        const run = await triggerRun({
          workflowId: selectedTemplateId,
          payload: {
            issue_id: issueId,
            workspace_id: workspaceId,
            trigger_source: 'manual',
            input_text: trimmedInput,
          },
        });
        modal.resolve({
          kind: 'started',
          runId: run.id,
        } satisfies RunWorkflowDialogResult);
        modal.hide();
        navigation.goToProjectWorkflowRun(projectId, run.id);
      } catch (err) {
        setError(getWorkflowRunErrorMessage(err));
      }
    };

    const canSubmit =
      !isTriggering &&
      !templatesLoading &&
      !!selectedTemplateId &&
      inputText.trim().length > 0;

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Run existing workflow</DialogTitle>
            <DialogDescription>
              Select a saved canvas and start a run for this issue.
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-base" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-half">
              <label
                htmlFor="workflow-template"
                className="text-xs font-medium text-low"
              >
                Template
              </label>
              <select
                id="workflow-template"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={templatesLoading || isTriggering}
                className="h-10 w-full rounded border bg-secondary px-2 text-sm text-normal"
              >
                {templatesLoading ? (
                  <option value="">Loading templates...</option>
                ) : templates.length === 0 ? (
                  <option value="">No templates available</option>
                ) : (
                  templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name || 'Untitled workflow'} - {template.source}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex flex-col gap-half">
              <label
                htmlFor="workflow-workspace"
                className="text-xs font-medium text-low"
              >
                Main workspace
              </label>
              <select
                id="workflow-workspace"
                value={selectedWorkspaceValue}
                onChange={(event) =>
                  setSelectedWorkspaceValue(event.target.value)
                }
                disabled={isTriggering}
                className="h-10 w-full rounded border bg-secondary px-2 text-sm text-normal"
              >
                <option value={CREATE_WORKFLOW_WORKSPACE_VALUE}>
                  Create workflow workspace
                </option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-low">
                {selectedWorkspace
                  ? `Uses existing workspace${
                      selectedWorkspace.branch
                        ? ` on ${selectedWorkspace.branch}`
                        : ''
                    }.`
                  : 'The backend will create a dedicated workflow workspace for this run.'}
              </p>
            </div>

            <div className="flex flex-col gap-half">
              <label
                htmlFor="workflow-input"
                className="text-xs font-medium text-low"
              >
                Run input
              </label>
              <Textarea
                id="workflow-input"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                rows={7}
                disabled={isTriggering}
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
                disabled={isTriggering}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isTriggering ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Start run
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
