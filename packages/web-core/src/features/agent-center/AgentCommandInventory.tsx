import { useTranslation } from 'react-i18next';
import {
  PencilSimpleIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Switch } from '@vibe/ui/components/Switch';
import type {
  AgentCommandProviderInventoryView,
  AgentCommandView,
} from 'shared/types';
import { cn } from '@/shared/lib/utils';
import { definitionDescription } from './agent-command-model';

export function AgentCommandInventory({
  inventory,
  items,
  searchActive,
  busyKey,
  projectPath,
  onEdit,
  onRemove,
  onToggle,
}: {
  inventory: AgentCommandProviderInventoryView;
  items: AgentCommandView[];
  searchActive: boolean;
  busyKey: string | null;
  projectPath: string;
  onEdit: (item: AgentCommandView) => void;
  onRemove: (item: AgentCommandView) => void;
  onToggle: (item: AgentCommandView, enabled: boolean) => void;
}) {
  const { t } = useTranslation('common');

  return (
    <section className="rounded-sm border border-border bg-secondary/20">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-high">
          {t(
            inventory.installed
              ? 'agentCenter.commands.states.installed'
              : 'agentCenter.commands.states.notDetected'
          )}
        </span>
        <span className="text-xs text-low">
          {t('agentCenter.commands.itemCount', { count: items.length })}
        </span>
      </div>

      {inventory.errors.map((providerError) => (
        <div
          key={providerError}
          className="border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {t('agentCenter.commands.errors.operationFailed')}
        </div>
      ))}

      {inventory.limitations.length > 0 && (
        <div className="border-b border-border/60 px-3 py-2 text-xs text-low">
          {t(`agentCenter.commands.limitations.${inventory.provider}`)}
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-3 py-4 text-sm text-low">
          {t(
            searchActive
              ? 'agentCenter.commands.empty.search'
              : 'agentCenter.commands.empty.commands'
          )}
        </div>
      ) : (
        items.map((item) => {
          const busy = busyKey === `toggle:${item.installation_id}`;
          const description = definitionDescription(item.definition);
          const hasActions =
            item.capabilities.editable || item.capabilities.removable;
          return (
            <div
              key={item.installation_id}
              className="border-b border-border/60 p-3 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-high">
                      /{item.name}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs',
                        item.state === 'enabled'
                          ? 'bg-success/10 text-success'
                          : item.state === 'error'
                            ? 'bg-error/10 text-error'
                            : 'bg-secondary text-low'
                      )}
                    >
                      {t(`agentCenter.commands.commandStates.${item.state}`)}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-low">
                      {t(`agentCenter.commands.scopes.${item.scope}`)}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-low">
                      {t(`agentCenter.commands.formats.${item.format}`)}
                    </span>
                    {!hasActions && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-low">
                        {t('agentCenter.commands.states.readOnly')}
                      </span>
                    )}
                  </div>
                  {description && (
                    <p className="mt-1 text-xs text-low">{description}</p>
                  )}
                  {item.definition.type === 'oh_my_pi_executable' && (
                    <p className="mt-1 text-xs text-low">
                      {t(
                        item.definition.data.entrypoint_configured
                          ? 'agentCenter.commands.summaries.entrypointConfigured'
                          : 'agentCenter.commands.summaries.entrypointUnavailable'
                      )}
                    </p>
                  )}
                  {item.definition.type === 'invalid' && (
                    <p className="mt-1 text-xs text-error">
                      {t('agentCenter.commands.summaries.invalidDefinition')}
                    </p>
                  )}
                  {item.error && item.definition.type !== 'invalid' && (
                    <p className="mt-1 text-xs text-error">
                      {t('agentCenter.commands.summaries.invalidDefinition')}
                    </p>
                  )}
                </div>
                {busy ? (
                  <SpinnerIcon
                    className="size-icon-xs animate-spin text-low"
                    aria-label={t('agentCenter.commands.states.updating', {
                      name: item.name,
                    })}
                  />
                ) : (
                  item.capabilities.toggleable &&
                  (item.state === 'enabled' || item.state === 'disabled') && (
                    <Switch
                      checked={item.state === 'enabled'}
                      disabled={busyKey !== null}
                      aria-label={t('agentCenter.commands.actions.toggle', {
                        name: item.name,
                      })}
                      onCheckedChange={(enabled) => onToggle(item, enabled)}
                    />
                  )
                )}
              </div>

              {hasActions && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.capabilities.editable && (
                    <CommandButton
                      label={t('agentCenter.commands.actions.edit')}
                      icon={PencilSimpleIcon}
                      disabled={busyKey !== null}
                      onClick={() => onEdit(item)}
                    />
                  )}
                  {item.capabilities.removable && (
                    <CommandButton
                      label={t('agentCenter.commands.actions.remove')}
                      icon={TrashIcon}
                      danger
                      disabled={
                        busyKey !== null ||
                        (item.scope === 'project' && !projectPath)
                      }
                      onClick={() => onRemove(item)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

function CommandButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: typeof PlusIcon;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-11 items-center gap-1 rounded-sm px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'text-error hover:bg-error/10'
          : 'text-low hover:bg-secondary hover:text-normal'
      )}
    >
      <Icon className="size-icon-2xs" aria-hidden="true" />
      {label}
    </button>
  );
}
