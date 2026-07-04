import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import WYSIWYGEditor from '@/shared/components/WYSIWYGEditor';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useAgentProviderOptions } from '@/shared/hooks/useAgentProviderPolicy';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { getAgentProviderBlockedReasonLabel } from '@/shared/lib/agentProviderOptions';
import { toPrettyCase } from '@/shared/lib/string';
import { ChatBoxBase, VisualVariant } from '@vibe/ui/components/ChatBoxBase';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@vibe/ui/components/Dropdown';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { ToolbarDropdown } from '@vibe/ui/components/Toolbar';
import {
  AgentProviderCapability,
  type ExecutorConfig,
  type SelectedSkill,
} from 'shared/types';
import type { WorkflowNode, WorkflowNodeData } from '../model/workflowGraph';
import {
  coerceWorkflowNodeExecutorConfig,
  createWorkflowAgentNodeDraftPatch,
} from '../model/workflowAgentNodeDraft';

const WORKFLOW_AGENT_DRAFT_REQUIRED_CAPABILITIES = [
  AgentProviderCapability.INITIAL_RUN,
  AgentProviderCapability.WORKFLOW_AGENT_STEP,
] as const;

const EMPTY_SELECTED_SKILLS: SelectedSkill[] = [];

interface WorkflowAgentDraftSubmit {
  prompt: string;
  executorConfig: ExecutorConfig | null;
  selectedSkills: SelectedSkill[];
}

interface WorkflowAgentNodeDraftPanelProps {
  node: WorkflowNode;
  readOnly?: boolean;
  onChange?: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  onSubmit?: (draft: WorkflowAgentDraftSubmit) => void;
  onDone?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  submitError?: string | null;
}

