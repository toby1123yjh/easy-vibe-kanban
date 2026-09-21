import { expect, test } from "@playwright/test";

test("mounted navigation and open search switch language together", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".vk-product-sidebar")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  const moduleUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/web-core/src/i18n/config.ts`;
  await page.evaluate(async (url) => {
    const { default: i18n } = await import(url);
    await i18n.changeLanguage("zh-Hans");
  }, moduleUrl);
  await expect(
    page
      .locator(".vk-product-sidebar")
      .getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
  await page.evaluate(async (url) => {
    const { default: i18n } = await import(url);
    await i18n.changeLanguage("en");
  }, moduleUrl);
  await expect(
    page.getByRole("dialog", { name: "Global search" }),
  ).toBeVisible();
});
