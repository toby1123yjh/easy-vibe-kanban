import { useMemo, useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone } from 'react-dropzone';
import {
  FolderOpenIcon,
  GitBranchIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
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
import { FolderPickerDialog } from '@/shared/dialogs/shared/FolderPickerDialog';
import { CreateModeRepoPickerBar } from './CreateModeRepoPickerBar';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import {
  AgentSessionResumeChip,
  AgentSessionResumePicker,
} from '@/shared/components/AgentSessionResumePicker';
import { cn } from '@/shared/lib/utils';

function getRepoDisplayName(repo: Repo) {
  return repo.display_name || repo.name;
}

const BRANCH_LABEL_MAX_CHARS = 15;

type WorkspaceCreateMode = 'worktree' | 'direct_folder';

const modeButtonClassName =
  'inline-flex items-center gap-half rounded-sm border px-base py-half text-sm ' +
  'transition-colors';

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
  const hasSelectedRepos = repos.length > 0;
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [hasInitializedStep, setHasInitializedStep] = useState(false);
  const [isSelectingRepos, setIsSelectingRepos] = useState(true);
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkill[]>([]);
  const [stagedResumeSession, setStagedResumeSession] =
    useState<ResumableAgentSession | null>(null);
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceCreateMode>('worktree');
  const [directFolderPath, setDirectFolderPath] = useState('');
  const [directFolderError, setDirectFolderError] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!hasInitialValue || hasInitializedStep) return;
    if (!hasSelectedRepos && !hasResolvedInitialRepoDefaults) return;

    setIsSelectingRepos(!hasSelectedRepos);
    setHasInitializedStep(true);
  }, [
    hasInitialValue,
    hasInitializedStep,
    hasSelectedRepos,
    hasResolvedInitialRepoDefaults,
  ]);

  const hasDirectFolderPath = directFolderPath.trim().length > 0;
  const hasWorkspaceTarget =
    workspaceMode === 'direct_folder' ? hasDirectFolderPath : hasSelectedRepos;
  const hasSelectedBranchesForAllRepos = repos.every(
    (repo) => !!targetBranches[repo.id]
  );
  const hasValidWorkspaceTarget =
    workspaceMode === 'direct_folder'
      ? hasDirectFolderPath
      : hasSelectedRepos && hasSelectedBranchesForAllRepos;
  const showTargetPickerStep = !hasWorkspaceTarget || isSelectingRepos;
  const showChatStep = hasWorkspaceTarget && !isSelectingRepos;

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

  const repoId = repos.length === 1 ? repos[0]?.id : undefined;
  const repoSummaryLabel = useMemo(() => {
    if (repos.length === 1) {
      const repo = repos[0];
      if (!repo) return '0 repositories selected';
      const selectedBranch = targetBranches[repo.id];
      const branch = selectedBranch
        ? truncateBranchLabel(selectedBranch)
        : 'Select branch';
      return `${getRepoDisplayName(repo)} · ${branch}`;
    }

    return `${repos.length} repositories selected`;
  }, [repos, targetBranches]);

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

  const selectDirectFolder = useCallback(async () => {
    setDirectFolderError(null);
    try {
      const selectedPath = await FolderPickerDialog.show({
        value: directFolderPath,
        title: t('createMode.directFolder.dialogTitle', {
          defaultValue: 'Select direct folder',
        }),
        description: t('createMode.directFolder.dialogDescription', {
          defaultValue: 'Choose a folder the agent can read and edit directly.',
        }),
      });
      if (selectedPath) {
        setDirectFolderPath(selectedPath);
      }
    } catch (error) {
      setDirectFolderError(
        error instanceof Error
          ? error.message
          : t('createMode.directFolder.errors.selectFolder', {
              defaultValue: 'Failed to select folder',
            })
      );
    }
  }, [directFolderPath, t]);

  const handleContinueToPrompt = useCallback(() => {
    if (workspaceMode === 'direct_folder' && !hasDirectFolderPath) {
      setDirectFolderError(
        t('createMode.directFolder.errors.required', {
          defaultValue: 'Select a folder before continuing',
        })
      );
      return;
    }
    setIsSelectingRepos(false);
  }, [hasDirectFolderPath, t, workspaceMode]);

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
        workspaceMode === 'worktree'
          ? repos.map((r) => ({
              repo_id: r.id,
              target_branch: targetBranches[r.id]!,
            }))
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
    repos,
    targetBranches,
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
      : hasAttemptedSubmit && workspaceMode === 'worktree' && repos.length === 0
        ? 'Add at least one repository to create a workspace'
        : hasAttemptedSubmit &&
            workspaceMode === 'worktree' &&
            !hasSelectedBranchesForAllRepos
          ? 'Select a branch for every repository before creating a workspace'
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
              <div className="mx-auto flex w-chat max-w-full flex-col gap-base">
                <div className="flex flex-wrap items-center justify-center gap-half">
                  <button
                    type="button"
                    onClick={() => setWorkspaceMode('worktree')}
                    className={cn(
                      modeButtonClassName,
                      workspaceMode === 'worktree'
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border text-normal hover:text-high'
                    )}
                  >
                    <GitBranchIcon className="size-icon-xs" weight="bold" />
                    <span>
                      {t('createMode.targetMode.worktree', {
                        defaultValue: 'Project repository',
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceMode('direct_folder')}
                    className={cn(
                      modeButtonClassName,
                      workspaceMode === 'direct_folder'
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border text-normal hover:text-high'
                    )}
                  >
                    <FolderOpenIcon className="size-icon-xs" weight="bold" />
                    <span>
                      {t('createMode.targetMode.directFolder', {
                        defaultValue: 'Direct folder',
                      })}
                    </span>
                  </button>
                </div>

                {workspaceMode === 'worktree' ? (
                  <CreateModeRepoPickerBar
                    onContinueToPrompt={handleContinueToPrompt}
                  />
                ) : (
                  <div className="px-plusfifty py-base">
                    <div className="rounded-sm border border-warning/30 bg-warning/10 px-base py-base text-sm text-normal">
                      <div className="flex items-start gap-half">
                        <WarningCircleIcon
                          className="mt-[2px] size-icon-sm shrink-0 text-warning"
                          weight="bold"
                        />
                        <p>
                          {t('createMode.directFolder.warning', {
                            defaultValue:
                              'Agents edit this folder directly. No branch or worktree isolation is created.',
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="mt-base flex min-w-0 flex-col gap-half">
                      <label className="text-sm font-medium text-normal">
                        {t('createMode.directFolder.pathLabel', {
                          defaultValue: 'Folder path',
                        })}
                      </label>
                      <div className="flex min-w-0 gap-half">
                        <input
                          value={directFolderPath}
                          onChange={(event) => {
                            setDirectFolderPath(event.target.value);
                            setDirectFolderError(null);
                          }}
                          placeholder={t(
                            'createMode.directFolder.pathPlaceholder',
                            {
                              defaultValue: '/path/to/project',
                            }
                          )}
                          className="min-w-0 flex-1 rounded-sm border border-border bg-primary px-base py-half text-sm text-normal outline-none focus:border-brand"
                        />
                        <button
                          type="button"
                          onClick={selectDirectFolder}
                          className="inline-flex shrink-0 items-center gap-half rounded-sm border border-border px-base py-half text-sm text-normal hover:text-high"
                        >
                          <FolderOpenIcon
                            className="size-icon-xs"
                            weight="bold"
                          />
                          <span>
                            {t('createMode.directFolder.browse', {
                              defaultValue: 'Browse',
                            })}
                          </span>
                        </button>
                      </div>
                    </div>

                    {directFolderError && (
                      <div className="mt-half rounded-sm border border-error/30 bg-error/10 px-base py-half">
                        <p className="text-xs text-error">
                          {directFolderError}
                        </p>
                      </div>
                    )}

                    <div className="mt-base flex justify-end">
                      <button
                        type="button"
                        onClick={handleContinueToPrompt}
                        disabled={!hasDirectFolderPath}
                        className="rounded-sm bg-brand px-base py-half text-sm font-medium text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('buttons.continue')}
                      </button>
                    </div>
                  </div>
                )}
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
                    workspaceMode === 'worktree' ? repos.map((r) => r.id) : []
                  }
                  repoId={workspaceMode === 'worktree' ? repoId : undefined}
                  modelSelector={modelSelectorNode}
                  onPasteFiles={uploadFiles}
                  localAttachments={localAttachments}
                  dropzone={{ getRootProps, getInputProps, isDragActive }}
                  onEditRepos={() => setIsSelectingRepos(true)}
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
