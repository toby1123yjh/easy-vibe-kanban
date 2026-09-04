import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 812 },
  { width: 1024, height: 812 },
  { width: 1440, height: 900 },
];

async function gotoFixture(page: Page, url = '/') {
  await page.goto(url);
  await expect(
    page.getByRole('heading', {
      name: url.includes('view=dashboard')
        ? 'Dashboard'
        : 'App Shell browser contract',
    })
  ).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, viewport: number) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
    )
    .toEqual({ viewport, document: viewport, body: viewport });
}

test.describe('P8-R1 App Shell geometry', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px has no horizontal overflow and stable navigation`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoFixture(page);

      await expectNoHorizontalOverflow(page, viewport.width);

      if (viewport.width < 768) {
        await expect(page.locator('.vk-mobile-header')).toBeVisible();
        await expect(page.locator('.vk-bottom-nav')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Browse' })).toHaveCSS(
          'min-height',
          '44px'
        );
      } else if (viewport.width < 1024) {
        await expect(page.locator('.vk-product-rail')).toBeVisible();
        await expect(
          page.locator('.vk-product-rail .vk-primary-nav__item').first()
        ).toHaveCSS('min-height', '44px');
      } else {
        await expect(page.locator('.vk-product-sidebar')).toBeVisible();
      }
    });
  }

  for (const viewport of viewports) {
    test(`${viewport.width}px keeps Dashboard sections contained`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoFixture(page, '/?view=dashboard');

      const dashboard = page.getByTestId('dashboard-page');
      await expect(dashboard).toBeVisible();
      await expect(
        dashboard.getByRole('heading', { name: 'Dashboard' })
      ).toBeVisible();
      await expect(dashboard.locator('[data-state="unavailable"]')).toHaveCount(
        4
      );
      const box = await dashboard.boundingBox();
      if (!box) throw new Error('Dashboard geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await expectNoHorizontalOverflow(page, viewport.width);
    });
  }

  test('Dashboard exposes a labelled, non-interactive status summary', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 812 });
    await gotoFixture(page, '/?view=dashboard');

    const dashboard = page.getByRole('region', { name: 'Dashboard' });
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByRole('heading', { level: 1 })).toHaveText(
      'Dashboard'
    );

    const sections = dashboard.locator('section[aria-labelledby]');
    await expect(sections).toHaveCount(4);
    await expect(dashboard.getByRole('heading', { level: 2 })).toHaveCount(4);
    await expect(dashboard.locator('[data-state="unavailable"]')).toHaveCount(
      4
    );
    await expect(
      dashboard.locator('button, a, input, select, textarea')
    ).toHaveCount(0);

    const sectionLabels = await sections.evaluateAll((elements) =>
      elements.map((element) => {
        const labelId = element.getAttribute('aria-labelledby');
        return labelId ? document.getElementById(labelId)?.textContent : null;
      })
    );
    expect(sectionLabels).toEqual([
      'Global statistics',
      'Attention',
      'Active runs',
      'Agent configuration',
    ]);
  });

  for (const viewport of viewports) {
    test(`${viewport.width}px keeps Global Search usable and restores focus`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoFixture(page);

      const trigger =
        viewport.width < 768
          ? page
              .locator('.vk-bottom-nav')
              .getByRole('button', { name: 'Search' })
          : viewport.width < 1024
            ? page
                .locator('.vk-product-rail')
                .getByRole('button', { name: 'Search' })
            : page
                .locator('.vk-product-sidebar')
                .getByRole('button', { name: 'Search' });
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await trigger.press('Enter');

      const dialog = page.getByRole('dialog', { name: 'Global search' });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      if (!box) throw new Error('Global Search geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await expect(dialog.getByRole('combobox')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expectNoHorizontalOverflow(page, viewport.width);
    });
  }

  test('200-item project list virtualizes rows and reaches the final item', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoFixture(page, '/?volume=200');

    const rows = page.locator('.vk-virtual-list__row');
    await expect.poll(() => rows.count()).toBeLessThanOrEqual(50);

    const list = page.getByTestId('shell-object-scroll');
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole('button', { name: 'Project 200' })
    ).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThanOrEqual(50);
  });
});
