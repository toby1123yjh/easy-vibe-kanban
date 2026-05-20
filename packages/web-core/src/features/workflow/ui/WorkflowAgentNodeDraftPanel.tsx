import { useCallback, useMemo } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import WYSIWYGEditor from '@/shared/components/WYSIWYGEditor';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { toPrettyCase } from '@/shared/lib/string';
import { ChatBoxBase, VisualVariant } from '@vibe/ui/components/ChatBoxBase';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@vibe/ui/components/Dropdown';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { ToolbarDropdown } from '@vibe/ui/components/Toolbar';
import type { BaseCodingAgent, ExecutorConfig } from 'shared/types';
import type { WorkflowNode, WorkflowNodeData } from '../model/workflowGraph';
import {
  coerceWorkflowNodeExecutorConfig,
  createWorkflowAgentNodeDraftPatch,
} from '../model/workflowAgentNodeDraft';

interface WorkflowAgentDraftSubmit {
  prompt: string;
  executorConfig: ExecutorConfig | null;
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

  const storedExecutorConfig = useMemo(
    () => coerceWorkflowNodeExecutorConfig(node.data.executor_config),
    [node.data.executor_config]
  );

  const persistDraft = useCallback(
    (nextPrompt: string, nextExecutorConfig: ExecutorConfig | null) => {
      if (readOnly || !onChange) return;
      onChange(
        node.id,
        createWorkflowAgentNodeDraftPatch({
          prompt: nextPrompt,
          executorConfig: nextExecutorConfig,
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
    onPersist: (nextConfig) => persistDraft(prompt, nextConfig),
  });

  const handlePromptChange = (nextPrompt: string) => {
    persistDraft(nextPrompt, executorConfig);
  };

  const isDisabled = readOnly || !onChange || isSubmitting;
  const primaryActionLabel =
    submitLabel ??
    (onSubmit ? t('workflow.agentDraft.startRun') : t('buttons.save'));

  const handleDone = () => {
    if (isDisabled || !prompt.trim() || !executorConfig) return;

    persistDraft(prompt, executorConfig);
    onSubmit?.({ prompt, executorConfig });
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
                  {executorOptions.map((executor) => (
                    <DropdownMenuItem
                      key={executor}
                      icon={
                        effectiveExecutor === executor ? CheckIcon : undefined
                      }
                      onClick={() => setExecutor(executor as BaseCodingAgent)}
                    >
                      {toPrettyCase(executor)}
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
            footerLeft={null}
            footerRight={
              <PrimaryButton
                value={
                  isSubmitting
                    ? t('workflow.agentDraft.starting')
                    : primaryActionLabel
                }
                onClick={handleDone}
                actionIcon={isSubmitting ? 'spinner' : undefined}
                disabled={isDisabled || !prompt.trim() || !executorConfig}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
