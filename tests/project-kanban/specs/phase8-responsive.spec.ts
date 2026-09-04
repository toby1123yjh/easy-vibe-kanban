import { expect, test } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 560 },
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
];

async function gotoFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Fixture project board' })
  ).toBeVisible();
}

test.describe('P8-R1 Project Kanban geometry', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px keeps the shared board inside the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoFixture(page);

      await expect
        .poll(() =>
          page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          }))
        )
        .toEqual({
          viewport: viewport.width,
          document: viewport.width,
          body: viewport.width,
        });

      const board = page.locator('.vk-kanban-scroll');
      const box = await board.boundingBox();
      if (!box) throw new Error('Kanban board geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await expect(board).toHaveCSS('overflow-y', 'auto');
      await expect(page.locator('.vk-kanban-column__header').first()).toHaveCSS(
        'position',
        'sticky'
      );
    });
  }

  test('mobile issue panel becomes full-screen without changing board width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoFixture(page);
    const board = page.locator('.vk-kanban-scroll');
    const before = await board.boundingBox();
    await page.locator('[data-issue-id="issue-1"]').press('Enter');
    const panel = page.getByRole('complementary', { name: 'Issue details' });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('position', 'fixed');
    expect(await panel.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 375,
      height: 812,
    });
    expect(await board.boundingBox()).toEqual(before);
  });
});
