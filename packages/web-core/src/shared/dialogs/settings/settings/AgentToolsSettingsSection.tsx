import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon,
  CopyIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { Switch } from '@vibe/ui/components/Switch';
import type {
  AgentTool,
  AgentToolDefinition,
  AgentToolInventory,
  AgentToolKind,
  AgentToolLocator,
  AgentToolOperationError,
  AgentToolProvider,
  AgentToolScope,
  McpServerDefinition,
  SkillDefinition,
} from 'shared/types';
import { ApiError } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { SettingsCard, SettingsInput } from './SettingsComponents';
import { useSettingsMachineClient } from './SettingsHostContext';

const PROVIDERS: AgentToolProvider[] = [
  'codex',
  'claude_code',
  'gemini',
  'oh_my_pi',
];

const PROVIDER_LABELS: Record<AgentToolProvider, string> = {
  codex: 'Codex',
  claude_code: 'Claude Code',
  gemini: 'Gemini',
  oh_my_pi: 'Oh My Pi',
};

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeUtf8(value: string): string {
  const binary = atob(value);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

function locatorFor(item: AgentTool, projectPath: string): AgentToolLocator {
  return {
    provider: item.provider,
    scope: item.scope,
    kind: item.kind,
    name: item.name,
    native_path: item.native_path,
    project_path: item.scope === 'project' ? projectPath : undefined,
  };
}

function operationMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const apiError = error as ApiError<AgentToolOperationError>;
    const detail = apiError.error_data;
    return detail ? `${detail.message} (${detail.code})` : apiError.message;
  }
  return error instanceof Error ? error.message : 'Agent Tool operation failed';
}

function promptMcpDefinition(
  current?: McpServerDefinition
): McpServerDefinition | null {
  const initial: McpServerDefinition = current ?? {
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    headers: {},
    source_metadata: null,
  };
  const value = window.prompt(
    'Edit the portable MCP definition as JSON.',
    JSON.stringify(initial, null, 2)
  );
  if (value === null) return null;
  return JSON.parse(value) as McpServerDefinition;
}

function promptSkillDefinition(
  current?: SkillDefinition
): SkillDefinition | null {
  const currentContract = current?.files.find(
    (file) => file.path === 'SKILL.md'
  );
  const initial = currentContract
    ? decodeUtf8(currentContract.content_base64)
    : '---\nname: my-skill\ndescription: Describe this Skill\n---\n\n# Instructions\n';
  const value = window.prompt('Edit SKILL.md.', initial);
  if (value === null) return null;
  const files = current?.files.filter((file) => file.path !== 'SKILL.md') ?? [];
  return {
    description: current?.description ?? null,
    files: [{ path: 'SKILL.md', content_base64: encodeUtf8(value) }, ...files],
  };
}

