import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '@phosphor-icons/react';
import { Loader2, X } from 'lucide-react';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { ModelSelectorContainer } from '@/shared/components/ModelSelectorContainer';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { useAgentProviderOptions } from '@/shared/hooks/useAgentProviderPolicy';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { getAgentProviderBlockedReasonLabel } from '@/shared/lib/agentProviderOptions';
import { toPrettyCase } from '@/shared/lib/string';
import { cn } from '@/shared/lib/utils';
import { Button } from '@vibe/ui/components/Button';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@vibe/ui/components/Dropdown';
import { ToolbarDropdown } from '@vibe/ui/components/Toolbar';
import {
  AgentProviderCapability,
  type BaseCodingAgent,
  type ExecutorConfig,
} from 'shared/types';
import { coerceWorkflowNodeExecutorConfig } from '../model/workflowAgentNodeDraft';

const WORKFLOW_ROUTER_REQUIRED_CAPABILITIES = [
  AgentProviderCapability.INITIAL_RUN,
  AgentProviderCapability.WORKFLOW_AGENT_STEP,
] as const;

export interface WorkflowRouterConfigPanelProps {
  routerExecutorConfig?: unknown;
  readOnly?: boolean;
  isSaving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (executorConfig: ExecutorConfig) => void;
}

export function WorkflowRouterConfigPanel({
  routerExecutorConfig,
  readOnly = false,
  isSaving = false,
  error,
  onClose,
  onSave,
}: WorkflowRouterConfigPanelProps) {
  const { t } = useTranslation('common');
  const { profiles, config } = useUserSystem();
  const [hasExplicitExecutorSelection, setHasExplicitExecutorSelection] =
    useState(false);
  const storedExecutorConfig = useMemo(
    () => coerceWorkflowNodeExecutorConfig(routerExecutorConfig),
    [routerExecutorConfig]
  );

  useEffect(() => {
    setHasExplicitExecutorSelection(false);
  }, [routerExecutorConfig]);

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

  const policyExecutorSource = useMemo(() => {
    const next = [...executorOptions];
    if (effectiveExecutor && !next.includes(effectiveExecutor)) {
      next.unshift(effectiveExecutor);
    }
    return next;
  }, [effectiveExecutor, executorOptions]);
  const { options: policyExecutorOptions } = useAgentProviderOptions({
    executors: policyExecutorSource,
    requiredCapabilities: WORKFLOW_ROUTER_REQUIRED_CAPABILITIES,
  });

  const isConfigDisabled = readOnly || isSaving;
  const hasStoredExecutorConfig = storedExecutorConfig !== null;
  const hasRouterExecutorSelection =
    hasStoredExecutorConfig || hasExplicitExecutorSelection;
  const selectedRouterExecutor = hasRouterExecutorSelection
    ? effectiveExecutor
    : null;
  const selectedRouterExecutorConfig = hasRouterExecutorSelection
    ? executorConfig
    : null;
  const selectedExecutorOption = useMemo(
    () =>
      selectedRouterExecutor
        ? policyExecutorOptions.find(
            (option) => option.executor === selectedRouterExecutor
          )
        : null,
    [policyExecutorOptions, selectedRouterExecutor]
  );
  const canSave =
    !isConfigDisabled &&
    !!selectedRouterExecutorConfig &&
    selectedExecutorOption?.enabled !== false;

  const handleExecutorSelect = (executor: BaseCodingAgent) => {
    setHasExplicitExecutorSelection(true);
    setExecutor(executor);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-start justify-between gap-base border-b border-secondary p-base">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-high">
            {t('workflow.router.title', {
              defaultValue: 'Router agent',
            })}
          </h2>
          <p className="mt-1 text-xs text-low">
            {t('workflow.router.description', {
              defaultValue:
                'Select the agent that evaluates Condition branches for this workflow.',
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label={t('workflow.router.close', {
            defaultValue: 'Close router settings',
          })}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-base overflow-y-auto p-base">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-high">
            {t('workflow.router.executor', {
              defaultValue: 'Agent',
            })}
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
                agent={selectedRouterExecutor}
                className="size-icon-xl shrink-0"
              />
              <ToolbarDropdown
                label={
                  selectedRouterExecutor
                    ? toPrettyCase(selectedRouterExecutor)
                    : t('workflow.router.selectExecutor', {
                        defaultValue: 'Select agent',
                      })
                }
                disabled={isConfigDisabled}
              >
                <DropdownMenuLabel>
                  {t('workflow.router.agent', {
                    defaultValue: 'Agent',
                  })}
                </DropdownMenuLabel>
                {policyExecutorOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.executor}
                    icon={
                      selectedRouterExecutor === option.executor
                        ? CheckIcon
                        : undefined
                    }
                    disabled={!option.enabled}
                    badge={
                      getAgentProviderBlockedReasonLabel(
                        option.disabledReason
                      ) ?? undefined
                    }
                    onClick={() => handleExecutorSelect(option.executor)}
                  >
                    {toPrettyCase(option.executor)}
                  </DropdownMenuItem>
                ))}
              </ToolbarDropdown>

              {selectedRouterExecutor && selectedRouterExecutorConfig ? (
                <ModelSelectorContainer
                  agent={selectedRouterExecutor}
                  workspaceId={undefined}
                  onAdvancedSettings={() =>
                    SettingsDialog.show({ initialSection: 'agents' })
                  }
                  presets={variantOptions}
                  selectedPreset={selectedVariant}
                  onPresetSelect={setVariant}
                  onOverrideChange={setOverrides}
                  executorConfig={selectedRouterExecutorConfig}
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
        <Button
          disabled={!canSave}
          onClick={() =>
            selectedRouterExecutorConfig && onSave(selectedRouterExecutorConfig)
          }
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('workflow.router.save', {
            defaultValue: 'Save router',
          })}
        </Button>
      </div>
    </aside>
  );
}
