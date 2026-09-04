import { expect, test } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 560 },
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
];

async function expectContained(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
    )
    .toEqual({
      viewport: await page.evaluate(() => window.innerWidth),
      document: await page.evaluate(() => window.innerWidth),
      body: await page.evaluate(() => window.innerWidth),
    });
}

test.describe('P8-R1 project directory and workspace list', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px keeps project directory contained`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.getByTestId('project-directory-surface')).toBeVisible();
      await expectContained(page);
      await expect(
        page.getByRole('heading', { name: 'Projects' })
      ).toBeVisible();
      const cards = page.locator('.vk-project-card');
      await expect(cards).toHaveCount(8);
      const search = page.getByRole('searchbox', { name: 'Search projects' });
      await search.fill('Project 8');
      await expect(cards).toHaveCount(1);
      await expect(search).toBeFocused();
    });

    test(`${viewport.width}px keeps workspace list controls reachable`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.getByRole('button', { name: 'Workspaces' }).click();
      const surface = page.getByTestId('workspace-list-surface');
      await expect(surface).toBeVisible();
      await expectContained(page);
      const search = surface.getByPlaceholder('Search...');
      await expect(search).toBeVisible();
      await search.focus();
      await search.fill('keyboard');
      await expect(surface.getByText('Fix keyboard navigation')).toBeVisible();
      const workspaceButton = surface
        .getByRole('button', { name: /Fix keyboard navigation/ })
        .first();
      const box = await workspaceButton.boundingBox();
      if (!box) throw new Error('Workspace item geometry is unavailable');
      expect(box.height).toBeGreaterThanOrEqual(44);
      await workspaceButton.press('Enter');
      await expect(page.getByTestId('selected-workspace')).toHaveText(
        'workspace-1'
      );
    });
  }
});
