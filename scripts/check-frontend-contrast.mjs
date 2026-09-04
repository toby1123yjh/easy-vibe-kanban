#!/usr/bin/env node

/** Evaluate the stable semantic token pairs used by redesigned surfaces. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const tokensFile = path.resolve(
  process.cwd(),
  'packages/ui/src/styles/tokens.css'
);
const source = fs.readFileSync(tokensFile, 'utf8');

function parseHex(value) {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  return [0, 2, 4].map((offset) =>
    Number.parseInt(match[1].slice(offset, offset + 2), 16)
  );
}

function parseRgb(value) {
  const match = value.trim().match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/i);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function tokenBlock(theme) {
  if (theme === 'dark') {
    const start = source.indexOf(':root.dark');
    return start >= 0 ? source.slice(start) : '';
  }
  const end = source.indexOf(':root.dark');
  return source.slice(0, end >= 0 ? end : undefined);
}

function resolveToken(name, theme, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Token cycle detected at --vk-${name}`);
  seen.add(name);
  const declaration =
    tokenBlock(theme).match(new RegExp(`--vk-${name}:\\s*([^;]+);`)) ??
    (theme === 'dark'
      ? tokenBlock('light').match(new RegExp(`--vk-${name}:\\s*([^;]+);`))
      : null);
  if (!declaration) throw new Error(`Missing token --vk-${name} in ${theme}`);
  const raw = declaration[1].trim();
  if (raw.startsWith('var(--vk-')) {
    return resolveToken(raw.slice(9, -1), theme, seen);
  }
  return parseHex(raw) ?? parseRgb(raw);
}

function luminance(rgb) {
  return rgb.reduce((sum, channel, index) => {
    const normalized = channel / 255;
    const linear =
      normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrastRatio(foreground, background) {
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
}

const pairs = [
  ['text-high', 'surface-primary'],
  ['text-normal', 'surface-primary'],
  ['text-low', 'surface-primary'],
  ['text-high', 'surface-sidebar'],
  ['text-normal', 'surface-sidebar'],
  ['text-on-brand', 'brand'],
  ['status-running-text', 'surface-primary'],
  ['status-waiting-text', 'surface-primary'],
  ['status-success-text', 'surface-primary'],
  ['status-error-text', 'surface-primary'],
];

let failed = false;
for (const theme of ['light', 'dark']) {
  console.log(`${theme} contrast:`);
  for (const [foreground, background] of pairs) {
    const foregroundRgb = resolveToken(foreground, theme);
    const backgroundRgb = resolveToken(background, theme);
    if (!foregroundRgb || !backgroundRgb) {
      throw new Error(
        `Unsupported color token in ${theme}: ${foreground}/${background}`
      );
    }
    const value = contrastRatio(foregroundRgb, backgroundRgb);
    const pass = value >= 4.5;
    failed ||= !pass;
    console.log(
      `  ${foreground} on ${background}: ${value.toFixed(2)}:1 ${pass ? 'PASS' : 'FAIL'}`
    );
  }
}

if (failed) {
  console.error('Contrast check failed: normal text requires at least 4.5:1.');
  process.exitCode = 1;
} else {
  console.log('Contrast check passed.');
}
