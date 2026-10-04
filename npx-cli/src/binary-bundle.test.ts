import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBundleEntries, requiredBinaryNames } from './binary-bundle';

test('main bundles require same-package host and MCP on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const suffix = platform === 'win32' ? '.exe' : '';
    const names = ['vibe-kanban', 'agent-process-host', 'vibe-kanban-mcp']
      .map((name) => name + suffix);
    assert.deepEqual(requiredBinaryNames('vibe-kanban', platform), names);
    assert.doesNotThrow(() => assertBundleEntries('vibe-kanban', platform, names));
    for (const missing of names) {
      assert.throws(() => assertBundleEntries('vibe-kanban', platform, names.filter((name) => name !== missing)), /Incomplete/);
    }
    assert.throws(() => assertBundleEntries('vibe-kanban', platform, names.map((name) => `nested/${name}`)), /Incomplete/);
  }
});

test('standalone MCP and review remain single-binary commands', () => {
  assert.deepEqual(requiredBinaryNames('vibe-kanban-mcp', 'linux'), ['vibe-kanban-mcp']);
  assert.deepEqual(requiredBinaryNames('vibe-kanban-review', 'win32'), ['vibe-kanban-review.exe']);
});
