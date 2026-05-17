import { useEffect, useMemo, useState } from 'react';
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
  onSave,
}: WorkflowAgentStepEditPanelProps) {
  const { profiles, config } = useUserSystem();
  const [displayName, setDisplayName] = useState('');
  const [prompt, setPrompt] = useState('');

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
  });

  const isTitleDisabled = readOnly || isSaving || !node;
  const isConfigDisabled = isTitleDisabled || isRunning;
  const canSave = !readOnly && !isSaving && !!node && !!executorConfig;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      displayName: displayName.trim() || 'Agent Step',
      prompt,
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
            Edit Agent Step
          </h2>
          <p className="mt-1 text-xs text-low">
            Configure the session prompt and executor for this step.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {isRunning ? (
        <div className="border-b border-brand/30 bg-brand/10 px-base py-half text-xs text-brand">
          This step is currently running. Prompt and agent settings can be
          edited after it finishes.
        </div>
      ) : hasExistingRun ? (
        <div className="border-b border-secondary bg-primary/40 px-base py-half text-xs text-low">
          Changes apply to the next workflow run or the next trigger of this
          step.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-base overflow-y-auto p-base">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-high">Step title</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isTitleDisabled}
            className="h-10 rounded border border-secondary bg-primary px-3 text-sm text-high outline-none transition-colors placeholder:text-low focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50"
            placeholder="Agent Step"
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-high">
            Default prompt
          </label>
          <div className="rounded border border-secondary bg-primary">
            <WYSIWYGEditor
              placeholder="Describe what this agent step should do..."
              value={prompt}
              onChange={setPrompt}
              onCmdEnter={handleSave}
              disabled={isConfigDisabled}
              className="max-h-[42vh] min-h-[180px] overflow-y-auto px-3 py-2"
              executor={effectiveExecutor}
              sendShortcut={config?.send_message_shortcut}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-high">Executor</span>
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
                    : 'Select Executor'
                }
                disabled={isConfigDisabled}
              >
                <DropdownMenuLabel>Agent</DropdownMenuLabel>
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
          Cancel
        </Button>
        <Button disabled={!canSave} onClick={handleSave}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save step
        </Button>
      </div>
    </aside>
  );
}
