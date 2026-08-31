import { describe, expect, it } from 'vitest';
import type { SettingsSnapshot } from 'shared/types';
import {
  agentSettingSourceKind,
  buildAgentSettingsPatch,
  buildAgentSettingsSections,
  createAgentSettingsDraft,
  effectiveStringSetting,
  formatProfileEnvironment,
  hasChangedFiles,
  isRevealResponseCurrent,
  isAgentSettingsDraftDirty,
  parseProfileCustomArgs,
  parseProfileEnvironment,
  profileEnvironmentFromSnapshot,
  settingSourceForScope,
} from './agentSettingsModel';
import { formatAgentSettingOperationError } from './machineClient';

describe('agentSettingSourceKind', () => {
  it('allowlists native sources and hides unknown identifiers', () => {
    expect(agentSettingSourceKind('native_user')).toBe('native_user');
    expect(agentSettingSourceKind('native_project')).toBe('native_project');
    expect(agentSettingSourceKind('provider:/private/path')).toBe(
      'adapter_managed'
    );
    expect(agentSettingSourceKind(null)).toBe('default');
  });
});

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    provider: 'codex',
    installed: true,
    provider_version: '1.0.0',
    executable_path: '/usr/bin/codex',
    schema_revision: 'schema',
    capabilities: {
      readable: true,
      native_writable: true,
      profile_storage: true,
      per_run_overrides: true,
      raw_editable: false,
    },
    descriptors: [
      {
        key: { namespace: 'common', name: 'model' },
        section: 'general',
        label: 'Model',
        description: 'Model',
        value_type: 'string',
        control: 'text',
        options: [],
        validation: {},
        supported_scopes: ['user'],
        capabilities: {
          readable: true,
          writable: true,
          resettable: true,
          profile_storable: true,
          run_override: true,
        },
        native_locations: [],
        activation: 'next_session',
        sensitive: false,
      },
    ],
    native_files: [
      {
        id: 'user-config',
        path: '/tmp/config.toml',
        format: 'toml',
        scope: 'user',
        exists: true,
        parse_status: 'parsed',
        revision: 'rev-1',
        writable: true,
        raw_editable: false,
      },
    ],
    effective_settings: [
      {
        key: { namespace: 'common', name: 'model' },
        sources: [],
        effective_value: 'old',
        effective_source: 'user',
        configured: true,
        warnings: [],
      },
    ],
    unknown_native_nodes: [],
    limitations: [],
    errors: [],
    ...overrides,
  };
}

