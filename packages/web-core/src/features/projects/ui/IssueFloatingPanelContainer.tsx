import { useCallback, useMemo, useState } from 'react';
import type { TaskSummary, WorkflowTemplateResponse } from 'shared/types';
import type { Issue } from 'shared/remote-types';
import { CreateArenaDialog } from '@/features/arena';
import { useCreateIssueWorkflowAttempt } from '@/features/workflow';
import { shouldShowWorkflowTemplate } from '@/features/workflow/model/workflowTemplateVisibility';
import { WorkflowTemplatePickerDialog } from '@/features/workflow/ui/WorkflowTemplatePickerDialog';
import { IssueCommentsSectionContainer } from '@/pages/kanban/IssueCommentsSectionContainer';
import { IssueRelationshipsSectionContainer } from '@/pages/kanban/IssueRelationshipsSectionContainer';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useProjectWorkspaceCreateDraft } from '@/shared/hooks/useProjectWorkspaceCreateDraft';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useWorkflowTemplates } from '@/shared/hooks/useWorkflowTemplates';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { getWorkspaceDefaults } from '@/shared/lib/workspaceDefaults';
import {
  buildLinkedIssueCreateState,
  buildLocalWorkspaceIdSet,
  buildWorkspaceCreateInitialState,
  buildWorkspaceCreatePrompt,
} from '@/shared/lib/workspaceCreateState';
import { IssueFloatingPanel } from './IssueFloatingPanel';

interface IssueFloatingPanelContainerProps {
  issue: Issue;
  tasks: TaskSummary[];
  onClose(): void;
  onOpenTask(task: TaskSummary): void;
  getTaskUnavailableReason(task: TaskSummary): string | null;
  agentUnavailableReason: string | null;
  workflowUnavailableReason: string | null;
  arenaUnavailableReason: string | null;
}