export function WorkflowAgentNodeDraftPanel({
  node,
  readOnly,
  onChange,
  onSubmit,
  onDone,
  isSubmitting = false,
  submitLabel,
  submitError,
}: WorkflowAgentNodeDraftPanelProps) {
  const { t } = useTranslation('common');
  const { profiles, config } = useUserSystem();
  const prompt =
    typeof node.data.prompt_template === 'string'
      ? node.data.prompt_template
      : '';
  const includeWorkflowContext = node.data.include_workflow_context !== false;
  const selectedSkills = node.data.selected_skills ?? EMPTY_SELECTED_SKILLS;
  const promptRef = useRef(prompt);
  const includeWorkflowContextRef = useRef(includeWorkflowContext);
  const selectedSkillsRef = useRef(selectedSkills);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    includeWorkflowContextRef.current = includeWorkflowContext;
  }, [includeWorkflowContext]);

  useEffect(() => {
    selectedSkillsRef.current = selectedSkills;
  }, [selectedSkills]);

  const storedExecutorConfig = useMemo(
    () => coerceWorkflowNodeExecutorConfig(node.data.executor_config),
    [node.data.executor_config]
  );

  const persistDraft = useCallback(
    (
      nextPrompt: string,
      nextExecutorConfig: ExecutorConfig | null,
      nextIncludeWorkflowContext: boolean,
      nextSelectedSkills: SelectedSkill[]
    ) => {
      if (readOnly || !onChange) return;
      onChange(
        node.id,
        createWorkflowAgentNodeDraftPatch({
          prompt: nextPrompt,
          executorConfig: nextExecutorConfig,
          includeWorkflowContext: nextIncludeWorkflowContext,
          selectedSkills: nextSelectedSkills,
        })
      );
    },
    [node.id, onChange, readOnly]
  );

  const {
    executorConfig,
    effectiveExecutor,
    selectedVariant,
    executorOptions,
    variantOptions,
    presetOptions,
    setExecutor,
    setVariant,
    setOverrides,
  } = useExecutorConfig({
    profiles,
    lastUsedConfig: null,
    scratchConfig: storedExecutorConfig,
    configExecutorProfile: config?.executor_profile,
    hiddenAgents: config?.hidden_agents,
    onPersist: (nextConfig) =>
      persistDraft(
        promptRef.current,
        nextConfig,
        includeWorkflowContextRef.current,
        selectedSkillsRef.current
      ),
  });

  const policyExecutorSource = useMemo(() => {
    const next = [...executorOptions];
    if (effectiveExecutor && !next.includes(effectiveExecutor)) {
      next.unshift(effectiveExecutor);
    }
    return next;
  }, [effectiveExecutor, executorOptions]);
  const { options: policyExecutorOptions } = useAgentProviderOptions({
    executors: policyExecutorSource,
    preserveExecutors: [effectiveExecutor],
    requiredCapabilities: WORKFLOW_AGENT_DRAFT_REQUIRED_CAPABILITIES,
  });
  const selectedExecutorOption = useMemo(
    () =>
      effectiveExecutor
        ? policyExecutorOptions.find(
            (option) => option.executor === effectiveExecutor
          )
        : null,
    [effectiveExecutor, policyExecutorOptions]
  );

  const handlePromptChange = (nextPrompt: string) => {
    promptRef.current = nextPrompt;
    persistDraft(
      nextPrompt,
      executorConfig,
      includeWorkflowContextRef.current,
      selectedSkillsRef.current
    );
  };

  const handleWorkflowContextChange = (checked: boolean) => {
    includeWorkflowContextRef.current = checked;
    persistDraft(
      promptRef.current,
      executorConfig,
      checked,
      selectedSkillsRef.current
    );
  };

  const handleSelectedSkillsChange = (nextSelectedSkills: SelectedSkill[]) => {
    selectedSkillsRef.current = nextSelectedSkills;
    persistDraft(
      promptRef.current,
      executorConfig,
      includeWorkflowContextRef.current,
      nextSelectedSkills
    );
  };

  const isDisabled = readOnly || !onChange || isSubmitting;
  const primaryActionLabel =
    submitLabel ??
    (onSubmit ? t('workflow.agentDraft.startRun') : t('buttons.save'));
  const canSubmit =
    !isDisabled &&
    !!prompt.trim() &&
    !!executorConfig &&
    selectedExecutorOption?.enabled !== false;

  const handleDone = () => {
    if (!canSubmit || !executorConfig) return;

    persistDraft(
      promptRef.current,
      executorConfig,
      includeWorkflowContextRef.current,
      selectedSkillsRef.current
    );
    onSubmit?.({
      prompt: promptRef.current,
      executorConfig,
      selectedSkills: selectedSkillsRef.current,
    });
    onDone?.();
  };

  return (
    <div className="flex h-full flex-col bg-primary">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8">
        <div className="flex w-chat max-w-full flex-col gap-5">
          <div className="space-y-1 text-center">
            <h2 className="text-3xl font-medium tracking-tight text-high">
              {t('createMode.headings.chatStep')}
            </h2>
            <p className="text-sm text-low">
              {node.data.display_name ||
                t('workflow.agentDraft.defaultStepName')}
            </p>
          </div>

          <ChatBoxBase
            visualVariant={VisualVariant.NORMAL}
            error={submitError}
            editor={
              <WYSIWYGEditor
                placeholder={t('workflow.agentDraft.promptPlaceholder')}
                value={prompt}
                onChange={handlePromptChange}
                onCmdEnter={handleDone}
                disabled={isDisabled}
                className="min-h-double max-h-[44vh] overflow-y-auto"
                executor={effectiveExecutor}
                selectedSkills={selectedSkills}
                onSelectedSkillsChange={handleSelectedSkillsChange}
                autoFocus
                sendShortcut={config?.send_message_shortcut}
              />
            }
            headerLeft={
              <>
                <AgentIcon agent={effectiveExecutor} className="size-icon-xl" />
                <ToolbarDropdown
                  label={
                    effectiveExecutor
                      ? toPrettyCase(effectiveExecutor)
                      : t('workflow.agentDraft.selectExecutor')
                  }
                  disabled={isDisabled}
                >
                  <DropdownMenuLabel>
                    {t('modelSelector.agent')}
                  </DropdownMenuLabel>
                  {policyExecutorOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.executor}
                      icon={
                        effectiveExecutor === option.executor
                          ? CheckIcon
                          : undefined
                      }
                      disabled={!option.enabled}
                      badge={
                        getAgentProviderBlockedReasonLabel(
                          option.disabledReason
                        ) ?? undefined
                      }
                      onClick={() => setExecutor(option.executor)}
                    >
                      {toPrettyCase(option.executor)}
                    </DropdownMenuItem>
                  ))}
                </ToolbarDropdown>
              </>
            }
            modelSelector={
              effectiveExecutor ? (
                <ModelSelectorContainer
                  agent={effectiveExecutor}
                  workspaceId={undefined}
                  onAdvancedSettings={() =>
                    SettingsDialog.show({ initialSection: 'agents' })
                  }
                  presets={variantOptions}
                  selectedPreset={selectedVariant}
                  onPresetSelect={setVariant}
                  onOverrideChange={setOverrides}
                  executorConfig={executorConfig}
                  presetOptions={presetOptions}
                />
              ) : undefined
            }
            footerLeft={
              <label className="flex max-w-[260px] items-start gap-2 text-xs text-medium">
                <input
                  type="checkbox"
                  checked={includeWorkflowContext}
                  onChange={(event) =>
                    handleWorkflowContextChange(event.target.checked)
                  }
                  disabled={isDisabled}
                  className="mt-0.5 h-4 w-4 rounded border-secondary text-brand focus:ring-brand disabled:opacity-50"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-high">
                    {t('workflow.agentDraft.includeWorkflowContext', {
                      defaultValue: 'Carry workflow context',
                    })}
                  </span>
                  <span className="leading-relaxed text-low">
                    {t('workflow.agentDraft.includeWorkflowContextHelp', {
                      defaultValue: 'Adds workflow input and upstream results.',
                    })}
                  </span>
                </span>
              </label>
            }
            footerRight={
              <PrimaryButton
                value={
                  isSubmitting
                    ? t('workflow.agentDraft.starting')
                    : primaryActionLabel
                }
                onClick={handleDone}
                actionIcon={isSubmitting ? 'spinner' : undefined}
                disabled={!canSubmit}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
