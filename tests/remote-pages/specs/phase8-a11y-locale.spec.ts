import { expect, test } from '@playwright/test';

const locales = ['en', 'es', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant'];

for (const locale of locales) {
  test(`Remote login and home keep primary actions keyboard reachable in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/?page=login&locale=${encodeURIComponent(locale)}`);

    await expect(page.locator('html')).toHaveAttribute(
      'data-fixture-locale',
      locale
    );
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const oauth = page.getByRole('button', { name: 'Continue with GitHub' });
    await oauth.focus();
    await expect(oauth).toBeFocused();

    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(oauth).toBeVisible();

    await page.goto(
      `/?page=login&mode=login-degraded&locale=${encodeURIComponent(locale)}`
    );
    await expect(page.locator('[data-state="degraded"]')).toBeVisible();
    await expect(page.locator('[aria-live="polite"]')).toBeVisible();

    await page.goto(
      `/?page=home&mode=home-degraded&locale=${encodeURIComponent(locale)}`
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Organizations'
    );
    const project = page.getByRole('link', { name: /Open project/ });
    await project.focus();
    await expect(project).toBeFocused();
    const projectBox = await project.boundingBox();
    expect(projectBox?.height).toBe(61);
    await expect(page.locator('[data-state="degraded"]')).toBeVisible();
  });
}
