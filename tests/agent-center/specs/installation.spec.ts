import { expect, test } from '@playwright/test';

for (const [executor, name] of [
  ['CLAUDE_CODE', 'Claude Code'],
  ['OH_MY_PI', 'Oh My Pi'],
] as const) {
  test(`${name} uses native installer without npm registry`, async ({
    page,
  }) => {
    await page.goto(`/?signedOut=true&missing=${executor}`);
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page
      .getByRole('button', { name: 'Install agent', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'npm registry (optional)' }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Start installation', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Install agent', exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => window.agentInstallProbe.registry),
    ).toBeNull();
  });
}

declare global {
  interface Window {
    agentInstallProbe: {
      starts: number;
      registry: string | null;
      installed: boolean;
    };
  }
}

test('npm install forwards registry and rescans availability', async ({
  page,
}) => {
  await page.goto('/?signedOut=true&missing=CODEX');
  await page
    .getByRole('button', { name: 'Install agent', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'npm registry (optional)' })
    .fill('https://registry.npmjs.org');
  await page
    .getByRole('button', { name: 'Start installation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Installing…', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Install agent', exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.agentInstallProbe)).toEqual({
    starts: 1,
    registry: 'https://registry.npmjs.org',
    installed: true,
  });
});

test('manual installation supersedes previous failed job', async ({ page }) => {
  await page.goto('/?signedOut=true&missing=CODEX&installFails=true');
  await page
    .getByRole('button', { name: 'Install agent', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Start installation', exact: true })
    .click();
  await expect(
    page.getByText('Fixture download failed', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.agentInstallProbe.installed = true;
  });
  await page.getByRole('button', { name: 'Rescan host', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Install agent', exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.agentInstallProbe.starts)).toBe(1);
});

test('invalid registry cannot launch installer on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?signedOut=true&missing=CODEX');
  await page
    .getByRole('button', { name: 'Install agent', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'npm registry (optional)' })
    .fill('https://user:password@example.com');
  await expect(
    page.getByRole('button', { name: 'Start installation', exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.agentInstallProbe.starts)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});
