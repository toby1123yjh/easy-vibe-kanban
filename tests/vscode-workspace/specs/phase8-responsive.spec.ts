import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 560 },
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
];

async function expectContained(page: Page, width: number) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
    )
    .toEqual({ viewport: width, document: width, body: width });
}

test.describe('P8-R1/A1 embedded VS Code workspace', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px contains the recoverable error state`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?mode=error');

      const alert = page.getByRole('alert');
      await expect(alert).toContainText('Workspace could not be loaded');
      await expectContained(page, viewport.width);

      const retry = page.getByRole('button', { name: 'Retry' });
      const retryBox = await retry.boundingBox();
      if (!retryBox) throw new Error('Retry button geometry is unavailable');
      if (viewport.width < 640) {
        expect(retryBox.height).toBeGreaterThanOrEqual(44);
      }
      await retry.focus();
      await retry.press('Enter');
      await expect(page.getByText('Workspace not found')).toBeVisible();
      await expect(page.getByTestId('retry-count')).toHaveText('1');
    });
  }

  test('announces loading and keeps successful absence distinct', async ({
    page,
  }) => {
    await page.goto('/?mode=loading');
    const loading = page.locator('[data-state="loading"]');
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toContainText('Loading...');

    await page.goto('/?mode=empty');
    await expect(page.getByText('Workspace not found')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
