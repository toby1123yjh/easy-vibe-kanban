import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(
  new URL('../../.github/workflows/publish-easy-npx.yml', import.meta.url),
  'utf8'
);
const validationStep = workflow.split(
  '- name: Validate requested npm version'
)[1]?.split('\n      - name:')[0];
const snippet = validationStep?.match(/node -e "\r?\n([\s\S]*?)\r?\n\s*"/)[1];
assert.ok(snippet, 'Workflow must contain the npm version validation snippet');

function validate(version) {
  runInNewContext(snippet, { process: { env: { VERSION: version } } });
}

for (const version of [
  '2.0.0',
  '2.0.0-beta.1',
  '0.1.44-easy.1',
  '0.0.0',
  '10.20.30',
  '2.0.0-beta.0',
  '0.1.44-easy.64',
]) {
  test(`accepts ${version}`, () => {
    assert.doesNotThrow(() => validate(version));
  });
}

for (const version of [
  undefined,
  '',
  '2.0',
  'v2.0.0',
  '02.0.0',
  '2.00.0',
  '2.0.00',
  '2.0.0-beta.01',
  '2.0.0-easy.01',
  '2.0.0-beta',
  '2.0.0-beta.',
  '2.0.0-beta.-1',
  '2.0.0-alpha.1',
  '2.0.0-beta.1.extra',
  '2.0.0+build.1',
  ' 2.0.0',
  '2.0.0 ',
  '2.0.0\n',
  '2.0.0-beta.1\r\n',
  '2x0x0',
]) {
  test(`rejects ${JSON.stringify(version)}`, () => {
    assert.throws(() => validate(version), /Version must be X\.Y\.Z/);
  });
}
