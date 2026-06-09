import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '@phosphor-icons/react';
import { Loader2, X } from 'lucide-react';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import WYSIWYGEditor from '@/shared/components/WYSIWYGEditor';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { toPrettyCase } from '@/shared/lib/string';
import { cn } from '@/shared/lib/utils';
import { Button } from '@vibe/ui/components/Button';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@vibe/ui/components/Dropdown';
import { ToolbarDropdown } from '@vibe/ui/components/Toolbar';
import type { BaseCodingAgent, ExecutorConfig } from 'shared/types';
import type { WorkflowNode } from '../model/workflowGraph';
import { coerceWorkflowNodeExecutorConfig } from '../model/workflowAgentNodeDraft';

export interface WorkflowAgentStepEditValue {
  displayName: string;
  prompt: string;
  includeWorkflowContext: boolean;
  executorConfig: ExecutorConfig | null;
}

export interface WorkflowAgentStepEditPanelProps {
  node: WorkflowNode | null;
  readOnly?: boolean;
  isSaving?: boolean;
  isRunning?: boolean;
  hasExistingRun?: boolean;
  error?: string | null;
  onClose: () => void;
  onExecutorConfigChange?: (executorConfig: ExecutorConfig) => void;
  onSave: (value: WorkflowAgentStepEditValue) => void;
}

export function WorkflowAgentStepEditPanel({
  node,
  readOnly = false,
  isSaving = false,
  isRunning = false,
  hasExistingRun = false,
  error,
  onClose,
  onExecutorConfigChange,
  onSave,
}: WorkflowAgentStepEditPanelProps) {
  const { t } = useTranslation('common');
  const { profiles, config } = useUserSystem();
  const [displayName, setDisplayName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [includeWorkflowContext, setIncludeWorkflowContext] = useState(true);

  const storedExecutorConfig = useMemo(
    () => coerceWorkflowNodeExecutorConfig(node?.data.executor_config),
    [node?.data.executor_config]
  );

  useEffect(() => {
    if (!node) return;
    setDisplayName(
      typeof node.data.display_name === 'string' ? node.data.display_name : ''
    );
    setPrompt(
      typeof node.data.prompt_template === 'string'
        ? node.data.prompt_template
        : ''
    );
    setIncludeWorkflowContext(node.data.include_workflow_context !== false);
  }, [node]);

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
    onPersist: onExecutorConfigChange,
  });

  const isTitleDisabled = readOnly || isSaving || !node;
  const isConfigDisabled = isTitleDisabled || isRunning;
  const canSave = !readOnly && !isSaving && !!node && !!executorConfig;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      displayName: displayName.trim() || t('workflow.agentEdit.defaultTitle'),
      prompt,
      includeWorkflowContext,
      executorConfig,
    });
  };

  return (
    <aside
      data-testid="workflow-agent-step-edit-panel"
      className="flex h-full min-h-0 flex-col bg-panel"
    >
      <div className="flex shrink-0 items-start justify-between gap-base border-b border-secondary p-base">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-high">
            {t('workflow.agentEdit.title')}
          </h2>
          <p className="mt-1 text-xs text-low">
            {t('workflow.agentEdit.description')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label={t('workflow.agentEdit.close')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {isRunning ? (
        <div className="border-b border-brand/30 bg-brand/10 px-base py-half text-xs text-brand">
          {t('workflow.agentEdit.runningHint')}
        </div>
      ) : hasExistingRun ? (
        <div className="border-b border-secondary bg-primary/40 px-base py-half text-xs text-low">
          {t('workflow.agentEdit.nextRunHint')}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-base overflow-y-auto p-base">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-high">
            {t('workflow.agentEdit.stepTitle')}
          </span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isTitleDisabled}
            className="h-10 rounded border border-secondary bg-primary px-3 text-sm text-high outline-none transition-colors placeholder:text-low focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50"
            placeholder={t('workflow.agentEdit.defaultTitle')}
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-high">
            {t('workflow.agentEdit.defaultPrompt')}
          </label>
          <div className="rounded border border-secondary bg-primary">
            <WYSIWYGEditor
              placeholder={t('workflow.agentEdit.promptPlaceholder')}
              value={prompt}
              onChange={setPrompt}
              onCmdEnter={handleSave}
              disabled={isConfigDisabled}
              className="max-h-[42vh] min-h-[180px] overflow-y-auto px-3 py-2"
              executor={effectiveExecutor}
              sendShortcut={config?.send_message_shortcut}
            />
          </div>
          <label className="flex items-start gap-2 rounded border border-secondary/70 bg-primary/60 px-3 py-2 text-xs text-medium">
            <input
              type="checkbox"
              checked={includeWorkflowContext}
              onChange={(event) =>
                setIncludeWorkflowContext(event.target.checked)
              }
              disabled={isConfigDisabled}
              className="mt-0.5 h-4 w-4 rounded border-secondary text-brand focus:ring-brand disabled:opacity-50"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-high">
                {t('workflow.agentEdit.includeWorkflowContext', {
                  defaultValue: 'Carry workflow context',
                })}
              </span>
              <span className="leading-relaxed text-low">
                {t('workflow.agentEdit.includeWorkflowContextHelp', {
                  defaultValue:
                    'Send workflow input, direct upstream results, and downstream handoff guidance with this prompt.',
                })}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-high">
            {t('workflow.agentEdit.executor')}
          </span>
          <div className="rounded border border-secondary bg-primary p-2">
            <div
              className={cn(
                'flex flex-wrap items-center gap-2',
                isConfigDisabled && 'pointer-events-none opacity-60'
              )}
              aria-disabled={isConfigDisabled}
            >
              <AgentIcon
                agent={effectiveExecutor}
                className="size-icon-xl shrink-0"
              />
              <ToolbarDropdown
                label={
                  effectiveExecutor
                    ? toPrettyCase(effectiveExecutor)
                    : t('workflow.agentEdit.selectExecutor')
                }
                disabled={isConfigDisabled}
              >
                <DropdownMenuLabel>
                  {t('workflow.agentEdit.agent')}
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

              {effectiveExecutor ? (
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
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-t border-error/30 bg-error/10 px-base py-half text-xs text-error">
          {error}
        </div>
      ) : null}

      <div className="flex shrink-0 justify-end gap-half border-t border-secondary p-base">
        <Button variant="outline" disabled={isSaving} onClick={onClose}>
          {t('buttons.cancel')}
        </Button>
        <Button disabled={!canSave} onClick={handleSave}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('workflow.agentEdit.saveStep')}
        </Button>
      </div>
    </aside>
  );
}