describe('agent settings model', () => {
  it('renders only sections present in the runtime snapshot', () => {
    const sections = buildAgentSettingsSections(snapshot());
    expect(sections.map((section) => section.id)).toEqual([
      'overview',
      'general',
      'tools',
      'profiles',
      'native_files',
      'effective_config',
    ]);

    const unsupported = snapshot({
      capabilities: {
        readable: true,
        native_writable: false,
        profile_storage: false,
        per_run_overrides: false,
        raw_editable: false,
      },
      native_files: [],
      effective_settings: [],
    });
    expect(
      buildAgentSettingsSections(unsupported).map((section) => section.id)
    ).toEqual(['overview', 'general', 'tools']);
  });

  it('tracks typed changes, inherit/reset, and complete revisions', () => {
    const current = snapshot();
    const draft = createAgentSettingsDraft(current);
    draft['common.model'] = {
      action: 'replace',
      value: 'new-model',
      raw: 'new-model',
    };
    expect(isAgentSettingsDraftDirty(draft)).toBe(true);
    const patch = buildAgentSettingsPatch(current, draft, 'user');
    expect(patch.expected_file_revisions).toEqual({ 'user-config': 'rev-1' });
    expect(patch.operations).toEqual([
      {
        type: 'replace',
        data: {
          key: { namespace: 'common', name: 'model' },
          scope: 'user',
          value: 'new-model',
        },
      },
    ]);

    draft['common.model'] = { action: 'clear', raw: '' };
    expect(
      buildAgentSettingsPatch(current, draft, 'user').operations[0]
    ).toMatchObject({
      type: 'clear',
    });

    current.descriptors[0].supported_scopes = ['user'];
    draft['common.model'] = {
      action: 'replace',
      value: 'project-model',
      raw: 'project-model',
    };
    expect(
      buildAgentSettingsPatch(current, draft, 'project').operations
    ).toEqual([]);
  });

  it('keeps missing-file revisions explicit and formats structured errors', () => {
    const current = snapshot({
      native_files: [
        {
          id: 'missing',
          path: '/tmp/missing.toml',
          format: 'toml',
          scope: 'user',
          exists: false,
          parse_status: 'missing',
          revision: null,
          writable: true,
          raw_editable: false,
        },
      ],
    });
    const draft = createAgentSettingsDraft(current);
    draft['common.model'] = { action: 'clear', raw: '' };
    expect(
      buildAgentSettingsPatch(current, draft, 'user').expected_file_revisions
    ).toEqual({
      missing: 'missing',
    });
    expect(
      formatAgentSettingOperationError({
        error_data: {
          code: 'stale_revision',
          message: 'The file changed.',
          file_id: 'missing',
          recovery: 'Refresh and retry.',
        },
      })
    ).toContain('stale_revision');
  });

  it('recognizes an empty diff as safe to skip confirmation', () => {
    expect(
      hasChangedFiles({ provider: 'codex', files: [], warnings: [] })
    ).toBe(false);
    expect(
      hasChangedFiles({
        provider: 'codex',
        files: [
          {
            file_id: 'f',
            path: 'config.toml',
            changed: true,
          },
        ],
        warnings: [],
      })
    ).toBe(true);
  });

  it('keeps sensitive values out of the browser draft', () => {
    const current = snapshot();
    current.descriptors[0].sensitive = true;
    current.effective_settings[0].effective_value = 'must-not-enter-draft';
    current.effective_settings[0].configured = true;
    const draft = createAgentSettingsDraft(current);
    expect(draft['common.model']).toEqual({
      action: 'preserve',
      value: undefined,
      raw: '',
    });
    expect(JSON.stringify(draft)).not.toContain('must-not-enter-draft');

    draft['common.model'] = {
      action: 'replace',
      value: '••••••••',
      raw: '••••••••',
    };
    expect(buildAgentSettingsPatch(current, draft, 'user').operations).toEqual(
      []
    );
    draft['common.model'] = { action: 'clear', raw: '' };
    expect(buildAgentSettingsPatch(current, draft, 'user').operations).toEqual([
      {
        type: 'clear',
        data: {
          key: { namespace: 'common', name: 'model' },
          scope: 'user',
        },
      },
    ]);
  });

  it('keeps ordinary connection and environment values visible', () => {
    const current = snapshot();
    current.descriptors = [
      current.descriptors[0],
      {
        ...current.descriptors[0],
        key: { namespace: 'common', name: 'api_address' },
        label: 'API address',
      },
      {
        ...current.descriptors[0],
        key: { namespace: 'common', name: 'environment' },
        label: 'Environment',
        value_type: 'string_map',
        control: 'key_value',
      },
      {
        ...current.descriptors[0],
        key: { namespace: 'common', name: 'api_key' },
        label: 'API key',
        sensitive: true,
      },
    ];
    current.effective_settings = [
      current.effective_settings[0],
      {
        key: { namespace: 'common', name: 'api_address' },
        sources: [],
        effective_value: 'https://gateway.example.test/v1',
        effective_source: 'native_user',
        configured: true,
        warnings: [],
      },
      {
        key: { namespace: 'common', name: 'environment' },
        sources: [],
        effective_value: { MODE: 'fast', NORMAL_VALUE: 'visible' },
        effective_source: 'native_user',
        configured: true,
        warnings: [],
      },
      {
        key: { namespace: 'common', name: 'api_key' },
        sources: [],
        effective_value: null,
        effective_source: 'native_user',
        configured: true,
        warnings: [],
      },
    ];

    const draft = createAgentSettingsDraft(current);
    expect(draft['common.api_address'].raw).toBe(
      'https://gateway.example.test/v1'
    );
    expect(draft['common.environment'].raw).toContain('NORMAL_VALUE');
    expect(draft['common.api_key'].raw).toBe('');
    expect(effectiveStringSetting(current, 'common', 'api_address')).toEqual({
      value: 'https://gateway.example.test/v1',
      source: 'native_user',
    });
    expect(profileEnvironmentFromSnapshot(current)).toEqual({
      MODE: 'fast',
      NORMAL_VALUE: 'visible',
    });
  });

  it('parses editable profile environment and custom arguments exactly', () => {
    const environment = { EXACT: 'a=b c', EMPTY: '' };
    expect(
      parseProfileEnvironment(formatProfileEnvironment(environment))
    ).toEqual({ value: environment });
    expect(parseProfileEnvironment('{"INVALID": 1}').error).toBeTruthy();
    expect(parseProfileCustomArgs('  --model=x  \n\n--flag=value\n')).toEqual([
      '--model=x',
      '--flag=value',
    ]);
  });

  it('rejects late or context-mismatched credential reveal responses', () => {
    const client = {};
    const response = {
      key: { namespace: 'common', name: 'api_key' },
      scope: 'user' as const,
      revision: 'rev-1',
    };
    expect(
      isRevealResponseCurrent({
        requestSequence: 2,
        currentSequence: 2,
        requestClient: client,
        currentClient: client,
        settingId: 'common.api_key',
        scope: 'user',
        expectedRevision: 'rev-1',
        response,
      })
    ).toBe(true);
    expect(
      isRevealResponseCurrent({
        requestSequence: 2,
        currentSequence: 3,
        requestClient: client,
        currentClient: client,
        settingId: 'common.api_key',
        scope: 'user',
        expectedRevision: 'rev-1',
        response,
      })
    ).toBe(false);
    expect(
      isRevealResponseCurrent({
        requestSequence: 2,
        currentSequence: 2,
        requestClient: client,
        currentClient: {},
        settingId: 'common.api_key',
        scope: 'user',
        expectedRevision: 'rev-1',
        response,
      })
    ).toBe(false);
    expect(
      isRevealResponseCurrent({
        requestSequence: 2,
        currentSequence: 2,
        requestClient: client,
        currentClient: client,
        settingId: 'common.api_key',
        scope: 'user',
        expectedRevision: 'rev-2',
        response,
      })
    ).toBe(false);
  });

  it('selects the configured source for the active credential scope', () => {
    const current = snapshot();
    const descriptor = current.descriptors[0];
    descriptor.sensitive = true;
    descriptor.native_locations = [
      { file_id: 'user-config', scope: 'user', native_path: ['api_key'] },
      {
        file_id: 'project-config',
        scope: 'project',
        native_path: ['api_key'],
      },
    ];
    current.effective_settings[0].sources = [
      {
        source: 'native_user',
        scope: 'user',
        file_id: 'user-config',
        configured: true,
        revision: 'user-rev',
      },
    ];

    expect(settingSourceForScope(current, descriptor, 'user')?.revision).toBe(
      'user-rev'
    );
    expect(settingSourceForScope(current, descriptor, 'project')).toBeNull();
  });
});
