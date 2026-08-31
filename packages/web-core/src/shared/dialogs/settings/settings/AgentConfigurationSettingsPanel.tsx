import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { Switch } from '@vibe/ui/components/Switch';
import {
  AgentSettingsProvider,
  BaseCodingAgent,
  SettingScope,
} from 'shared/types';
import type {
  ConfigProfile,
  JsonValue,
  ProfileApplyPreviewRequest,
  ProfileCopyPreview,
  SettingDescriptor,
  SettingsDiff,
  SettingsPatch,
  SettingsSnapshot,
} from 'shared/types';
import {
  agentSettingSourceKind,
  buildAgentSettingsPatch,
  buildAgentSettingsSections,
  createAgentSettingsDraft,
  formatProfileEnvironment,
  hasChangedFiles,
  hasDraftErrors,
  isRevealResponseCurrent,
  isAgentSettingsDraftDirty,
  nativeFileRevision,
  parseSettingInput,
  parseProfileCustomArgs,
  parseProfileEnvironment,
  profileEnvironmentFromSnapshot,
  PROVIDER_BY_EXECUTOR,
  PROVIDER_LABELS,
  settingSourceForScope,
  settingKeyId,
  type AgentSettingsDraft,
} from '@/shared/lib/agentSettingsModel';
import { formatAgentSettingOperationError } from '@/shared/lib/machineClient';
import { cn } from '@/shared/lib/utils';
import { AgentToolsSettingsSection } from './AgentToolsSettingsSection';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsSaveBar,
  SettingsTextarea,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';
import { useSettingsMachineClient } from './SettingsHostContext';

type PendingAction =
  | { kind: 'settings'; patch: SettingsPatch }
  | { kind: 'profile'; preview: ProfileApplyPreviewRequest };

type RevealedSetting = {
  id: string;
  value: string;
};

type ProfileEditorDraft = {
  id: string;
  name: string;
  environmentRaw: string;
  customArgsRaw: string;
};

function newProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function executorForProvider(provider: AgentSettingsProvider): BaseCodingAgent {
  switch (provider) {
    case AgentSettingsProvider.claude_code:
      return BaseCodingAgent.CLAUDE_CODE;
    case AgentSettingsProvider.gemini:
      return BaseCodingAgent.GEMINI;
    case AgentSettingsProvider.oh_my_pi:
      return BaseCodingAgent.OH_MY_PI;
    default:
      return BaseCodingAgent.CODEX;
  }
}

function displayJson(value: JsonValue | undefined): string {
  if (value === undefined) return 'Inherited / not set';
  return JSON.stringify(value, null, 2);
}

function sourceLabelKind(
  snapshot: SettingsSnapshot,
  descriptor: SettingDescriptor,
  entry: AgentSettingsDraft[string] | undefined
): ReturnType<typeof agentSettingSourceKind> | 'modified' | 'inherit' {
  if (entry?.action === 'replace') return 'modified';
  if (entry?.action === 'clear') return 'inherit';
  const setting = snapshot.effective_settings.find(
    (candidate) => settingKeyId(candidate) === settingKeyId(descriptor)
  );
  return agentSettingSourceKind(setting?.effective_source);
}

function parseDraftChange(
  descriptor: SettingDescriptor,
  raw: string,
  value?: JsonValue
): { value?: JsonValue; error?: string } {
  if (descriptor.control === 'select') {
    return parseSettingInput(descriptor, raw);
  }
  if (descriptor.control === 'toggle') return { value };
  return parseSettingInput(descriptor, raw);
}

