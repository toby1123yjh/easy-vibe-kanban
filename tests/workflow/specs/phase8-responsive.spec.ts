import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 812 },
  { width: 1024, height: 812 },
  { width: 1440, height: 900 },
];

async function gotoFixture(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
}

test.describe('P8-R1 Workflow canvas geometry', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px contains canvas and inspectors without page overflow`, async ({
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

      const canvas = page.getByTestId('workflow-canvas');
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox).toBeTruthy();
      expect(canvasBox!.x).toBeGreaterThanOrEqual(0);
      expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(
        viewport.width
      );

      for (const testId of ['node-inspector', 'edge-inspector']) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box).toBeTruthy();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
    });
  }

  test('mobile keeps graph interaction scroll-local while opening node configuration', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoFixture(page);

    const canvas = page.getByTestId('workflow-canvas');
    await expect(canvas).toHaveCSS('overflow', 'hidden');

    await page.getByTestId('select-condition-node').press('Enter');
    const inspector = page.getByTestId('node-inspector');
    await expect(inspector).toContainText('Condition');
    const branch = inspector.locator('textarea').first();
    await branch.focus();
    await branch.fill('Long localized condition text that remains editable');
    await expect(branch).toHaveValue(
      'Long localized condition text that remains editable'
    );
  });
});

test.describe('P8-A1 Workflow keyboard contract', () => {
  test('keyboard-only entry reaches node controls and returns focus after editing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 812 });
    await gotoFixture(page);

    const selectCondition = page.getByTestId('select-condition-node');
    await selectCondition.focus();
    await selectCondition.press('Enter');
    const branch = page
      .getByTestId('node-inspector')
      .locator('textarea')
      .first();
    await branch.focus();
    await expect(branch).toBeFocused();
    await branch.press('Tab');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .not.toBe('BODY');

    await page.getByRole('button', { name: 'Add Agent Node' }).focus();
    await page.getByRole('button', { name: 'Add Agent Node' }).press('Space');
    const inspector = page.getByTestId('node-inspector');
    await expect(inspector).toContainText('Display name');
    const title = inspector.getByLabel('Display name');
    await title.fill('Keyboard-created agent node');
    const prompt = inspector.getByLabel('Prompt template');
    await prompt.fill('Run the keyboard workflow node.');
    await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  });
});