export function IssueFloatingPanelContainer({
  issue,
  tasks,
  onClose,
  onOpenTask,
  getTaskUnavailableReason,
  agentUnavailableReason,
  workflowUnavailableReason,
  arenaUnavailableReason,
}: IssueFloatingPanelContainerProps) {
  const appNavigation = useAppNavigation();
  const routeState = useCurrentKanbanRouteState();
  const { workspaces } = useUserContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const { openWorkspaceCreateFromState } = useProjectWorkspaceCreateDraft();
  const {
    projectId,
    statuses,
    tags,
    issueTags,
    updateIssue,
    insertIssueTag,
    removeIssueTag,
  } = useProjectContext();
  const [busyAction, setBusyAction] = useState<
    'agent' | 'workflow' | 'arena' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const { data: workflowTemplateData } = useWorkflowTemplates(projectId, {
    enabled: !!projectId,
  });
  const { createWorkflowAttempt, workflowCreateError } =
    useCreateIssueWorkflowAttempt({
      issueId: issue.id,
      issueTitle: issue.title,
      issueDescription: issue.description,
    });

  const selectedTagIds = useMemo(
    () =>
      new Set(
        issueTags
          .filter((link) => link.issue_id === issue.id)
          .map((link) => link.tag_id)
      ),
    [issue.id, issueTags]
  );
  const workflowTemplates = useMemo(
    () =>
      (workflowTemplateData?.workflows ?? []).filter(
        shouldShowWorkflowTemplate
      ),
    [workflowTemplateData]
  );

  const createAgentExecution = useCallback(async () => {
    setBusyAction('agent');
    setError(null);
    try {
      const localWorkspaceIds = buildLocalWorkspaceIdSet(
        activeWorkspaces,
        archivedWorkspaces
      );
      const defaults = await getWorkspaceDefaults(
        workspaces,
        localWorkspaceIds,
        projectId,
        routeState.hostId
      );
      const createState = buildWorkspaceCreateInitialState({
        prompt: buildWorkspaceCreatePrompt(issue.title, issue.description),
        defaults,
        linkedIssue: buildLinkedIssueCreateState(issue, projectId),
      });
      const draftId = await openWorkspaceCreateFromState(createState, {
        issueId: issue.id,
      });
      if (!draftId) {
        throw new Error('Failed to prepare the agent workspace.');
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to prepare the agent workspace.'
      );
    } finally {
      setBusyAction(null);
    }
  }, [
    activeWorkspaces,
    archivedWorkspaces,
    issue,
    openWorkspaceCreateFromState,
    projectId,
    routeState.hostId,
    workspaces,
  ]);

  const createWorkflowExecution = useCallback(async () => {
    setBusyAction('workflow');
    setError(null);
    try {
      let template: WorkflowTemplateResponse | null =
        workflowTemplates[0] ?? null;
      if (workflowTemplates.length > 1) {
        const result = await WorkflowTemplatePickerDialog.show({
          templates: workflowTemplates.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            description: candidate.description,
          })),
        });
        if (result.kind === 'canceled') return;
        template =
          workflowTemplates.find(
            (candidate) => candidate.id === result.templateId
          ) ?? null;
      }
      await createWorkflowAttempt({ template });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to prepare the workflow.'
      );
    } finally {
      setBusyAction(null);
    }
  }, [createWorkflowAttempt, workflowTemplates]);

  const createArenaExecution = useCallback(async () => {
    setBusyAction('arena');
    setError(null);
    try {
      const result = await CreateArenaDialog.show({
        projectId,
        issueId: issue.id,
        hostId: routeState.hostId,
        initialPrompt:
          buildWorkspaceCreatePrompt(issue.title, issue.description) ??
          undefined,
      });
      if (result.kind === 'created') {
        appNavigation.goToProjectIssueArena?.(
          projectId,
          issue.id,
          result.groupId
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to start the Arena.'
      );
    } finally {
      setBusyAction(null);
    }
  }, [appNavigation, issue, projectId, routeState.hostId]);

  const toggleTag = useCallback(
    (tagId: string) => {
      setError(null);
      const existing = issueTags.find(
        (link) => link.issue_id === issue.id && link.tag_id === tagId
      );
      const mutation = existing
        ? removeIssueTag(existing.id)
        : insertIssueTag({ issue_id: issue.id, tag_id: tagId });
      void mutation.persisted.catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : 'Failed to update the tag.'
        );
      });
    },
    [insertIssueTag, issue.id, issueTags, removeIssueTag]
  );
  const updateDescription = useCallback(
    (description: string | null) => {
      setError(null);
      void updateIssue(issue.id, { description }).persisted.catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Failed to update the description.'
        );
      });
    },
    [issue.id, updateIssue]
  );
  const updateStatus = useCallback(
    (statusId: string) => {
      setError(null);
      void updateIssue(issue.id, { status_id: statusId }).persisted.catch(
        (cause) => {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Failed to update the status.'
          );
        }
      );
    },
    [issue.id, updateIssue]
  );

  return (
    <IssueFloatingPanel
      issue={issue}
      statuses={statuses.filter((status) => !status.hidden)}
      tags={tags}
      selectedTagIds={selectedTagIds}
      tasks={tasks}
      error={error ?? workflowCreateError}
      busyAction={busyAction}
      agentUnavailableReason={agentUnavailableReason}
      workflowUnavailableReason={workflowUnavailableReason}
      arenaUnavailableReason={arenaUnavailableReason}
      relationships={<IssueRelationshipsSectionContainer issueId={issue.id} />}
      comments={<IssueCommentsSectionContainer issueId={issue.id} />}
      onClose={onClose}
      onOpenTask={onOpenTask}
      getTaskUnavailableReason={getTaskUnavailableReason}
      onCreateAgent={() => void createAgentExecution()}
      onCreateWorkflow={() => void createWorkflowExecution()}
      onCreateArena={() => void createArenaExecution()}
      onUpdateDescription={updateDescription}
      onUpdateStatus={updateStatus}
      onToggleTag={toggleTag}
    />
  );
}
