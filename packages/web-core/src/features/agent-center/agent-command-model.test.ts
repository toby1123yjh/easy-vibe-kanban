import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentCommandView } from 'shared/types';
import {
  commandNameIsValid,
  definitionDescription,
  editorFromItem,
  writeDefinition,
} from './agent-command-model';

function opencodeCommand(): AgentCommandView {
  return {
    installation_id: 'opencode-command-fixture',
    provider: 'opencode',
    scope: 'user',
    name: 'review',
    state: 'enabled',
    format: 'opencode_markdown',
    capabilities: { editable: true, removable: true, toggleable: true },
    revision: 'fixture-revision',
    definition: {
      type: 'opencode',
      data: { description: 'Review a change', body: 'Review $ARGUMENTS' },
    },
  };
}

test('OpenCode Markdown edits send only adapter-approved fields', () => {
  const item = opencodeCommand();
  const editor = editorFromItem(item);
  assert.equal(editor.description, 'Review a change');
  assert.equal(editor.body, 'Review $ARGUMENTS');
  assert.equal(definitionDescription(item.definition), 'Review a change');
  assert.deepEqual(writeDefinition({ ...editor, body: 'Changed prompt' }), {
    type: 'opencode',
    data: {
      description: { type: 'replace', data: { value: 'Review a change' } },
      body: { type: 'replace', data: { value: 'Changed prompt' } },
    },
  });
});

test('clearing OpenCode description uses the explicit clear operation', () => {
  const definition = writeDefinition({
    ...editorFromItem(opencodeCommand()),
    description: '  ',
  });
  assert.equal(definition.type, 'opencode');
  assert.deepEqual(definition.data.description, { type: 'clear' });
});

test('inline OpenCode definitions are viewable but cannot be serialized for writing', () => {
  const item = {
    ...opencodeCommand(),
    format: 'opencode_inline' as const,
    capabilities: { editable: false, removable: false, toggleable: false },
  };
  const editor = editorFromItem(item);
  assert.equal(editor.body, 'Review $ARGUMENTS');
  assert.throws(() => writeDefinition(editor), /read_only_format/);
});

test('OpenCode names use native segments, not invented namespaces or paths', () => {
  for (const name of ['review', 'review_change', 'review-2']) {
    assert.equal(commandNameIsValid('opencode', name), true);
  }
  for (const name of [
    '',
    'team:review',
    '../review',
    'team/review',
    'review change',
  ]) {
    assert.equal(commandNameIsValid('opencode', name), false);
  }
  assert.equal(commandNameIsValid('claude_code', 'team:review'), true);
  assert.equal(commandNameIsValid('gemini', 'team:review'), true);
});
