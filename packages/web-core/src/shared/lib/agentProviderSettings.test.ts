import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AgentSettingsProvider,
  SettingActivation,
  SettingControl,
  SettingScope,
  SettingSection,
  SettingValueType,
  type SettingsSnapshot,
} from 'shared/types';
import { settingSourceForScope } from './agentSettingsModel';

test('same-scope native layers reveal the latest configured credential revision', () => {
  const snapshot: SettingsSnapshot = {
    provider: AgentSettingsProvider.opencode,
    installed: true,
    provider_version: null,
    schema_revision: 'fixture',
    capabilities: {
      readable: true,
      native_writable: true,
      profile_storage: true,
      per_run_overrides: true,
    },
    descriptors: [
      {
        key: { namespace: 'common', name: 'api_key' },
        section: SettingSection.general,
        label: 'API key',
        description: 'Native credential',
        value_type: SettingValueType.string,
        control: SettingControl.text,
        options: [],
        validation: {},
        supported_scopes: [SettingScope.user, SettingScope.project],
        capabilities: {
          readable: true,
          writable: true,
          resettable: true,
          profile_storable: true,
          run_override: true,
        },
        native_locations: ['base', 'custom', 'inline', 'missing'].map(
          (file_id) => ({
            file_id,
            scope: SettingScope.user,
            native_path: ['api_key'],
          })
        ),
        activation: SettingActivation.next_session,
        sensitive: true,
      },
    ],
    native_files: [],
    effective_settings: [
      {
        key: { namespace: 'common', name: 'api_key' },
        sources: ['base', 'custom', 'inline', 'missing'].map((file_id) => ({
          source: 'native_user',
          scope: SettingScope.user,
          file_id,
          configured: file_id !== 'missing',
          revision: `${file_id}-revision`,
        })),
        configured: true,
        warnings: [],
      },
    ],
    unknown_native_nodes: [],
    limitations: [],
    errors: [],
  };
  const descriptor = snapshot.descriptors[0];
  const originalOrder = snapshot.effective_settings[0].sources.map(
    (source) => source.file_id
  );
  assert.equal(
    settingSourceForScope(snapshot, descriptor, SettingScope.user)?.revision,
    'inline-revision'
  );
  assert.equal(
    settingSourceForScope(snapshot, descriptor, SettingScope.project),
    null
  );
  assert.deepEqual(
    snapshot.effective_settings[0].sources.map((source) => source.file_id),
    originalOrder
  );
  for (const source of snapshot.effective_settings[0].sources)
    source.configured = false;
  assert.equal(
    settingSourceForScope(snapshot, descriptor, SettingScope.user),
    null
  );
});
