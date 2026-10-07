import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseCodingAgent } from 'shared/types';
import {
  agentInstallRequest,
  isValidInstallRegistry,
  supportsNpmRegistry,
} from './agentInstall';

test('npm installers support registry overrides for all four npm providers', () => {
  for (const executor of [
    BaseCodingAgent.CODEX,
    BaseCodingAgent.GEMINI,
    BaseCodingAgent.OPENCODE,
    BaseCodingAgent.DEEPSEEK_HARNESS,
  ]) {
    assert.equal(supportsNpmRegistry(executor), true);
    assert.deepEqual(
      agentInstallRequest(executor, ' https://registry.npmjs.org/ '),
      {
        executor,
        npm_registry: 'https://registry.npmjs.org/',
      }
    );
    assert.deepEqual(agentInstallRequest(executor, '  '), { executor });
  }
});

test('native installers do not forward an irrelevant npm registry', () => {
  for (const executor of [
    BaseCodingAgent.CLAUDE_CODE,
    BaseCodingAgent.OH_MY_PI,
  ]) {
    assert.equal(supportsNpmRegistry(executor), false);
    assert.deepEqual(
      agentInstallRequest(executor, 'https://registry.npmjs.org/'),
      {
        executor,
      }
    );
  }
});

test('registry validation permits host npm defaults but rejects unsafe URLs', () => {
  for (const value of [
    '',
    '  ',
    'https://registry.npmjs.org/',
    'http://localhost:4873/',
  ]) {
    assert.equal(isValidInstallRegistry(value), true, value);
  }
  for (const value of [
    'ftp://registry.example.com',
    'https://user:password@registry.example.com',
    'https://registry.example.com/?token=secret',
    'https://registry.example.com/#fragment',
    'not a URL',
    `https://registry.example.com/${'a'.repeat(2048)}`,
  ]) {
    assert.equal(isValidInstallRegistry(value), false, value);
  }
});
