import { expect, test } from "@playwright/test";

const locales = ["en", "es", "fr", "ja", "ko", "zh-Hans", "zh-Hant"];
const dashboardTitles: Record<string, string> = {
  en: "Dashboard",
  es: "Panel",
  fr: "Tableau de bord",
  ja: "ダッシュボード",
  ko: "대시보드",
  "zh-Hans": "仪表盘",
  "zh-Hant": "儀表板",
};

for (const locale of locales) {
  test(`Dashboard keeps one labelled region and four unavailable sections in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/?view=dashboard&locale=${encodeURIComponent(locale)}`);

    await expect(page.locator("html")).toHaveAttribute(
      "data-fixture-locale",
      locale,
    );
    const dashboard = page.getByRole("region", {
      name: dashboardTitles[locale],
    });
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(dashboard.locator("section[aria-labelledby]")).toHaveCount(4);
    await expect(dashboard.locator('[data-state="unavailable"]')).toHaveCount(
      4,
    );
    await expect(
      dashboard.locator("button, a, input, select, textarea"),
    ).toHaveCount(0);
    await expect(dashboard.locator("[aria-live]")).toHaveCount(0);

    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByRole("heading", { level: 1 })).toBeVisible();
  });
}
