import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone } from 'react-dropzone';
import { FolderOpenIcon } from '@phosphor-icons/react';
import { useCreateMode } from '@/features/create-mode/model/useCreateMode';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import WYSIWYGEditor from '@/shared/components/WYSIWYGEditor';
import { useCreateWorkspace } from '@/shared/hooks/useCreateWorkspace';
import { useCreateAttachments } from '@/shared/hooks/useCreateAttachments';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { saveProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { getSortedExecutorVariantKeys } from '@/shared/lib/executor';
import { getDestinationHostId } from '@/shared/lib/routes/appNavigation';
import { buildAgentPrompt } from '@/shared/lib/promptMessage';
import {
  toPrettyCase,
  splitMessageToTitleDescription,
} from '@/shared/lib/string';
import type {
  BaseCodingAgent,
  Repo,
  ResumableAgentSession,
  SelectedSkill,
} from 'shared/types';
import { CreateChatBox } from '@vibe/ui/components/CreateChatBox';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import {
  WorkspaceTargetDialog,
  type WorkspaceTargetMode,
} from '@/shared/dialogs/shared/WorkspaceTargetDialog';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import {
  AgentSessionResumeChip,
  AgentSessionResumePicker,
} from '@/shared/components/AgentSessionResumePicker';

function getRepoDisplayName(repo: Repo) {
  return repo.display_name || repo.name;
}

const BRANCH_LABEL_MAX_CHARS = 15;

type WorkspaceCreateMode = WorkspaceTargetMode;

function truncateBranchLabel(branch: string) {
  return branch.length > BRANCH_LABEL_MAX_CHARS
    ? `${branch.slice(0, BRANCH_LABEL_MAX_CHARS)}...`
    : branch;
}

interface CreateChatBoxContainerProps {
  onWorkspaceCreated: (workspaceId: string) => void;
}

export function CreateChatBoxContainer({
  onWorkspaceCreated,
}: CreateChatBoxContainerProps) {
  const { t } = useTranslation('common');
  const { profiles, config } = useUserSystem();
  const {
    repos,
    targetBranches,
    addRepo,
    clearRepos,
    setTargetBranch,
    message,
    setMessage,
    clearDraft,
    hasInitialValue,
    hasResolvedInitialRepoDefaults,
    linkedIssue,
    clearLinkedIssue,
    preferredExecutorConfig,
    executorConfig: draftConfig,
    setExecutorConfig: setDraftConfig,
    attachments: draftAttachments,
    setAttachments: setDraftAttachments,
  } = useCreateMode();

  const { createWorkspace } = useCreateWorkspace();
  const destination = useCurrentAppDestination();
  const hostId = useMemo(
    () => getDestinationHostId(destination),
    [destination]
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const workspaceDialogOpenRef = useRef(false);
  const [hasInitializedWorkspaceTarget, setHasInitializedWorkspaceTarget] =
    useState(false);
  const [hasConfirmedWorkspaceTarget, setHasConfirmedWorkspaceTarget] =
    useState(false);
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkill[]>([]);
  const [stagedResumeSession, setStagedResumeSession] =
    useState<ResumableAgentSession | null>(null);
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceCreateMode>('worktree');
  const [directFolderPath, setDirectFolderPath] = useState('');

  const selectedRepo = repos[0] ?? null;
  const hasDirectFolderPath = directFolderPath.trim().length > 0;
  const selectedTargetBranch = selectedRepo
    ? targetBranches[selectedRepo.id]
    : null;
  const hasSelectedBranch = Boolean(selectedTargetBranch);
  const hasValidWorkspaceTarget =
    workspaceMode === 'direct_folder'
      ? hasDirectFolderPath
      : selectedRepo !== null && hasSelectedBranch;
  const hasWorkspaceTarget =
    hasConfirmedWorkspaceTarget && hasValidWorkspaceTarget;
  const showTargetPickerStep = !hasWorkspaceTarget;
  const showChatStep = hasWorkspaceTarget;

  // Attachment handling - insert markdown and track attachment IDs
  const handleInsertMarkdown = useCallback(
    (markdown: string) => {
      const newMessage = message.trim()
        ? `${message}\n\n${markdown}`
        : markdown;
      setMessage(newMessage);
    },
    [message, setMessage]
  );

  const { uploadFiles, getAttachmentIds, clearAttachments, localAttachments } =
    useCreateAttachments(
      handleInsertMarkdown,
      draftAttachments,
      setDraftAttachments
    );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        uploadFiles(acceptedFiles);
      }
    },
    [uploadFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: createWorkspace.isPending || !hasWorkspaceTarget,
    noClick: true,
    noKeyboard: true,
  });

  const scratchConfig = useMemo(() => {
    if (!hasInitialValue) return undefined; // still loading
    return draftConfig ?? null;
  }, [hasInitialValue, draftConfig]);

  const {
    executorConfig,
    effectiveExecutor,
    selectedVariant,
    executorOptions,
    variantOptions,
    presetOptions,
    setOverrides: setExecutorOverrides,
  } = useExecutorConfig({
    profiles,
    lastUsedConfig: preferredExecutorConfig,
    scratchConfig,
    configExecutorProfile: config?.executor_profile,
    hiddenAgents: config?.hidden_agents,
    onPersist: (cfg) => setDraftConfig(cfg),
  });

  useEffect(() => {
    setStagedResumeSession(null);
  }, [effectiveExecutor]);

  const repoId = selectedRepo?.id;
  const repoSummaryLabel = useMemo(() => {
    if (selectedRepo) {
      const repo = selectedRepo;
      const selectedBranch = targetBranches[repo.id];
      const branch = selectedBranch
        ? truncateBranchLabel(selectedBranch)
        : 'Select branch';
      return `${getRepoDisplayName(repo)} · ${branch}`;
    }

    return 'Choose workspace';
  }, [selectedRepo, targetBranches]);

  const repoSummaryTitle = useMemo(
    () =>
      repos
        .map((repo) => {
          const branch = targetBranches[repo.id] ?? 'Select branch';
          return `${getRepoDisplayName(repo)} (${branch})`;
        })
        .join('\n'),
    [repos, targetBranches]
  );

  // Determine if we can submit
  const canSubmit =
    hasValidWorkspaceTarget &&
    message.trim().length > 0 &&
    effectiveExecutor !== null;

  const openWorkspaceTargetDialog = useCallback(async () => {
    if (workspaceDialogOpenRef.current) return;
    workspaceDialogOpenRef.current = true;

    try {
      const initialPath =
        workspaceMode === 'direct_folder'
          ? directFolderPath
          : selectedRepo?.path;
      const result = await WorkspaceTargetDialog.show({
        initialPath,
        initialMode: workspaceMode,
        initialBranch: selectedTargetBranch,
        hostId,
      });

      if (result.kind !== 'confirmed') return;

      clearRepos();
      if (result.selection.mode === 'worktree') {
        setWorkspaceMode('worktree');
        setDirectFolderPath('');
        addRepo(result.selection.repo);
        setTargetBranch(
          result.selection.repo.id,
          result.selection.targetBranch
        );
      } else {
        setWorkspaceMode('direct_folder');
        setDirectFolderPath(result.selection.path);
      }

      setHasAttemptedSubmit(false);
      setStagedResumeSession(null);
      setHasConfirmedWorkspaceTarget(true);
    } finally {
      workspaceDialogOpenRef.current = false;
    }
  }, [
    addRepo,
    clearRepos,
    directFolderPath,
    hostId,
    selectedRepo,
    selectedTargetBranch,
    setTargetBranch,
    workspaceMode,
  ]);

  useEffect(() => {
    if (!hasInitialValue || repos.length <= 1) return;

    const firstRepo = repos[0];
    if (!firstRepo) return;
    const firstBranch = targetBranches[firstRepo.id];

    clearRepos();
    addRepo(firstRepo);
    if (firstBranch) {
      setTargetBranch(firstRepo.id, firstBranch);
    }
  }, [
    addRepo,
    clearRepos,
    hasInitialValue,
    repos,
    setTargetBranch,
    targetBranches,
  ]);

  useEffect(() => {
    if (
      !hasInitialValue ||
      !hasResolvedInitialRepoDefaults ||
      hasInitializedWorkspaceTarget
    ) {
      return;
    }

    setHasInitializedWorkspaceTarget(true);
    void openWorkspaceTargetDialog();
  }, [
    hasInitialValue,
    hasResolvedInitialRepoDefaults,
    hasInitializedWorkspaceTarget,
    openWorkspaceTargetDialog,
  ]);

  const handlePresetSelect = (presetId: string | null) => {
    if (!effectiveExecutor) return;
    setDraftConfig({
      ...draftConfig,
      executor: effectiveExecutor,
      variant: presetId,
    });
  };

  const handleCustomise = () => {
    SettingsDialog.show({ initialSection: 'agents' });
  };

  const resumeScopePath =
    workspaceMode === 'direct_folder'
      ? directFolderPath.trim() || undefined
      : undefined;

  useEffect(() => {
    setStagedResumeSession(null);
  }, [resumeScopePath, workspaceMode]);

  const resumePickerNode = effectiveExecutor ? (
    <AgentSessionResumePicker
      scopePath={resumeScopePath}
      executor={effectiveExecutor}
      selectedSessionId={stagedResumeSession?.agent_session_id}
      disabled={
        createWorkspace.isPending ||
        (workspaceMode === 'direct_folder' && !resumeScopePath)
      }
      onSelect={setStagedResumeSession}
    />
  ) : undefined;

  const modelSelectorNode =
    effectiveExecutor || stagedResumeSession ? (
      <>
        {effectiveExecutor && (
          <ModelSelectorContainer
            agent={effectiveExecutor}
            workspaceId={undefined}
            onAdvancedSettings={handleCustomise}
            presets={variantOptions}
            selectedPreset={selectedVariant}
            onPresetSelect={handlePresetSelect}
            onOverrideChange={setExecutorOverrides}
            executorConfig={executorConfig}
            presetOptions={presetOptions}
          />
        )}
        {stagedResumeSession && (
          <AgentSessionResumeChip
            session={stagedResumeSession}
            onClear={() => setStagedResumeSession(null)}
          />
        )}
      </>
    ) : undefined;

  // Handle executor change - use saved variant if switching to default executor
  const handleExecutorChange = useCallback(
    (executor: BaseCodingAgent) => {
      setStagedResumeSession(null);
      const executorProfile = profiles?.[executor];
      if (!executorProfile) {
        setDraftConfig({ executor, variant: null });
        return;
      }

      const variants = getSortedExecutorVariantKeys(executorProfile);
      let targetVariant: string | null = null;

      // If switching to user's default executor, use their saved variant
      if (
        config?.executor_profile?.executor === executor &&
        config?.executor_profile?.variant
      ) {
        const savedVariant = config.executor_profile.variant;
        if (variants.includes(savedVariant)) {
          targetVariant = savedVariant;
        }
      }

      // Fallback to DEFAULT or first available
      if (!targetVariant) {
        targetVariant = variants.includes('DEFAULT')
          ? 'DEFAULT'
          : (variants[0] ?? null);
      }

      setDraftConfig({ executor, variant: targetVariant });
    },
    [profiles, setDraftConfig, config?.executor_profile]
  );

  // Handle submit
  const handleSubmit = useCallback(async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit || !executorConfig) return;

    const { title } = splitMessageToTitleDescription(message);
    const { prompt, isSlashCommand } = buildAgentPrompt(message, []);
    const data = {
      mode: workspaceMode,
      executor_config: executorConfig,
      name: title,
      prompt,
      repos:
        workspaceMode === 'worktree' && selectedRepo && selectedTargetBranch
          ? [
              {
                repo_id: selectedRepo.id,
                target_branch: selectedTargetBranch,
              },
            ]
          : [],
      directory_path:
        workspaceMode === 'direct_folder' ? directFolderPath.trim() : undefined,
      linked_issue: linkedIssue
        ? {
            remote_project_id: linkedIssue.remoteProjectId,
            issue_id: linkedIssue.issueId,
          }
        : null,
      selected_skills:
        !isSlashCommand && selectedSkills.length > 0
          ? selectedSkills
          : undefined,
      resume_session_id: stagedResumeSession?.agent_session_id,
      attachment_ids: getAttachmentIds(),
    };
    const linkToIssue = linkedIssue
      ? {
          remoteProjectId: linkedIssue.remoteProjectId,
          issueId: linkedIssue.issueId,
        }
      : undefined;

    const result = await createWorkspace.mutateAsync({
      data,
      linkToIssue,
    });

    if (result.workspace) {
      onWorkspaceCreated(result.workspace.id);
    }

    if (workspaceMode === 'worktree' && linkedIssue?.remoteProjectId) {
      saveProjectRepoDefaults(
        linkedIssue.remoteProjectId,
        data.repos,
        hostId
      ).catch((err) =>
        console.warn('Failed to save project repo defaults:', err)
      );
    }

    clearAttachments();
    setSelectedSkills([]);
    setStagedResumeSession(null);
    await clearDraft();
  }, [
    canSubmit,
    executorConfig,
    message,
    selectedSkills,
    stagedResumeSession?.agent_session_id,
    workspaceMode,
    directFolderPath,
    selectedRepo,
    selectedTargetBranch,
    createWorkspace,
    onWorkspaceCreated,
    getAttachmentIds,
    clearAttachments,
    clearDraft,
    linkedIssue,
    hostId,
  ]);

  // Determine error to display
  const displayError =
    hasAttemptedSubmit &&
    workspaceMode === 'direct_folder' &&
    !hasDirectFolderPath
      ? t('createMode.directFolder.errors.required', {
          defaultValue: 'Select a folder before continuing',
        })
      : hasAttemptedSubmit && workspaceMode === 'worktree' && !selectedRepo
        ? 'Choose a workspace before creating it'
        : hasAttemptedSubmit &&
            workspaceMode === 'worktree' &&
            !hasSelectedBranch
          ? 'Select a branch before creating a workspace'
          : createWorkspace.error
            ? createWorkspace.error instanceof Error
              ? createWorkspace.error.message
              : 'Failed to create workspace'
            : null;

  // Wait for initial value to be applied before rendering
  // This ensures the editor mounts with content ready, so autoFocus works correctly
  if (!hasInitialValue) {
    return null;
  }

  return (
    <div className="relative flex flex-1 flex-col bg-primary h-full">
      <div className="flex flex-1 items-center justify-center px-base">
        <div className="flex w-chat max-w-full flex-col gap-base">
          {showTargetPickerStep && (
            <>
              <h2 className="mb-double text-center text-4xl font-medium tracking-tight text-high">
                {t('createMode.headings.repoStep')}
              </h2>
              <div className="mx-auto flex max-w-md flex-col items-center gap-base text-center">
                <p className="text-sm text-low">
                  {t('createMode.workspaceDialog.launchHint', {
                    defaultValue:
                      'Choose one directory, then decide whether to use an isolated worktree or work in place.',
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => void openWorkspaceTargetDialog()}
                  className="inline-flex items-center gap-half rounded-sm bg-brand px-base py-half text-sm font-medium text-on-brand hover:bg-brand-hover"
                >
                  <FolderOpenIcon className="size-icon-xs" weight="bold" />
                  <span>
                    {t('createMode.workspaceDialog.open', {
                      defaultValue: 'Choose workspace',
                    })}
                  </span>
                </button>
              </div>
            </>
          )}

          {showChatStep && (
            <>
              <h2 className="mb-double text-center text-4xl font-medium tracking-tight text-high">
                {t('createMode.headings.chatStep')}
              </h2>

              <div className="flex justify-center @container">
                <CreateChatBox
                  editor={{
                    value: message,
                    onChange: setMessage,
                  }}
                  renderEditor={({
                    value,
                    onChange,
                    onCmdEnter,
                    disabled,
                    repoIds,
                    repoId,
                    executor,
                    onPasteFiles,
                    localAttachments,
                  }) => (
                    <WYSIWYGEditor
                      placeholder="Describe the task..."
                      value={value}
                      onChange={onChange}
                      onCmdEnter={onCmdEnter}
                      disabled={disabled}
                      className="min-h-double max-h-[50vh] overflow-y-auto"
                      repoIds={repoIds}
                      repoId={repoId}
                      executor={executor}
                      selectedSkills={selectedSkills}
                      onSelectedSkillsChange={setSelectedSkills}
                      autoFocus
                      onPasteFiles={onPasteFiles}
                      localAttachments={localAttachments}
                      sendShortcut={config?.send_message_shortcut}
                    />
                  )}
                  agentIcon={
                    <AgentIcon
                      agent={effectiveExecutor}
                      className="size-icon-xl"
                    />
                  }
                  onSend={handleSubmit}
                  isSending={createWorkspace.isPending}
                  disabled={!hasWorkspaceTarget}
                  executor={{
                    selected: effectiveExecutor,
                    options: executorOptions,
                    onChange: handleExecutorChange,
                    afterSelector: resumePickerNode,
                  }}
                  formatExecutorLabel={toPrettyCase}
                  error={displayError}
                  repoIds={
                    workspaceMode === 'worktree' && selectedRepo
                      ? [selectedRepo.id]
                      : []
                  }
                  repoId={workspaceMode === 'worktree' ? repoId : undefined}
                  modelSelector={modelSelectorNode}
                  onPasteFiles={uploadFiles}
                  localAttachments={localAttachments}
                  dropzone={{ getRootProps, getInputProps, isDragActive }}
                  onEditRepos={() => void openWorkspaceTargetDialog()}
                  repoSummaryLabel={
                    workspaceMode === 'direct_folder'
                      ? t('createMode.directFolder.summaryLabel', {
                          defaultValue: 'Direct folder',
                        })
                      : repoSummaryLabel
                  }
                  repoSummaryTitle={
                    workspaceMode === 'direct_folder'
                      ? directFolderPath
                      : repoSummaryTitle
                  }
                  linkedIssue={
                    linkedIssue?.simpleId
                      ? {
                          simpleId: linkedIssue.simpleId,
                          title: linkedIssue.title ?? '',
                          onRemove: clearLinkedIssue,
                        }
                      : null
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
