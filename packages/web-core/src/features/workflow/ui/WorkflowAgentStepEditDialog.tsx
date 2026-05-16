import { useEffect, useMemo, useState } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { Loader2 } from 'lucide-react';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import WYSIWYGEditor from '@/shared/components/WYSIWYGEditor';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { toPrettyCase } from '@/shared/lib/string';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/Dialog';
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

export interface WorkflowAgentStepEditDialogProps {
  open: boolean;
  node: WorkflowNode | null;
  readOnly?: boolean;
  isSaving?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (value: WorkflowAgentStepEditValue) => void;
}

export function WorkflowAgentStepEditDialog({
  open,
  node,
  readOnly = false,
  isSaving = false,
  error,
  onOpenChange,
  onSave,
}: WorkflowAgentStepEditDialogProps) {
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

  const isDisabled = readOnly || isSaving || !node;

  const handleSave = () => {
    if (isDisabled) return;
    onSave({
      displayName: displayName.trim() || 'Agent Step',
      prompt,
      executorConfig,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-secondary px-5 py-4">
          <DialogTitle>Edit Agent Step</DialogTitle>
          <DialogDescription>
            Configure the step session prompt and executor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(88vh-132px)] flex-col gap-5 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-high">Step title</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={isDisabled}
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
                disabled={isDisabled}
                className="max-h-[32vh] min-h-[160px] overflow-y-auto px-3 py-2"
                executor={effectiveExecutor}
                sendShortcut={config?.send_message_shortcut}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-high">Executor</span>
            <div className="flex flex-wrap items-center gap-2 rounded border border-secondary bg-primary p-2">
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
                disabled={isDisabled}
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

        {error ? (
          <div className="border-t border-error/30 bg-error/10 px-5 py-2 text-xs text-error">
            {error}
          </div>
        ) : null}

        <DialogFooter className="border-t border-secondary px-5 py-4">
          <Button
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={isDisabled || !executorConfig} onClick={handleSave}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
