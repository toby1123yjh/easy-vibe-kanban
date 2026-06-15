import { useCallback, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { WorkflowTemplateResponse } from 'shared/types';
import { GitBranchIcon, LinkIcon, PlusIcon } from '@phosphor-icons/react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useOrgContext } from '@/shared/hooks/useOrgContext';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useProjectWorkspaceCreateDraft } from '@/shared/hooks/useProjectWorkspaceCreateDraft';
import { workspacesApi } from '@/shared/lib/api';
import { getWorkspaceDefaults } from '@/shared/lib/workspaceDefaults';
import {
  buildLinkedIssueCreateState,
  buildLocalWorkspaceIdSet,
  buildWorkspaceCreateInitialState,
  buildWorkspaceCreatePrompt,
} from '@/shared/lib/workspaceCreateState';
import {
  useWorkflowAttemptMutations,
  useWorkflowAttempts,
} from '@/shared/hooks/useWorkflowAttempts';
import { useWorkflowTemplates } from '@/shared/hooks/useWorkflowTemplates';
import {
  buildTaskAttempts,
  type TaskAttemptView,
  useCreateIssueWorkflowAttempt,
} from '@/features/workflow';
import { shouldShowWorkflowTemplate } from '@/features/workflow/model/workflowTemplateVisibility';
import { WorkflowTemplatePickerDialog } from '@/features/workflow/ui/WorkflowTemplatePickerDialog';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { DeleteWorkspaceDialog } from '@vibe/ui/components/DeleteWorkspaceDialog';
import type { IssueTaskAttemptCardData } from '@vibe/ui/components/IssueTaskAttemptCard';
import { IssueTaskAttemptsSection } from '@vibe/ui/components/IssueTaskAttemptsSection';
import type { SectionAction } from '@vibe/ui/components/CollapsibleSectionHeader';
import type { WorkspaceWithStats } from '@vibe/ui/components/IssueWorkspaceCard';

interface IssueTaskAttemptsSectionContainerProps {
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
}

export function IssueTaskAttemptsSectionContainer({
  issueId,
  issueTitle,
  issueDescription,
}: IssueTaskAttemptsSectionContainerProps) {
  const { t } = useTranslation('common');
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const { openWorkspaceCreateFromState } = useProjectWorkspaceCreateDraft();
  const { userId } = useAuth();
  const { workspaces } = useUserContext();
  const [error, setError] = useState<string | null>(null);

  const {
    pullRequests,
    getIssue,
    getWorkspacesForIssue,
    isLoading: projectLoading,
  } = useProjectContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const { membersWithProfilesById, isLoading: orgLoading } = useOrgContext();
  const { data: workflowAttemptData, isLoading: workflowAttemptsLoading } =
    useWorkflowAttempts(projectId, issueId, { enabled: !!projectId });
  const { data: workflowTemplateData } = useWorkflowTemplates(projectId, {
    enabled: !!projectId,
  });
  const { deleteAttempt: deleteWorkflowAttempt } =
    useWorkflowAttemptMutations();
  const { createWorkflowAttempt, workflowCreateError } =
    useCreateIssueWorkflowAttempt({
      issueId,
      issueTitle,
      issueDescription,
    });

  const localWorkspacesById = useMemo(() => {
    const map = new Map<string, (typeof activeWorkspaces)[number]>();

    for (const workspace of activeWorkspaces) {
      map.set(workspace.id, workspace);
    }

    for (const workspace of archivedWorkspaces) {
      map.set(workspace.id, workspace);
    }

    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  const workspacesWithStats: WorkspaceWithStats[] = useMemo(() => {
    const rawWorkspaces = getWorkspacesForIssue(issueId);

    return rawWorkspaces.map((workspace) => {
      const localWorkspace = workspace.local_workspace_id
        ? localWorkspacesById.get(workspace.local_workspace_id)
        : undefined;
      const linkedPrs = pullRequests
        .filter((pr) => pr.workspace_id === workspace.id)
        .map((pr) => ({
          number: pr.number,
          url: pr.url,
          status: pr.status as 'open' | 'merged' | 'closed',
        }));
      const owner =
        membersWithProfilesById.get(workspace.owner_user_id) ?? null;

      return {
        id: workspace.id,
        localWorkspaceId: workspace.local_workspace_id,
        name: workspace.name,
        archived: workspace.archived,
        filesChanged: workspace.files_changed ?? 0,
        linesAdded: workspace.lines_added ?? 0,
        linesRemoved: workspace.lines_removed ?? 0,
        prs: linkedPrs,
        owner,
        updatedAt: workspace.updated_at,
        isOwnedByCurrentUser: workspace.owner_user_id === userId,
        isRunning: localWorkspace?.isRunning,
        hasPendingApproval: localWorkspace?.hasPendingApproval,
        hasRunningDevServer: localWorkspace?.hasRunningDevServer,
        hasUnseenActivity: localWorkspace?.hasUnseenActivity,
        latestProcessCompletedAt: localWorkspace?.latestProcessCompletedAt,
        latestProcessStatus: localWorkspace?.latestProcessStatus,
      };
    });
  }, [
    issueId,
    getWorkspacesForIssue,
    pullRequests,
    membersWithProfilesById,
    userId,
    localWorkspacesById,
  ]);

  const attempts = useMemo(
    () =>
      buildTaskAttempts({
        workspaceAttempts: workspacesWithStats,
        workflowAttempts: workflowAttemptData?.attempts ?? [],
      }).map((attempt) => localizeTaskAttemptView(attempt, t)),
    [workspacesWithStats, workflowAttemptData, t]
  );
  const workflowTemplates = useMemo(
    () =>
      (workflowTemplateData?.workflows ?? []).filter(
        shouldShowWorkflowTemplate
      ),
    [workflowTemplateData]
  );

  const handleAddWorkspace = useCallback(async () => {
    if (!projectId) {
      return;
    }

    const issue = getIssue(issueId);
    const initialPrompt = buildWorkspaceCreatePrompt(
      issue?.title ?? null,
      issue?.description ?? null
    );
    const localWorkspaceIds = buildLocalWorkspaceIdSet(
      activeWorkspaces,
      archivedWorkspaces
    );
    const defaults = await getWorkspaceDefaults(
      workspaces,
      localWorkspaceIds,
      projectId
    );
    const createState = buildWorkspaceCreateInitialState({
      prompt: initialPrompt,
      defaults,
      linkedIssue: buildLinkedIssueCreateState(issue, projectId),
    });

    const draftId = await openWorkspaceCreateFromState(createState, {
      issueId,
    });
    if (!draftId) {
      await ConfirmDialog.show({
        title: t('common:error'),
        message: t(
          'workspaces.createDraftError',
          'Failed to prepare workspace draft. Please try again.'
        ),
        confirmText: t('common:ok'),
        showCancelButton: false,
      });
    }
  }, [
    projectId,
    getIssue,
    issueId,
    activeWorkspaces,
    archivedWorkspaces,
    workspaces,
    openWorkspaceCreateFromState,
    t,
  ]);

  const handleLinkWorkspace = useCallback(async () => {
    if (!projectId) {
      return;
    }

    const { WorkspaceSelectionDialog } = await import(
      '@/shared/dialogs/command-bar/WorkspaceSelectionDialog'
    );
    await WorkspaceSelectionDialog.show({ projectId, issueId });
  }, [projectId, issueId]);

  const handleCreateWorkflowAttempt = useCallback(async () => {
    setError(null);

    // Template is chosen inside the creation flow: prompt only when there is a
    // real choice, otherwise fall back to the single template or a blank graph.
    let template: WorkflowTemplateResponse | null = workflowTemplates[0] ?? null;
    if (workflowTemplates.length > 1) {
      const result = await WorkflowTemplatePickerDialog.show({
        templates: workflowTemplates.map((tpl) => ({
          id: tpl.id,
          name: tpl.name,
          description: tpl.description,
        })),
      });
      if (result.kind === 'canceled') {
        return;
      }
      template =
        workflowTemplates.find((tpl) => tpl.id === result.templateId) ?? null;
    }

    await createWorkflowAttempt({ template });
  }, [createWorkflowAttempt, workflowTemplates]);

  const handleOpenAttempt = useCallback(
    (attemptData: IssueTaskAttemptCardData) => {
      if (!projectId) return;
      const attempt = attemptData as TaskAttemptView;

      if (attempt.kind === 'workflow') {
        if (attempt.workflowId) {
          appNavigation.goToProjectWorkflowEdit(projectId, attempt.workflowId);
        }
        return;
      }

      if (attempt.localWorkspaceId) {
        appNavigation.goToProjectIssueWorkspace(
          projectId,
          issueId,
          attempt.localWorkspaceId
        );
      }
    },
    [projectId, issueId, appNavigation]
  );

  const handleUnlinkAttempt = useCallback(
    async (attemptData: IssueTaskAttemptCardData) => {
      const attempt = attemptData as TaskAttemptView;
      if (attempt.kind !== 'single_agent' || !attempt.localWorkspaceId) return;

      const result = await ConfirmDialog.show({
        title: t('workspaces.unlinkFromIssue'),
        message: t('workspaces.unlinkConfirmMessage'),
        confirmText: t('workspaces.unlink'),
        variant: 'destructive',
      });

      if (result === 'confirmed') {
        try {
          await workspacesApi.unlinkFromIssue(attempt.localWorkspaceId);
        } catch (err) {
          ConfirmDialog.show({
            title: t('common:error'),
            message:
              err instanceof Error ? err.message : t('workspaces.unlinkError'),
            confirmText: t('common:ok'),
            showCancelButton: false,
          });
        }
      }
    },
    [t]
  );

  const handleDeleteAttempt = useCallback(
    async (attemptData: IssueTaskAttemptCardData) => {
      const attempt = attemptData as TaskAttemptView;
      if (attempt.kind === 'workflow') {
        if (!attempt.workflowAttemptId) return;

        const result = await ConfirmDialog.show({
          title: t('attempts.deleteWorkflowTitle'),
          message: t('attempts.deleteWorkflowMessage'),
          confirmText: t('attempts.deleteAttempt'),
          variant: 'destructive',
        });

        if (result !== 'confirmed') {
          return;
        }

        try {
          await deleteWorkflowAttempt(attempt.workflowAttemptId);
        } catch (err) {
          ConfirmDialog.show({
            title: t('common:error'),
            message:
              err instanceof Error
                ? err.message
                : t('attempts.deleteWorkflowError'),
            confirmText: t('common:ok'),
            showCancelButton: false,
          });
        }
        return;
      }

      if (!attempt.localWorkspaceId) return;

      const localWorkspace = localWorkspacesById.get(attempt.localWorkspaceId);
      if (!localWorkspace) {
        ConfirmDialog.show({
          title: t('common:error'),
          message: t('workspaces.deleteError'),
          confirmText: t('common:ok'),
          showCancelButton: false,
        });
        return;
      }

      const result = await DeleteWorkspaceDialog.show({
        branchName: localWorkspace.branch,
        hasOpenPR:
          workspacesWithStats
            .find(
              (workspace) =>
                workspace.localWorkspaceId === attempt.localWorkspaceId
            )
            ?.prs.some((pr) => pr.status === 'open') ?? false,
        isLinkedToIssue: true,
        linkedIssueSimpleId: getIssue(issueId)?.simple_id,
      });

      if (result.action !== 'confirmed') {
        return;
      }

      try {
        await workspacesApi.delete(
          attempt.localWorkspaceId,
          result.deleteBranches
        );
        if (result.unlinkFromIssue) {
          await workspacesApi.unlinkFromIssue(attempt.localWorkspaceId);
        }
      } catch (err) {
        ConfirmDialog.show({
          title: t('common:error'),
          message:
            err instanceof Error ? err.message : t('workspaces.deleteError'),
          confirmText: t('common:ok'),
          showCancelButton: false,
        });
      }
    },
    [
      deleteWorkflowAttempt,
      localWorkspacesById,
      workspacesWithStats,
      getIssue,
      issueId,
      t,
    ]
  );

  const actions: SectionAction[] = useMemo(
    () => [
      {
        icon: GitBranchIcon,
        onClick: handleCreateWorkflowAttempt,
        label: t('attempts.newWorkflow', 'New workflow attempt'),
      },
      {
        icon: PlusIcon,
        onClick: handleAddWorkspace,
        label: t('attempts.newSingleAgent', 'New single-agent attempt'),
      },
      {
        icon: LinkIcon,
        onClick: handleLinkWorkspace,
        label: t('kanban.linkWorkspace', 'Link workspace'),
      },
    ],
    [handleCreateWorkflowAttempt, handleAddWorkspace, handleLinkWorkspace, t]
  );

  return (
    <div>
      <IssueTaskAttemptsSection
        attempts={attempts}
        isLoading={projectLoading || orgLoading || workflowAttemptsLoading}
        actions={actions}
        onOpenAttempt={handleOpenAttempt}
        onUnlinkAttempt={handleUnlinkAttempt}
        onDeleteAttempt={handleDeleteAttempt}
        onCreateWorkflowAttempt={handleCreateWorkflowAttempt}
        onCreateSingleAgentAttempt={handleAddWorkspace}
      />
      {error || workflowCreateError ? (
        <p className="px-base pb-base text-xs text-error" role="alert">
          {error ?? workflowCreateError}
        </p>
      ) : null}
    </div>
  );
}

function localizeTaskAttemptView(
  attempt: TaskAttemptView,
  t: TFunction<'common'>
): TaskAttemptView {
  if (attempt.kind === 'workflow') {
    return {
      ...attempt,
      title:
        attempt.title === 'Workflow attempt'
          ? t('attempts.workflowFallbackTitle')
          : attempt.title,
      subtitle: attempt.latestRunId
        ? t('attempts.workflowRun', {
            id: attempt.latestRunId.slice(0, 8),
          })
        : t('attempts.draftWorkflow'),
      statusLabel: localizeAttemptStatus(attempt.statusLabel, t),
      primaryActionLabel: t('attempts.openCanvas'),
    };
  }

  return {
    ...attempt,
    title:
      attempt.title === 'Single agent attempt'
        ? t('attempts.singleAgentFallbackTitle')
        : attempt.title,
    subtitle: attempt.localWorkspaceId
      ? t('attempts.workspace', {
          id: attempt.localWorkspaceId.slice(0, 8),
        })
      : t('attempts.remoteWorkspace'),
    statusLabel: localizeAttemptStatus(attempt.statusLabel, t),
    primaryActionLabel: t('attempts.openSession'),
  };
}

function localizeAttemptStatus(
  statusLabel: string,
  t: TFunction<'common'>
): string {
  switch (statusLabel) {
    case 'Draft':
      return t('attempts.status.draft');
    case 'Ready':
      return t('attempts.status.ready');
    case 'Running':
      return t('attempts.status.running');
    case 'Waiting for human':
      return t('attempts.status.awaitingHuman');
    case 'Waiting for arena':
      return t('attempts.status.awaitingArena');
    case 'Succeeded':
      return t('attempts.status.succeeded');
    case 'Failed':
      return t('attempts.status.failed');
    case 'Canceled':
      return t('attempts.status.canceled');
    case 'Archived':
      return t('attempts.status.archived');
    case 'Completed':
      return t('attempts.status.completed');
    case 'Active':
      return t('attempts.status.active');
    default:
      return statusLabel;
  }
}
