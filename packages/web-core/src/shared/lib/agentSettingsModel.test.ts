import { describe, expect, it } from 'vitest';
import type { SettingsSnapshot } from 'shared/types';
import {
  buildAgentSettingsPatch,
  buildAgentSettingsSections,
  createAgentSettingsDraft,
  hasChangedFiles,
  isAgentSettingsDraftDirty,
} from './agentSettingsModel';
import { formatAgentSettingOperationError } from './machineClient';

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
      raw_editable: true,
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
        raw_editable: true,
        raw_content: 'model = "old"',
      },
    ],
    effective_settings: [
      {
        key: { namespace: 'common', name: 'model' },
        sources: [],
        effective_value: 'old',
        effective_source: 'user',
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
      action: 'set',
      value: 'new-model',
      raw: 'new-model',
    };
    expect(isAgentSettingsDraftDirty(draft)).toBe(true);
    const patch = buildAgentSettingsPatch(current, draft, 'user');
    expect(patch.expected_file_revisions).toEqual({ 'user-config': 'rev-1' });
    expect(patch.operations).toEqual([
      {
        type: 'set',
        data: {
          key: { namespace: 'common', name: 'model' },
          scope: 'user',
          value: 'new-model',
        },
      },
    ]);

    draft['common.model'] = { action: 'unset', raw: '' };
    expect(
      buildAgentSettingsPatch(current, draft, 'user').operations[0]
    ).toMatchObject({
      type: 'unset',
    });

    current.descriptors[0].supported_scopes = ['user'];
    draft['common.model'] = {
      action: 'set',
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
          raw_editable: true,
        },
      ],
    });
    const draft = createAgentSettingsDraft(current);
    draft['common.model'] = { action: 'unset', raw: '' };
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
            before: 'a',
            after: 'b',
            changed: true,
          },
        ],
        warnings: [],
      })
    ).toBe(true);
  });
});
