import { expect, test, type Page } from '@playwright/test';
import type {} from '../fixture/main';

async function control(page: Page, action: 'arm' | 'release') {
  await page.evaluate((name) => window.routeTest[name](), action);
}

async function expectPage(
  page: Page,
  name: string,
  path: string,
  mode: string
) {
  await expect(page.getByTestId('page')).toHaveAttribute('data-page', name);
  await expect(page.getByTestId('rendered')).toHaveText(path);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', mode);
  await expect(page.getByText('Project missing', { exact: true })).toHaveCount(
    0
  );
}

async function expectNoInvalidFrames(page: Page) {
  const invalid = await page.evaluate(() =>
    window.routeTest.observations.filter(
      (frame) =>
        frame.missing ||
        (frame.page === 'project' &&
          (frame.pathname !== '/projects/one' ||
            frame.mode !== 'full-bleed')) ||
        (frame.page === 'settings' &&
          (frame.pathname !== '/settings' || frame.mode !== 'contained'))
    )
  );
  expect(invalid).toEqual([]);
}

test('deferred Settings navigation keeps the rendered project identity and width until commit', async ({
  page,
}) => {
  await page.goto('/projects/one');
  await expectPage(page, 'project', '/projects/one', 'full-bleed');
  await control(page, 'arm');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('location')).toHaveText('/settings');
  await expectPage(page, 'project', '/projects/one', 'full-bleed');
  await control(page, 'release');
  await expectPage(page, 'settings', '/settings', 'contained');
  await expectNoInvalidFrames(page);
});

test('direct Settings entry and refresh never render another page', async ({
  page,
}) => {
  await page.goto('/settings');
  await expectPage(page, 'settings', '/settings', 'contained');
  await page.reload();
  await expectPage(page, 'settings', '/settings', 'contained');
  expect(
    await page.evaluate(() =>
      window.routeTest.observations.every((frame) => frame.page === 'settings')
    )
  ).toBe(true);
  await expectNoInvalidFrames(page);
});

test('back and forward keep page identity and canvas mode synchronized', async ({
  page,
}) => {
  await page.goto('/projects/one');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expectPage(page, 'settings', '/settings', 'contained');
  await page.goBack();
  await expectPage(page, 'project', '/projects/one', 'full-bleed');
  await page.goForward();
  await expectPage(page, 'settings', '/settings', 'contained');
  await expectNoInvalidFrames(page);
});

test('a superseded Settings load cannot replace the newer destination', async ({
  page,
}) => {
  await page.goto('/projects/one');
  await control(page, 'arm');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('location')).toHaveText('/settings');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expectPage(page, 'dashboard', '/dashboard', 'contained');
  await control(page, 'release');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expectPage(page, 'dashboard', '/dashboard', 'contained');
  await expectNoInvalidFrames(page);
});
