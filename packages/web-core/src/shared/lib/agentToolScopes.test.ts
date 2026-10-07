import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentToolScope } from 'shared/types';
import { supportedAgentToolScopes } from './agentToolScopes';

test('MCP and skills use independently advertised scopes', () => {
  const inventory = {
    mcp_scopes: ['user'] as AgentToolScope[],
    skill_scopes: ['user', 'project'] as AgentToolScope[],
  };
  assert.deepEqual(supportedAgentToolScopes(inventory, 'mcp_server'), ['user']);
  assert.deepEqual(supportedAgentToolScopes(inventory, 'skill'), [
    'user',
    'project',
  ]);
  assert.equal(
    supportedAgentToolScopes(inventory, 'mcp_server').includes('project'),
    false
  );
});

test('missing inventory does not fabricate tool scope support', () => {
  assert.deepEqual(supportedAgentToolScopes(undefined, 'mcp_server'), []);
  assert.deepEqual(supportedAgentToolScopes(null, 'skill'), []);
  assert.deepEqual(
    supportedAgentToolScopes({ mcp_scopes: [], skill_scopes: [] }, 'skill'),
    []
  );
});