export function AgentConfigurationSettingsPanel({
  executor,
  variant,
  includeTools = true,
}: {
  executor: BaseCodingAgent;
  variant: string | null;
  includeTools?: boolean;
}) {
  const { t } = useTranslation('common');
  const sourceLabel = (kind: ReturnType<typeof sourceLabelKind>): string => {
    switch (kind) {
      case 'modified':
        return 'Modified';
      case 'inherit':
        return t('agentCenter.inheritedOrUnset');
      case 'native_user':
        return t('agentCenter.configurationSources.nativeUser');
      case 'native_project':
        return t('agentCenter.configurationSources.nativeProject');
      case 'adapter_managed':
        return t('agentCenter.adapterManaged');
      default:
        return t('agentCenter.inheritedOrUnset');
    }
  };
  const machineClient = useSettingsMachineClient();
  const { setDirty: setContextDirty } = useSettingsDirty();
  const provider =
    PROVIDER_BY_EXECUTOR[executor] ?? AgentSettingsProvider.codex;
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<AgentSettingsDraft>({});
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [scope, setScope] = useState<SettingScope>(SettingScope.user);
  const [projectPath, setProjectPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diff, setDiff] = useState<SettingsDiff | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [copyPreview, setCopyPreview] = useState<ProfileCopyPreview | null>(
    null
  );
  const [revealedSetting, setRevealedSetting] =
    useState<RevealedSetting | null>(null);
  const [visibleReplacementIds, setVisibleReplacementIds] = useState<
    Record<string, boolean>
  >({});
  const [revealingSettingId, setRevealingSettingId] = useState<string | null>(
    null
  );
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({});
  const [profileEnvironmentRaw, setProfileEnvironmentRaw] = useState('{}');
  const [profileCustomArgsRaw, setProfileCustomArgsRaw] = useState('');
  const [profileFieldsDirty, setProfileFieldsDirty] = useState(false);
  const [profileEditor, setProfileEditor] = useState<ProfileEditorDraft | null>(
    null
  );
  const requestSequence = useRef(0);
  const revealRequestSequence = useRef(0);
  const activeMachineClient = useRef(machineClient);

  const clearSensitiveVisibility = useCallback(() => {
    revealRequestSequence.current += 1;
    setRevealedSetting(null);
    setVisibleReplacementIds({});
    setRevealingSettingId(null);
    setRevealErrors({});
  }, []);

  const hideSensitiveSetting = useCallback((id: string) => {
    revealRequestSequence.current += 1;
    setRevealedSetting((current) => (current?.id === id ? null : current));
    setVisibleReplacementIds((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setRevealingSettingId((current) => (current === id ? null : current));
    setRevealErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    activeMachineClient.current = machineClient;
    clearSensitiveVisibility();
  }, [
    activeSection,
    clearSensitiveVisibility,
    machineClient,
    projectPath,
    provider,
    scope,
  ]);

  const loadSettings = useCallback(
    async (nextProjectPath?: string) => {
      if (!machineClient) return;
      const sequence = ++requestSequence.current;
      setLoading(true);
      setError(null);
      try {
        const inventory = await machineClient.discoverAgentSettings({
          provider,
          project_path: nextProjectPath || null,
        });
        if (sequence !== requestSequence.current) return;
        const next =
          inventory.providers.find(
            (candidate) => candidate.provider === provider
          ) ?? null;
        setSnapshot(next);
        setDraft(next ? createAgentSettingsDraft(next) : {});
        setProfileEnvironmentRaw(
          formatProfileEnvironment(profileEnvironmentFromSnapshot(next))
        );
        setProfileCustomArgsRaw('');
        setProfileFieldsDirty(false);
        setProfileEditor(null);
        setDiff(null);
        setPending(null);
        if (inventory.errors.length > 0 && !next) {
          setError(inventory.errors.map((item) => item.message).join(' '));
        }
      } catch (nextError) {
        if (sequence === requestSequence.current) {
          setError(formatAgentSettingOperationError(nextError));
          setSnapshot(null);
          setDraft({});
          setProfileEnvironmentRaw('{}');
          setProfileCustomArgsRaw('');
          setProfileFieldsDirty(false);
          setProfileEditor(null);
        }
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    },
    [machineClient, provider]
  );

  const loadProfiles = useCallback(async () => {
    if (!machineClient) return;
    setProfilesLoading(true);
    try {
      setProfiles(await machineClient.listAgentSettingsProfiles({ provider }));
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setProfilesLoading(false);
    }
  }, [machineClient, provider]);

  useEffect(() => {
    setSnapshot(null);
    setDraft({});
    setActiveSection('overview');
    void loadSettings();
    void loadProfiles();
  }, [loadProfiles, loadSettings]);

  const sections = useMemo(() => {
    const nextSections = buildAgentSettingsSections(snapshot);
    return nextSections.filter(
      (section) =>
        // Raw native files can mix ordinary settings with credentials. Keep
        // typed Adapter fields available, but fail closed on raw editing until
        // discovery can return a redacted/write-only contract.
        section.id !== 'native_files' &&
        (includeTools || section.id !== 'tools')
    );
  }, [includeTools, snapshot]);

  useEffect(() => {
    if (
      sections.length > 0 &&
      !sections.some((section) => section.id === activeSection)
    ) {
      setActiveSection(sections[0].id);
    }
  }, [activeSection, sections]);

  useEffect(() => {
    if (!projectPath.trim() && scope === SettingScope.project) {
      setScope(SettingScope.user);
    }
  }, [projectPath, scope]);

  const projectScopeSupported = Boolean(
    snapshot?.descriptors.some((descriptor) =>
      descriptor.supported_scopes.includes(SettingScope.project)
    )
  );

  useEffect(() => {
    if (!projectScopeSupported && scope === SettingScope.project) {
      setScope(SettingScope.user);
    }
  }, [projectScopeSupported, scope]);

  const draftDirty = isAgentSettingsDraftDirty(draft);
  const profileEnvironment = useMemo(
    () => parseProfileEnvironment(profileEnvironmentRaw),
    [profileEnvironmentRaw]
  );
  const profileEditorEnvironment = useMemo(
    () =>
      profileEditor
        ? parseProfileEnvironment(profileEditor.environmentRaw)
        : { value: {} as Record<string, string> },
    [profileEditor]
  );
  const profileEditorDirty = useMemo(() => {
    if (!profileEditor) return false;
    const original = profiles.find(
      (profile) => profile.id === profileEditor.id
    );
    if (!original) return false;
    return (
      profileEditor.name !== original.name ||
      profileEditor.environmentRaw !==
        formatProfileEnvironment(original.environment) ||
      profileEditor.customArgsRaw !== original.custom_args.join('\n')
    );
  }, [profileEditor, profiles]);
  const isDirty = draftDirty || profileFieldsDirty || profileEditorDirty;

  useEffect(() => {
    setContextDirty(`agent-settings:${provider}`, isDirty);
    return () => setContextDirty(`agent-settings:${provider}`, false);
  }, [isDirty, provider, setContextDirty]);

  const applySnapshot = (next: SettingsSnapshot) => {
    setSnapshot(next);
    setDraft(createAgentSettingsDraft(next));
    setDiff(null);
    setPending(null);
  };

  const patch = useMemo(
    () =>
      snapshot
        ? buildAgentSettingsPatch(
            snapshot,
            draft,
            scope,
            projectPath.trim() || undefined
          )
        : null,
    [draft, projectPath, scope, snapshot]
  );

  const previewSettings = async () => {
    if (!machineClient || !patch || !snapshot) return;
    if (hasDraftErrors(draft)) {
      setError('Fix the invalid setting values before previewing the diff.');
      return;
    }
    if (patch.operations.length === 0) {
      setNotice('No setting changes to apply.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nextDiff = await machineClient.diffAgentSettings(patch);
      setDiff(nextDiff);
      setPending({ kind: 'settings', patch });
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!machineClient || !pending) return;
    setBusy(true);
    setError(null);
    try {
      let nextSnapshot: SettingsSnapshot;
      if (pending.kind === 'settings') {
        nextSnapshot = await machineClient.applyAgentSettings({
          patch: pending.patch,
          confirmed: true,
        });
      } else {
        nextSnapshot = await machineClient.applyAgentSettingsProfile({
          preview: pending.preview,
          confirmed: true,
        });
      }
      applySnapshot(nextSnapshot);
      await loadProfiles();
      setNotice(
        'Agent settings applied. Changes marked for a new session take effect on the next launch.'
      );
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = () => {
    if (snapshot) setDraft(createAgentSettingsDraft(snapshot));
    setDiff(null);
    setPending(null);
    setNotice(null);
    setError(null);
  };

  const updateDraft = (
    descriptor: SettingDescriptor,
    raw: string,
    value?: JsonValue,
    parseError?: string
  ) => {
    const id = settingKeyId(descriptor);
    setDraft((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        action:
          raw.length === 0 && descriptor.sensitive ? 'preserve' : 'replace',
        raw,
        value,
        error: parseError,
      },
    }));
    setDiff(null);
    setPending(null);
  };

  const resetDraft = (descriptor: SettingDescriptor) => {
    const id = settingKeyId(descriptor);
    hideSensitiveSetting(id);
    setDraft((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        action: 'clear',
        raw: '',
        value: undefined,
        error: undefined,
      },
    }));
    setDiff(null);
    setPending(null);
  };

  const revealSensitiveSetting = async (descriptor: SettingDescriptor) => {
    if (!machineClient || !snapshot) return;
    const id = settingKeyId(descriptor);
    const source = settingSourceForScope(snapshot, descriptor, scope);
    if (!source?.configured) return;
    const client = machineClient;
    const expectedRevision = source.revision;
    const sequence = ++revealRequestSequence.current;
    setRevealedSetting(null);
    setRevealingSettingId(id);
    setRevealErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const result = await client.revealAgentSetting({
        provider,
        project_path: projectPath.trim() || null,
        key: descriptor.key,
        scope,
        expected_revision: expectedRevision,
      });
      if (
        !isRevealResponseCurrent({
          requestSequence: sequence,
          currentSequence: revealRequestSequence.current,
          requestClient: client,
          currentClient: activeMachineClient.current,
          settingId: id,
          scope,
          expectedRevision,
          response: result,
        })
      ) {
        return;
      }
      setRevealedSetting({ id, value: result.value });
    } catch (nextError) {
      if (
        sequence === revealRequestSequence.current &&
        activeMachineClient.current === client
      ) {
        setRevealErrors((current) => ({
          ...current,
          [id]: formatAgentSettingOperationError(nextError),
        }));
      }
    } finally {
      if (
        sequence === revealRequestSequence.current &&
        activeMachineClient.current === client
      ) {
        setRevealingSettingId(null);
      }
    }
  };

  const saveProfile = async () => {
    if (!machineClient || !snapshot) return;
    if (!profileEnvironment.value) {
      setError(profileEnvironment.error ?? 'Invalid profile environment.');
      return;
    }
    const name = window.prompt('Profile name');
    if (!name?.trim()) return;
    const settingOverrides: Record<string, JsonValue> = {};
    for (const descriptor of snapshot.descriptors) {
      if (!descriptor.capabilities.profile_storable) continue;
      const entry = draft[settingKeyId(descriptor)];
      if (entry?.action === 'clear') continue;
      if (descriptor.sensitive && entry?.action !== 'replace') continue;
      const effectiveValue = snapshot.effective_settings.find(
        (candidate) => settingKeyId(candidate) === settingKeyId(descriptor)
      )?.effective_value;
      const value =
        entry?.action === 'replace' && entry.value !== undefined
          ? entry.value
          : effectiveValue;
      if (value !== undefined)
        settingOverrides[settingKeyId(descriptor)] = value;
    }
    setBusy(true);
    setError(null);
    try {
      await machineClient.saveAgentSettingsProfile({
        profile: {
          id: newProfileId(),
          provider,
          executor_profile: {
            executor,
            variant: variant === 'DEFAULT' ? null : variant,
          },
          name: name.trim(),
          schema_version: 1,
          setting_overrides: settingOverrides,
          provider_extensions: {},
          environment: profileEnvironment.value,
          custom_args: parseProfileCustomArgs(profileCustomArgsRaw),
          updated_at: new Date().toISOString(),
        },
      });
      await loadProfiles();
      setProfileFieldsDirty(false);
      setNotice(
        'Profile saved locally. It remains inactive until explicitly applied.'
      );
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const editProfile = (profile: ConfigProfile) => {
    setProfileEditor({
      id: profile.id,
      name: profile.name,
      environmentRaw: formatProfileEnvironment(profile.environment),
      customArgsRaw: profile.custom_args.join('\n'),
    });
  };

  const saveProfileEdits = async (profile: ConfigProfile) => {
    if (
      !machineClient ||
      !profileEditor ||
      profileEditor.id !== profile.id ||
      !profileEditor.name.trim()
    ) {
      return;
    }
    if (!profileEditorEnvironment.value) {
      setError(
        profileEditorEnvironment.error ?? 'Invalid profile environment.'
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await machineClient.saveAgentSettingsProfile({
        profile: {
          ...profile,
          name: profileEditor.name.trim(),
          environment: profileEditorEnvironment.value,
          custom_args: parseProfileCustomArgs(profileEditor.customArgsRaw),
          updated_at: new Date().toISOString(),
        },
      });
      setProfileEditor(null);
      await loadProfiles();
      setNotice('Profile updated.');
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const duplicateProfile = async (profile: ConfigProfile) => {
    if (!machineClient) return;
    const name = window.prompt('New profile name', `${profile.name} copy`);
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await machineClient.duplicateAgentSettingsProfile({
        id: profile.id,
        name: name.trim(),
      });
      await loadProfiles();
      setNotice('Profile duplicated.');
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const deleteProfile = async (profile: ConfigProfile) => {
    if (!machineClient || !window.confirm(`Delete profile "${profile.name}"?`))
      return;
    setBusy(true);
    try {
      await machineClient.deleteAgentSettingsProfile({ id: profile.id });
      await loadProfiles();
      setNotice('Profile deleted.');
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const previewProfileApply = async (profile: ConfigProfile) => {
    if (!machineClient || !snapshot) return;
    const expected_file_revisions = Object.fromEntries(
      snapshot.native_files.map((file) => [file.id, nativeFileRevision(file)])
    );
    const request: ProfileApplyPreviewRequest = {
      id: profile.id,
      project_path: projectPath.trim() || null,
      scope,
      expected_file_revisions,
    };
    setBusy(true);
    setError(null);
    try {
      const nextDiff =
        await machineClient.previewAgentSettingsProfileApply(request);
      setDiff(nextDiff);
      setPending({ kind: 'profile', preview: request });
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const previewProfileCopy = async (profile: ConfigProfile) => {
    if (!machineClient) return;
    const target = window.prompt(
      'Target provider (codex, claude_code, gemini, oh_my_pi)',
      'codex'
    );
    if (
      !target ||
      !Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, target)
    )
      return;
    const targetName = window.prompt(
      'Copied profile name',
      `${profile.name} (${PROVIDER_LABELS[target as AgentSettingsProvider]})`
    );
    if (!targetName?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const preview = await machineClient.previewAgentSettingsProfileCopy({
        id: profile.id,
        target_provider: target as AgentSettingsProvider,
        target_executor_profile: {
          executor: executorForProvider(target as AgentSettingsProvider),
          variant: null,
        },
        target_name: targetName.trim(),
      });
      setCopyPreview(preview);
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const saveCopiedProfile = async () => {
    if (!machineClient || !copyPreview) return;
    setBusy(true);
    try {
      await machineClient.saveAgentSettingsProfile({
        profile: copyPreview.profile,
      });
      setCopyPreview(null);
      await loadProfiles();
      setNotice(
        'Copied profile saved. Provider-specific fields were not transferred.'
      );
    } catch (nextError) {
      setError(formatAgentSettingOperationError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const renderOverview = () => (
    <SettingsCard
      title={`${PROVIDER_LABELS[provider]} settings`}
      description="Native provider files remain authoritative. Discovery is read-only until you preview and confirm an Apply action."
      headerAction={
        <PrimaryButton
          variant="tertiary"
          value="Refresh"
          onClick={() => void loadSettings(projectPath.trim() || undefined)}
          disabled={loading || !machineClient}
          actionIcon={loading ? 'spinner' : undefined}
        />
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <InfoTile
          label="Installed"
          value={snapshot?.installed ? 'Yes' : 'Not detected'}
        />
        <InfoTile
          label="Version"
          value={snapshot?.provider_version ?? 'Unknown'}
        />
        <InfoTile
          label="Executable"
          value={snapshot?.executable_path ?? 'Not found'}
          mono
        />
      </div>
      <SettingsField
        label="Project path (optional)"
        description="Provide an absolute project path to discover project-scoped native settings."
      >
        <div className="flex gap-2">
          <SettingsInput
            value={projectPath}
            onChange={setProjectPath}
            placeholder="/absolute/path/to/project"
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-sm border border-border px-3 text-low hover:text-normal disabled:opacity-40"
            aria-label="Discover project settings"
            disabled={busy || loading}
            onClick={() => void loadSettings(projectPath.trim() || undefined)}
          >
            <ArrowClockwiseIcon className="size-icon-xs" aria-hidden="true" />
          </button>
        </div>
      </SettingsField>
      <SettingsField
        label="Apply scope"
        description="Typed changes and profile applications target this native scope."
      >
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as SettingScope)}
          disabled={busy}
          className="w-full rounded-sm border border-border bg-secondary px-base py-half text-sm text-high focus:outline-none focus:ring-1 focus:ring-brand"
        >
          <option value={SettingScope.user}>User configuration</option>
          <option
            value={SettingScope.project}
            disabled={!projectPath.trim() || !projectScopeSupported}
          >
            Project configuration
          </option>
        </select>
      </SettingsField>
      <div className="flex flex-wrap gap-2" aria-label="Settings capabilities">
        {snapshot &&
          Object.entries(snapshot.capabilities).map(([key, enabled]) => (
            <span
              key={key}
              className="rounded bg-secondary px-2 py-1 text-xs text-low"
            >
              {key.replaceAll('_', ' ')}:{' '}
              {enabled ? 'available' : 'unsupported'}
            </span>
          ))}
      </div>
      {snapshot && !snapshot.installed && (
        <div className="flex items-start gap-2 rounded-sm border border-border bg-secondary/30 p-3 text-sm text-low">
          <WarningCircleIcon
            className="mt-0.5 size-icon-sm shrink-0"
            aria-hidden="true"
          />
          This provider is not installed on the selected machine. Settings are
          shown only when the Adapter can discover them.
        </div>
      )}
      {snapshot?.limitations.map((limitation) => (
        <div
          key={limitation}
          className="rounded-sm border border-border bg-secondary/20 p-3 text-xs text-low"
        >
          {limitation}
        </div>
      ))}
      {snapshot?.errors.map((item) => (
        <div
          key={`${item.file_id ?? ''}:${item.setting_key ?? ''}:${item.message}`}
          className="rounded-sm border border-error/40 bg-error/10 p-3 text-sm text-error"
          role="alert"
        >
          {item.message} {item.recovery}
        </div>
      ))}
      {snapshot?.native_files.length ? (
        <div
          className="rounded-sm border border-border bg-secondary/30 p-3 text-sm text-low"
          role="status"
        >
          {t('agentCenter.security.nativeFilesUnavailable')}
        </div>
      ) : null}
    </SettingsCard>
  );

  const renderSettings = (descriptors: SettingDescriptor[]) => (
    <SettingsCard
      title={
        sections.find((section) => section.id === activeSection)?.label ??
        'Settings'
      }
      description="Fields are generated from the installed provider Adapter. Unsupported controls are omitted."
    >
      <div className="space-y-5">
        {descriptors.map((descriptor) => {
          const id = settingKeyId(descriptor);
          const entry = draft[id] ?? { action: 'preserve' as const, raw: '' };
          const resettable = descriptor.capabilities.resettable;
          const scopeSupported = descriptor.supported_scopes.includes(scope);
          const disabled =
            !descriptor.capabilities.writable || busy || !scopeSupported;
          const selectValue =
            entry.value === undefined ? '' : JSON.stringify(entry.value);
          const update = (raw: string, nextValue?: JsonValue) => {
            const parsed = parseDraftChange(descriptor, raw, nextValue);
            updateDraft(descriptor, raw, parsed.value, parsed.error);
          };
          if (descriptor.sensitive) {
            const configured = Boolean(
              snapshot &&
                settingSourceForScope(snapshot, descriptor, scope)?.configured
            );
            const viewingStoredValue = revealedSetting?.id === id;
            const replacementVisible = Boolean(visibleReplacementIds[id]);
            const valueVisible = viewingStoredValue || replacementVisible;
            const canToggleVisibility =
              (entry.action === 'preserve' && configured) ||
              (entry.action === 'replace' && entry.raw.length > 0);
            const revealLoading = revealingSettingId === id;
            return (
              <SettingsField
                key={id}
                label={descriptor.label}
                description={descriptor.description}
                error={entry.error ?? revealErrors[id]}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-low">
                  <span>
                    {configured
                      ? t('agentCenter.security.sensitiveValueConfigured')
                      : t('agentCenter.security.sensitiveValueNotConfigured')}
                  </span>
                  {configured && descriptor.capabilities.resettable && (
                    <button
                      type="button"
                      className="underline hover:text-normal disabled:opacity-40"
                      disabled={disabled}
                      onClick={() => {
                        hideSensitiveSetting(id);
                        resetDraft(descriptor);
                      }}
                    >
                      {t('agentCenter.security.clearSensitiveValue')}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id={`agent-setting-${id.replaceAll('.', '-')}`}
                    type={valueVisible ? 'text' : 'password'}
                    value={
                      viewingStoredValue ? revealedSetting.value : entry.raw
                    }
                    onChange={(event) => {
                      hideSensitiveSetting(id);
                      update(event.target.value);
                    }}
                    placeholder={
                      configured && entry.action === 'preserve'
                        ? t(
                            'agentCenter.security.sensitiveValueConfiguredPlaceholder'
                          )
                        : undefined
                    }
                    disabled={disabled}
                    readOnly={viewingStoredValue}
                    autoComplete="new-password"
                    className={cn(
                      'w-full rounded-sm border border-border bg-secondary px-base py-half pr-10 font-mono text-sm text-high',
                      'placeholder:text-low placeholder:opacity-80 focus:outline-none focus:ring-1 focus:ring-brand',
                      disabled && 'cursor-not-allowed opacity-50'
                    )}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-low hover:bg-panel hover:text-normal disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t(
                      valueVisible
                        ? 'agentCenter.security.hideSensitiveValue'
                        : 'agentCenter.security.showSensitiveValue'
                    )}
                    disabled={
                      busy ||
                      !scopeSupported ||
                      revealLoading ||
                      !canToggleVisibility
                    }
                    onClick={() => {
                      if (valueVisible) {
                        hideSensitiveSetting(id);
                      } else if (entry.action === 'replace') {
                        setVisibleReplacementIds((current) => ({
                          ...current,
                          [id]: true,
                        }));
                      } else {
                        void revealSensitiveSetting(descriptor);
                      }
                    }}
                  >
                    {revealLoading ? (
                      <SpinnerIcon
                        className="size-icon-sm animate-spin"
                        aria-hidden="true"
                      />
                    ) : valueVisible ? (
                      <EyeSlashIcon
                        className="size-icon-sm"
                        aria-hidden="true"
                      />
                    ) : (
                      <EyeIcon className="size-icon-sm" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <div className="text-xs text-low">
                  {t('agentCenter.security.writeOnlySettingHelp')}
                </div>
              </SettingsField>
            );
          }
          return (
            <SettingsField
              key={id}
              label={descriptor.label}
              description={descriptor.description}
              error={entry.error}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-low">
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    {sourceLabel(sourceLabelKind(snapshot!, descriptor, entry))}
                  </span>
                  <span className="ml-2">
                    {descriptor.activation.replaceAll('_', ' ')}
                  </span>
                </span>
                {resettable && (
                  <button
                    type="button"
                    className="text-xs text-low underline hover:text-normal disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => resetDraft(descriptor)}
                  >
                    Restore inheritance
                  </button>
                )}
              </div>
              {!scopeSupported && (
                <div className="text-xs text-low">
                  This setting is not available in the {scope} scope.
                </div>
              )}
              {descriptor.control === 'toggle' ? (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={
                      entry.action === 'clear' ? false : Boolean(entry.value)
                    }
                    disabled={disabled}
                    aria-label={descriptor.label}
                    onCheckedChange={(checked) =>
                      update(checked ? 'true' : 'false', checked)
                    }
                  />
                  <span className="text-sm text-normal">
                    {entry.value ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              ) : descriptor.control === 'select' ? (
                <select
                  value={selectValue}
                  disabled={disabled}
                  aria-label={descriptor.label}
                  onChange={(event) => update(event.target.value)}
                  className="w-full rounded-sm border border-border bg-secondary px-base py-half text-sm text-high focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  <option value="">Follow native config</option>
                  {descriptor.options.map((option) => (
                    <option
                      key={JSON.stringify(option.value)}
                      value={JSON.stringify(option.value)}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : descriptor.control === 'textarea' ||
                descriptor.control === 'string_list' ||
                descriptor.control === 'key_value' ||
                descriptor.control === 'json' ? (
                <SettingsTextarea
                  value={entry.raw}
                  onChange={(raw) => update(raw)}
                  disabled={disabled}
                  rows={
                    descriptor.control === 'json' ||
                    descriptor.control === 'key_value'
                      ? 5
                      : 3
                  }
                  monospace={
                    descriptor.control === 'json' ||
                    descriptor.control === 'key_value'
                  }
                />
              ) : (
                <SettingsInput
                  value={entry.raw}
                  onChange={(raw) => update(raw)}
                  disabled={disabled}
                  error={Boolean(entry.error)}
                />
              )}
            </SettingsField>
          );
        })}
      </div>
      <SettingsSaveBar
        show={draftDirty}
        saving={busy}
        saveDisabled={
          hasDraftErrors(draft) || !snapshot?.capabilities.native_writable
        }
        onSave={() => void previewSettings()}
        onDiscard={discardDraft}
      />
    </SettingsCard>
  );

  const renderEffective = () => (
    <SettingsCard
      title="Effective Config"
      description="The Adapter resolves precedence and reports observed sources. The UI does not recompute provider precedence."
    >
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/50 text-low">
            <tr>
              <th className="px-3 py-2">Setting</th>
              <th className="px-3 py-2">Effective</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Observed sources</th>
            </tr>
          </thead>
          <tbody>
            {snapshot?.effective_settings.map((setting) => (
              <tr
                key={settingKeyId(setting)}
                className="border-t border-border/60 align-top"
              >
                <td className="px-3 py-2 font-mono text-normal">
                  {settingKeyId(setting)}
                </td>
                <td className="max-w-[18rem] whitespace-pre-wrap px-3 py-2 font-mono text-normal">
                  {snapshot.descriptors.some(
                    (descriptor) =>
                      settingKeyId(descriptor) === settingKeyId(setting) &&
                      descriptor.sensitive
                  )
                    ? t('agentCenter.security.effectiveValueHidden')
                    : displayJson(setting.effective_value)}
                </td>
                <td className="px-3 py-2 text-low">
                  {sourceLabel(
                    agentSettingSourceKind(setting.effective_source)
                  )}
                </td>
                <td className="px-3 py-2 text-low">
                  {setting.sources.length
                    ? setting.sources
                        .map(
                          (source) =>
                            `${sourceLabel(agentSettingSourceKind(source.source))} (${source.scope})`
                        )
                        .join(', ')
                    : t('agentCenter.inheritedOrUnset')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {snapshot?.unknown_native_nodes.length ? (
        <details className="rounded-sm border border-border bg-secondary/20 p-3">
          <summary className="cursor-pointer text-sm text-normal">
            Unknown native nodes ({snapshot.unknown_native_nodes.length})
          </summary>
          <div className="mt-3 space-y-2">
            {snapshot.unknown_native_nodes.map((node) => (
              <div
                key={`${node.file_id}:${node.native_path}`}
                className="font-mono text-xs text-low"
              >
                {node.file_id}:{node.native_path} ={' '}
                {t('agentCenter.security.unknownValueHidden')}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </SettingsCard>
  );

  const renderProfiles = () => (
    <SettingsCard
      title="Configuration Profiles"
      description="Profiles are versioned local definitions. Applying one is explicit and previews its native diff first."
      headerAction={
        <PrimaryButton
          value="Save current"
          onClick={() => void saveProfile()}
          disabled={
            busy ||
            !snapshot?.capabilities.profile_storage ||
            Boolean(profileEnvironment.error)
          }
          actionIcon={busy ? 'spinner' : undefined}
        />
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SettingsField
          label={t('agentCenter.profileEditor.environmentLabel')}
          description={t('agentCenter.profileEditor.environmentHelp')}
          error={profileEnvironment.error}
        >
          <SettingsTextarea
            value={profileEnvironmentRaw}
            onChange={(value) => {
              setProfileEnvironmentRaw(value);
              setProfileFieldsDirty(true);
            }}
            placeholder={t('agentCenter.profileEditor.environmentPlaceholder')}
            disabled={busy}
            rows={5}
            monospace
          />
        </SettingsField>
        <SettingsField
          label={t('agentCenter.profileEditor.customArgsLabel')}
          description={t('agentCenter.profileEditor.customArgsHelp')}
        >
          <SettingsTextarea
            value={profileCustomArgsRaw}
            onChange={(value) => {
              setProfileCustomArgsRaw(value);
              setProfileFieldsDirty(true);
            }}
            placeholder={t('agentCenter.profileEditor.customArgsPlaceholder')}
            disabled={busy}
            rows={5}
            monospace
          />
        </SettingsField>
      </div>
      {copyPreview && (
        <div className="space-y-2 rounded-sm border border-border bg-secondary/20 p-3">
          <div className="text-sm font-medium text-high">
            Copy preview → {PROVIDER_LABELS[copyPreview.profile.provider]}
          </div>
          <div className="text-xs text-low">
            Compatible:{' '}
            {copyPreview.compatible_keys.length
              ? copyPreview.compatible_keys.join(', ')
              : 'None'}
          </div>
          <div className="text-xs text-low">
            Skipped:{' '}
            {copyPreview.skipped_keys.length
              ? copyPreview.skipped_keys.join(', ')
              : 'None'}
          </div>
          {copyPreview.warnings.map((warning) => (
            <div key={warning} className="text-xs text-error">
              {warning}
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <PrimaryButton
              variant="tertiary"
              value="Cancel"
              onClick={() => setCopyPreview(null)}
              disabled={busy}
            />
            <PrimaryButton
              value="Save copied profile"
              onClick={() => void saveCopiedProfile()}
              disabled={busy}
              actionIcon={busy ? 'spinner' : undefined}
            />
          </div>
        </div>
      )}
      {profilesLoading ? (
        <div
          className="flex items-center gap-2 py-4 text-sm text-low"
          role="status"
          aria-live="polite"
        >
          <SpinnerIcon className="size-icon-xs animate-spin" /> Loading
          profiles…
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border p-4 text-sm text-low">
          No saved profiles for this provider yet.
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile) => {
            const editing = profileEditor?.id === profile.id;
            return (
              <div
                key={profile.id}
                className="space-y-3 rounded-sm border border-border bg-secondary/20 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-normal">
                      {profile.name}
                    </div>
                    <div className="text-xs text-low">
                      {Object.keys(profile.setting_overrides).length} managed
                      settings · {Object.keys(profile.environment).length}{' '}
                      environment values · {profile.custom_args.length} custom
                      args · updated{' '}
                      {new Date(profile.updated_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <ToolAction
                      label="Apply"
                      icon={CheckCircleIcon}
                      disabled={busy || !snapshot}
                      onClick={() => void previewProfileApply(profile)}
                    />
                    <ToolAction
                      label="Copy"
                      icon={CopyIcon}
                      disabled={busy}
                      onClick={() => void previewProfileCopy(profile)}
                    />
                    <ToolAction
                      label="Duplicate"
                      icon={PlusIcon}
                      disabled={busy}
                      onClick={() => void duplicateProfile(profile)}
                    />
                    <ToolAction
                      label={t('agentCenter.profileEditor.edit')}
                      icon={PencilSimpleIcon}
                      disabled={
                        busy ||
                        (profileEditor !== null &&
                          profileEditor.id !== profile.id)
                      }
                      onClick={() => editProfile(profile)}
                    />
                    <ToolAction
                      label="Delete"
                      icon={TrashIcon}
                      danger
                      disabled={busy}
                      onClick={() => void deleteProfile(profile)}
                    />
                  </div>
                </div>
                {editing && profileEditor && (
                  <div className="space-y-4 border-t border-border pt-3">
                    <SettingsField
                      label={t('agentCenter.profileEditor.nameLabel')}
                    >
                      <SettingsInput
                        value={profileEditor.name}
                        onChange={(name) =>
                          setProfileEditor((current) =>
                            current ? { ...current, name } : current
                          )
                        }
                        disabled={busy}
                      />
                    </SettingsField>
                    <div className="grid gap-4 md:grid-cols-2">
                      <SettingsField
                        label={t('agentCenter.profileEditor.environmentLabel')}
                        description={t(
                          'agentCenter.profileEditor.environmentHelp'
                        )}
                        error={profileEditorEnvironment.error}
                      >
                        <SettingsTextarea
                          value={profileEditor.environmentRaw}
                          onChange={(environmentRaw) =>
                            setProfileEditor((current) =>
                              current ? { ...current, environmentRaw } : current
                            )
                          }
                          disabled={busy}
                          rows={5}
                          monospace
                        />
                      </SettingsField>
                      <SettingsField
                        label={t('agentCenter.profileEditor.customArgsLabel')}
                        description={t(
                          'agentCenter.profileEditor.customArgsHelp'
                        )}
                      >
                        <SettingsTextarea
                          value={profileEditor.customArgsRaw}
                          onChange={(customArgsRaw) =>
                            setProfileEditor((current) =>
                              current ? { ...current, customArgsRaw } : current
                            )
                          }
                          disabled={busy}
                          rows={5}
                          monospace
                        />
                      </SettingsField>
                    </div>
                    <div className="flex justify-end gap-2">
                      <PrimaryButton
                        variant="tertiary"
                        value={t('agentCenter.profileEditor.cancel')}
                        onClick={() => setProfileEditor(null)}
                        disabled={busy}
                      />
                      <PrimaryButton
                        value={t('agentCenter.profileEditor.save')}
                        onClick={() => void saveProfileEdits(profile)}
                        disabled={
                          busy ||
                          !profileEditorDirty ||
                          !profileEditor.name.trim() ||
                          Boolean(profileEditorEnvironment.error)
                        }
                        actionIcon={busy ? 'spinner' : undefined}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );

  if (!machineClient)
    return (
      <div className="py-4 text-sm text-low">
        Select a machine to discover Agent settings.
      </div>
    );
  if (loading && !snapshot)
    return (
      <div
        className="flex items-center gap-2 py-6 text-sm text-low"
        role="status"
        aria-live="polite"
      >
        <SpinnerIcon className="size-icon-sm animate-spin" /> Discovering{' '}
        {PROVIDER_LABELS[provider]} settings…
      </div>
    );

  const active = sections.find((section) => section.id === activeSection);
  return (
    <div
      className="mt-5 space-y-4 border-t border-border pt-5"
      data-testid="agent-settings-panel"
    >
      <div className="flex items-center gap-2">
        <CodeIcon className="size-icon-sm text-brand" aria-hidden="true" />
        <h3 className="text-base font-medium text-high">
          Installed Agent settings
        </h3>
      </div>
      {error && (
        <div
          className="flex items-start gap-2 rounded-sm border border-error/50 bg-error/10 p-3 text-sm text-error"
          role="alert"
        >
          <WarningCircleIcon className="mt-0.5 size-icon-sm shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div
          className="flex items-start gap-2 rounded-sm border border-success/50 bg-success/10 p-3 text-sm text-success"
          role="status"
        >
          <CheckCircleIcon className="mt-0.5 size-icon-sm shrink-0" />
          {notice}
        </div>
      )}
      {!snapshot ? (
        <div className="rounded-sm border border-border p-4 text-sm text-low">
          No settings snapshot available.
        </div>
      ) : (
        <>
          <div
            className="flex flex-wrap gap-1 border-b border-border"
            role="tablist"
            aria-label="Agent settings sections"
          >
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'border-b-2 px-3 py-2 text-sm',
                  activeSection === section.id
                    ? 'border-brand text-brand'
                    : 'border-transparent text-low hover:text-normal'
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
          {activeSection === 'overview' && renderOverview()}
          {active?.descriptors.length
            ? renderSettings(active.descriptors)
            : null}
          {includeTools && activeSection === 'tools' && (
            <AgentToolsSettingsSection provider={provider} />
          )}
          {activeSection === 'profiles' && renderProfiles()}
          {activeSection === 'effective_config' && renderEffective()}
        </>
      )}
      {diff && (
        <DiffConfirmation
          diff={diff}
          pending={pending}
          busy={busy}
          onCancel={() => {
            setDiff(null);
            setPending(null);
          }}
          onConfirm={() => void confirmPending()}
        />
      )}
      <SettingsSaveBar
        show={draftDirty && active?.descriptors.length === 0}
        saving={busy}
        onSave={() => void previewSettings()}
        onDiscard={discardDraft}
      />
    </div>
  );
}

function InfoTile({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-sm border border-border bg-secondary/20 p-3">
      <div className="text-xs text-low">{label}</div>
      <div
        className={cn('mt-1 truncate text-sm text-normal', mono && 'font-mono')}
      >
        {value}
      </div>
    </div>
  );
}

function DiffConfirmation({
  diff,
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  diff: SettingsDiff;
  pending: PendingAction | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <div
      className="space-y-3 rounded-sm border border-brand/40 bg-brand/5 p-3"
      role="dialog"
      aria-label="Settings diff confirmation"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-high">
        <FloppyDiskIcon className="size-icon-sm text-brand" /> Review changes
        before applying
      </div>
      {diff.warnings.map((warning) => (
        <div key={warning} className="text-xs text-error">
          {warning}
        </div>
      ))}
      {diff.files
        .filter((file) => file.changed)
        .map((file) => (
          <details
            key={file.file_id}
            open
            className="rounded-sm border border-border bg-background/40"
          >
            <summary className="cursor-pointer px-3 py-2 text-sm text-normal">
              {file.path}
            </summary>
            <div className="border-t border-border p-3 text-xs text-low">
              {t('agentCenter.security.diffHidden')}
            </div>
          </details>
        ))}
      {!hasChangedFiles(diff) && (
        <div className="text-sm text-low">No file bytes would change.</div>
      )}
      <div className="flex justify-end gap-2">
        <PrimaryButton
          variant="tertiary"
          value="Cancel"
          onClick={onCancel}
          disabled={busy}
        />
        <PrimaryButton
          value={
            pending?.kind === 'profile'
              ? 'Confirm profile apply'
              : 'Confirm apply'
          }
          onClick={onConfirm}
          disabled={busy || !hasChangedFiles(diff)}
          actionIcon={busy ? 'spinner' : undefined}
        />
      </div>
    </div>
  );
}

function ToolAction({
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
