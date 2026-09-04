import { expect, test } from '@playwright/test';

const locales = ['en', 'es', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant'];
const moreOptionsPattern = /More options|更多选项|更多選項/;

for (const locale of locales) {
  test(`Onboarding sign-in keeps the long comparison keyboard reachable in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 640 });
    await page.goto(`/?page=signin&locale=${encodeURIComponent(locale)}`);

    await expect(page.locator('html')).toHaveAttribute(
      'data-fixture-locale',
      locale
    );
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    const moreOptions = page.getByRole('button', {
      name: moreOptionsPattern,
    });
    await moreOptions.focus();
    await expect(moreOptions).toBeFocused();
    await moreOptions.press('Enter');

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    const continueButton = page.getByRole('button', {
      name: /I understand, continue without signing in/,
    });
    await moreOptions.press('Tab');
    await expect(continueButton).toBeFocused();
    const tableScroll = await table.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(tableScroll.scrollWidth).toBeGreaterThanOrEqual(
      tableScroll.clientWidth
    );

    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(table).toBeVisible();
    await expect(continueButton).toBeVisible();
  });
}
