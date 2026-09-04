#!/usr/bin/env node

/**
 * Check that every supported frontend locale exposes the same leaf keys as
 * English. Translation quality is reviewed separately; this gate prevents a
 * newly added control from silently falling back to English in one locale.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const localesRoot = path.resolve(
  process.cwd(),
  'packages/web-core/src/i18n/locales'
);
const locales = ['en', 'es', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant'];
const namespaces = ['common', 'settings', 'projects', 'tasks', 'organization'];
const writeFallbacks = process.argv.includes('--write-fallbacks');

function flatten(value, prefix = '', result = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
    return result;
  }
  result.set(prefix, value);
  return result;
}

function readNamespace(locale, namespace) {
  const filename = path.join(localesRoot, locale, `${namespace}.json`);
  try {
    return flatten(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch (error) {
    throw new Error(`${locale}/${namespace}.json: ${error.message}`);
  }
}

function readJson(locale, namespace) {
  const filename = path.join(localesRoot, locale, `${namespace}.json`);
  try {
    return {
      filename,
      value: JSON.parse(fs.readFileSync(filename, 'utf8')),
    };
  } catch (error) {
    throw new Error(`${locale}/${namespace}.json: ${error.message}`);
  }
}

function fillMissing(target, source) {
  let added = 0;
  for (const [key, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = JSON.parse(JSON.stringify(value));
      added += flatten(value, key).size;
      continue;
    }

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      added += fillMissing(target[key], value);
    }
  }
  return added;
}

if (writeFallbacks) {
  let added = 0;
  for (const namespace of namespaces) {
    const source = readJson('en', namespace).value;
    for (const locale of locales.slice(1)) {
      const { filename, value } = readJson(locale, namespace);
      const count = fillMissing(value, source);
      if (count > 0) {
        fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
        added += count;
        console.log(`Added ${count} English fallback keys to ${locale}/${namespace}.json`);
      }
    }
  }
  console.log(`Wrote ${added} fallback keys.`);
}

const failures = [];
const longestValues = [];

for (const namespace of namespaces) {
  const english = readNamespace('en', namespace);
  for (const [key, value] of english) {
    longestValues.push({
      locale: 'en',
      namespace,
      key,
      length: String(value ?? '').length,
      value: String(value ?? ''),
    });
  }

  for (const locale of locales.slice(1)) {
    const translated = readNamespace(locale, namespace);
    const missing = [...english.keys()].filter((key) => !translated.has(key));
    const extra = [...translated.keys()].filter((key) => !english.has(key));
    if (missing.length || extra.length) {
      failures.push({ locale, namespace, missing, extra });
    }
    for (const [key, value] of translated) {
      longestValues.push({
        locale,
        namespace,
        key,
        length: String(value ?? '').length,
        value: String(value ?? ''),
      });
    }
  }
}

longestValues.sort((left, right) => right.length - left.length);
console.log(
  `Checked ${locales.length} locales x ${namespaces.length} namespaces.`
);
console.log('Longest values:');
for (const item of longestValues.slice(0, 10)) {
  console.log(
    `  ${item.locale}/${item.namespace}.${item.key} (${item.length}): ${item.value}`
  );
}

if (failures.length) {
  console.error('Locale key parity failed:');
  for (const failure of failures) {
    if (failure.missing.length) {
      console.error(
        `  ${failure.locale}/${failure.namespace}: missing ${failure.missing.join(', ')}`
      );
    }
    if (failure.extra.length) {
      console.error(
        `  ${failure.locale}/${failure.namespace}: extra ${failure.extra.join(', ')}`
      );
    }
  }
  process.exitCode = 1;
} else {
  console.log('Locale key parity passed.');
}