export function AgentToolsSettingsSection() {
  const machineClient = useSettingsMachineClient();
  const [inventory, setInventory] = useState<AgentToolInventory | null>(null);
  const [kind, setKind] = useState<AgentToolKind>('mcp_server');
  const [projectPath, setProjectPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const loadInventory = useCallback(
    async (nextProjectPath?: string) => {
      if (!machineClient) return;
      const sequence = ++refreshSequence.current;
      setLoading(true);
      setError(null);
      try {
        const nextInventory =
          await machineClient.listAgentTools(nextProjectPath);
        if (sequence === refreshSequence.current) {
          setInventory(nextInventory);
        }
      } catch (nextError) {
        if (sequence === refreshSequence.current) {
          setError(operationMessage(nextError));
        }
      } finally {
        if (sequence === refreshSequence.current) {
          setLoading(false);
        }
      }
    },
    [machineClient]
  );

  const refresh = useCallback(
    () => loadInventory(projectPath.trim() || undefined),
    [loadInventory, projectPath]
  );

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const inventories = useMemo(
    () =>
      PROVIDERS.map(
        (provider) =>
          inventory?.providers.find((entry) => entry.provider === provider) ?? {
            provider,
            installed: false,
            items: [],
            limitations: [],
            errors: [],
          }
      ),
    [inventory]
  );
  const installedProviders = useMemo(
    () =>
      inventories
        .filter((providerInventory) => providerInventory.installed)
        .map((providerInventory) => providerInventory.provider),
    [inventories]
  );

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await refresh();
    } catch (nextError) {
      setError(operationMessage(nextError));
    } finally {
      setBusyKey(null);
    }
  };

  const handleAdd = async () => {
    if (!machineClient) return;
    if (installedProviders.length === 0) {
      setError('No supported Agent provider is installed.');
      return;
    }
    const provider = window.prompt(
      `Provider (${installedProviders.join(', ')})`,
      installedProviders[0]
    ) as AgentToolProvider | null;
    if (!provider || !installedProviders.includes(provider)) return;
    const scope = window.prompt(
      'Scope (user or project)',
      'user'
    ) as AgentToolScope | null;
    if (!scope || !['user', 'project'].includes(scope)) return;
    if (scope === 'project' && !projectPath.trim()) {
      setError('Enter an absolute project path before adding a project tool.');
      return;
    }
    const name = window.prompt('Installation name');
    if (!name) return;
    let definition: AgentToolDefinition | null;
    try {
      definition =
        kind === 'mcp_server'
          ? (() => {
              const data = promptMcpDefinition();
              return data ? { type: 'mcp_server', data } : null;
            })()
          : (() => {
              const data = promptSkillDefinition();
              return data ? { type: 'skill', data } : null;
            })();
    } catch (nextError) {
      setNotice(null);
      setError(
        `${kind === 'mcp_server' ? 'Invalid MCP JSON' : 'Invalid Skill definition'}: ${operationMessage(nextError)}`
      );
      return;
    }
    if (!definition) return;
    await run(`add:${provider}:${name}`, () =>
      machineClient.createAgentTool({
        target: {
          provider,
          scope,
          kind,
          name,
          project_path: scope === 'project' ? projectPath.trim() : undefined,
        },
        definition,
        replace: false,
      })
    );
  };

  const handleEdit = async (item: AgentTool) => {
    if (!machineClient) return;
    let definition: AgentToolDefinition | null;
    try {
      definition =
        item.definition.type === 'mcp_server'
          ? (() => {
              const data = promptMcpDefinition(item.definition.data);
              return data ? { type: 'mcp_server', data } : null;
            })()
          : (() => {
              const data = promptSkillDefinition(item.definition.data);
              return data ? { type: 'skill', data } : null;
            })();
    } catch (nextError) {
      setNotice(null);
      setError(
        `${item.kind === 'mcp_server' ? 'Invalid MCP JSON' : 'Invalid Skill definition'}: ${operationMessage(nextError)}`
      );
      return;
    }
    if (!definition) return;
    await run(`edit:${item.provider}:${item.name}`, () =>
      machineClient.updateAgentTool({
        target: locatorFor(item, projectPath.trim()),
        expected_revision: item.revision,
        definition,
      })
    );
  };

  const handleCopy = async (item: AgentTool) => {
    if (!machineClient) return;
    const targets = installedProviders.filter(
      (provider) => provider !== item.provider
    );
    if (targets.length === 0) {
      setError('No other supported Agent provider is installed.');
      return;
    }
    const target = window.prompt(
      `Copy to provider (${targets.join(', ')})`,
      targets[0]
    ) as AgentToolProvider | null;
    if (!target || !targets.includes(target)) return;
    const targetItem = inventory?.providers
      .find((providerInventory) => providerInventory.provider === target)
      ?.items.find(
        (candidate) =>
          candidate.scope === item.scope &&
          candidate.kind === item.kind &&
          candidate.name === item.name
      );
    if (
      targetItem &&
      !window.confirm(
        `${PROVIDER_LABELS[target]} already has ${item.name}. Replace that installation?`
      )
    ) {
      return;
    }
    await run(`copy:${item.provider}:${item.name}`, async () => {
      const result = await machineClient.copyAgentTool({
        source: locatorFor(item, projectPath.trim()),
        expected_revision: item.revision,
        target_provider: target,
        target_scope: item.scope,
        target_project_path:
          item.scope === 'project' ? projectPath.trim() : undefined,
        replace: Boolean(targetItem),
        target_expected_revision: targetItem?.revision,
      });
      if (result.warnings.length) setNotice(result.warnings.join(' '));
    });
  };

  const handleReveal = async (item: AgentTool) => {
    if (!machineClient) return;
    await run(`reveal:${item.provider}:${item.name}`, async () => {
      const result = await machineClient.revealAgentTool(
        locatorFor(item, projectPath.trim())
      );
      await navigator.clipboard.writeText(result.native_path);
      setNotice(`Native path copied: ${result.native_path}`);
    });
  };

  return (
    <SettingsCard
      title="Agent Tools"
      description="Manage native MCP servers and Skills. Provider files remain the source of truth."
      headerAction={
        <div className="flex gap-half">
          <PrimaryButton
            variant="tertiary"
            value="Refresh"
            onClick={() => void refresh()}
            disabled={loading || !machineClient}
            actionIcon={loading ? 'spinner' : undefined}
          />
          <PrimaryButton
            value="Add"
            onClick={() => void handleAdd()}
            disabled={
              !machineClient ||
              busyKey !== null ||
              installedProviders.length === 0
            }
          />
        </div>
      }
    >
      <div className="space-y-2">
        <label
          htmlFor="agent-tools-project-path"
          className="text-sm font-medium text-normal"
        >
          Project path (optional)
        </label>
        <div className="flex gap-2">
          <SettingsInput
            id="agent-tools-project-path"
            value={projectPath}
            onChange={setProjectPath}
            placeholder="Absolute path for project-scoped tools"
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || !machineClient}
            className="rounded-sm border border-border px-3 text-low hover:text-normal disabled:cursor-not-allowed disabled:opacity-40"
            title="Discover project tools"
            aria-label="Discover project tools"
          >
            <ArrowClockwiseIcon className="size-icon-xs" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex border-b border-border" role="tablist">
        {(['mcp_server', 'skill'] as AgentToolKind[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={kind === tab}
            aria-controls="agent-tools-provider-list"
            onClick={() => setKind(tab)}
            className={cn(
              'px-4 py-2 text-sm border-b-2 -mb-px',
              kind === tab
                ? 'border-brand text-brand'
                : 'border-transparent text-low hover:text-normal'
            )}
          >
            {tab === 'mcp_server' ? 'MCP servers' : 'Skills'}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="rounded-sm border border-error/50 bg-error/10 p-3 text-sm text-error"
          role="alert"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="rounded-sm border border-success/50 bg-success/10 p-3 text-sm text-success"
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}

      {inventory === null ? (
        <div
          className="flex items-center gap-2 py-4 text-sm text-low"
          role="status"
        >
          {loading && (
            <SpinnerIcon
              className="size-icon-xs animate-spin"
              aria-hidden="true"
            />
          )}
          {loading
            ? 'Loading Agent Tool inventory...'
            : 'Inventory unavailable.'}
        </div>
      ) : (
        <div
          id="agent-tools-provider-list"
          className="space-y-4"
          role="tabpanel"
        >
          {inventories.map((providerInventory) => {
            const items = providerInventory.items.filter(
              (item) => item.kind === kind
            );
            return (
              <section
                key={providerInventory.provider}
                className="rounded-sm border border-border bg-secondary/20"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-high">
                      {PROVIDER_LABELS[providerInventory.provider]}
                    </span>
                    <span className="ml-2 text-xs text-low">
                      {providerInventory.installed
                        ? 'Installed'
                        : 'Not detected'}
                    </span>
                  </div>
                  <span className="text-xs text-low">{items.length} items</span>
                </div>

                {providerInventory.errors.map((providerError) => (
                  <div
                    key={providerError}
                    className="border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error"
                    role="alert"
                  >
                    {providerError}
                  </div>
                ))}

                {providerInventory.limitations.map((limitation) => (
                  <div
                    key={limitation}
                    className="border-b border-border/60 px-3 py-2 text-xs text-low"
                  >
                    {limitation}
                  </div>
                ))}

                {items.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-low">
                    No {kind === 'mcp_server' ? 'MCP servers' : 'Skills'} found.
                  </div>
                ) : (
                  items.map((item) => {
                    const key = `${item.provider}:${item.scope}:${item.kind}:${item.name}`;
                    const busy = busyKey?.endsWith(
                      `:${item.provider}:${item.name}`
                    );
                    const hasCopyTarget = installedProviders.some(
                      (provider) => provider !== item.provider
                    );
                    return (
                      <div
                        key={`${key}:${item.native_path}`}
                        className="flex flex-col gap-2 border-b border-border/60 px-3 py-3 last:border-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-normal">
                                {item.name}
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
                                {item.state}
                              </span>
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-low">
                                {item.scope}
                              </span>
                            </div>
                            <p className="mt-1 truncate font-mono text-xs text-low">
                              {item.native_path}
                            </p>
                            {item.error && (
                              <p className="mt-1 text-xs text-error">
                                {item.error}
                              </p>
                            )}
                          </div>
                          {busy ? (
                            <span
                              role="status"
                              aria-label={`Updating ${item.name}`}
                            >
                              <SpinnerIcon
                                className="size-icon-xs animate-spin text-low"
                                aria-hidden="true"
                              />
                            </span>
                          ) : (
                            item.capabilities.toggleable &&
                            ['enabled', 'disabled'].includes(item.state) && (
                              <Switch
                                checked={item.state === 'enabled'}
                                disabled={busyKey !== null}
                                aria-label={`Toggle ${item.name}`}
                                onCheckedChange={(enabled) =>
                                  void run(
                                    `toggle:${item.provider}:${item.name}`,
                                    () =>
                                      machineClient!.toggleAgentTool({
                                        target: locatorFor(
                                          item,
                                          projectPath.trim()
                                        ),
                                        expected_revision: item.revision,
                                        enabled,
                                      })
                                  )
                                }
                              />
                            )
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <ToolButton
                            label="Edit"
                            icon={PencilSimpleIcon}
                            disabled={
                              !item.capabilities.editable ||
                              item.state !== 'enabled' ||
                              busyKey !== null
                            }
                            onClick={() => void handleEdit(item)}
                          />
                          <ToolButton
                            label="Copy"
                            icon={CopyIcon}
                            disabled={
                              !item.capabilities.exportable ||
                              item.state !== 'enabled' ||
                              !hasCopyTarget ||
                              busyKey !== null
                            }
                            onClick={() => void handleCopy(item)}
                          />
                          <ToolButton
                            label="Reveal"
                            icon={FolderOpenIcon}
                            disabled={busyKey !== null}
                            onClick={() => void handleReveal(item)}
                          />
                          <ToolButton
                            label="Remove"
                            icon={TrashIcon}
                            danger
                            disabled={
                              !item.capabilities.removable || busyKey !== null
                            }
                            onClick={() => {
                              if (
                                machineClient &&
                                window.confirm(
                                  `Remove ${item.name}? This is distinct from disabling it.`
                                )
                              ) {
                                void run(
                                  `remove:${item.provider}:${item.name}`,
                                  () =>
                                    machineClient.removeAgentTool({
                                      target: locatorFor(
                                        item,
                                        projectPath.trim()
                                      ),
                                      expected_revision: item.revision,
                                    })
                                );
                              }
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: typeof PlusIcon;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs',
        danger
          ? 'text-error hover:bg-error/10'
          : 'text-low hover:bg-secondary hover:text-normal',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      <Icon className="size-icon-2xs" aria-hidden="true" />
      {label}
    </button>
  );
}
