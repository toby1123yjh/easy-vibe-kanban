import { expect, test } from '@playwright/test';
import type { general } from '../fixture/general-mocks';
declare global {
  interface Window {
    generalFixture: typeof general;
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto('/general.html');
  await expect(
    page.getByRole('textbox', { name: 'Default session directory' })
  ).toHaveValue('/host-a');
});
test('failed real controller save retains draft and dirty state, then retry persists', async ({
  page,
}) => {
  const input = page.getByRole('textbox', {
    name: 'Default session directory',
  });
  await input.fill('/changed');
  await page.evaluate(() => window.generalFixture.update({ fail: true }));
  await page
    .getByRole('button', { name: 'common:buttons.save', exact: true })
    .click();
  await expect(
    page.getByText('settings.general.save.error', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('settings.general.save.success', { exact: true })
  ).toHaveCount(0);
  await expect(input).toHaveValue('/changed');
  expect(await page.evaluate(() => window.generalFixture.dirty)).toBe(true);
  await page.evaluate(() => window.generalFixture.update({ fail: false }));
  await page
    .getByRole('button', { name: 'common:buttons.save', exact: true })
    .click();
  await expect(
    page.getByText('settings.general.save.success', { exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => window.generalFixture.saves)).toEqual([
    { host: 'a', root: '/changed' },
    { host: 'a', root: '/changed' },
  ]);
  await page.evaluate(() => window.generalFixture.update({ host: 'b' }));
  await page.evaluate(() => window.generalFixture.update({ host: 'a' }));
  await expect(input).toHaveValue('/changed');
});
for (const transition of ['host', 'unmount'] as const) {
  test(`late save after ${transition} cannot apply theme or mutate new form`, async ({
    page,
  }) => {
    await page
      .getByRole('textbox', { name: 'Default session directory' })
      .fill('/old-save');
    await page.evaluate(() => window.generalFixture.update({ deferred: true }));
    await page
      .getByRole('button', { name: 'common:buttons.save', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    expect(await page.evaluate(() => window.generalFixture.saves)).toHaveLength(
      1
    );
    await page.evaluate(
      (transition) =>
        window.generalFixture.update(
          transition === 'host' ? { host: 'b' } : { visible: false }
        ),
      transition
    );
    await page.evaluate(() => window.generalFixture.finish());
    await expect
      .poll(() => page.evaluate(() => window.generalFixture.completions))
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.generalFixture.themes.length))
      .toBe(0);
    if (transition === 'host')
      await expect(
        page.getByRole('textbox', { name: 'Default session directory' })
      ).toHaveValue('/host-b');
    await expect(
      page.getByText('settings.general.save.success', { exact: true })
    ).toHaveCount(0);
  });
}
