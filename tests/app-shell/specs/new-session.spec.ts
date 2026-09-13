import { expect, test } from "@playwright/test";

for (const state of ["ready", "empty", "initial error"]) {
  test(`new session stays reachable with ${state} discovery`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    if (state !== "ready") {
      await page.getByRole("button", { name: `Set sessions ${state}` }).click();
    }
    const sidebar = page.locator(".vk-product-sidebar");
    const rowsBefore = await sidebar
      .locator(".vk-object-link--session")
      .count();
    const create = sidebar.getByRole("button", {
      name: "New session",
      exact: true,
    });
    await create.scrollIntoViewIfNeeded();
    await create.focus();
    await expect(create).toBeFocused();
    await create.press("Enter");
    await expect(page.getByTestId("current-route")).toHaveText(
      "/workspaces/create",
    );
    await expect(sidebar.locator(".vk-object-link--session")).toHaveCount(
      rowsBefore,
    );
  });
}

for (const width of [375, 900]) {
  test(`new session closes object browser at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", {
        name: width < 768 ? "Browse" : "Browse projects and sessions",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "New session", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("current-route")).toHaveText(
      "/workspaces/create",
    );
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("main")).not.toHaveAttribute("inert");
  });
}

test("unavailable session creation explains why and cannot navigate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?noHost=1");
  const create = page
    .locator(".vk-product-sidebar")
    .getByRole("button", { name: "New session" });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await expect(create).toHaveAccessibleDescription(
    "Connect an online Host before starting a session.",
  );
  await create.focus();
  await expect(create).toBeFocused();
  await create.press("Enter");
  await expect(page.getByTestId("current-route")).toHaveText("/dashboard");
});

test.describe("touch input", () => {
  test.use({ hasTouch: true });
  test("new session has a touch-friendly target and translated label", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?locale=zh-Hans");
    await page.locator(".vk-mobile-header__actions > button").first().click();
    const create = page
      .getByRole("dialog")
      .getByRole("button", { name: "新建会话", exact: true });
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeVisible();
    const bounds = await create.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await create.click();
    await expect(page.getByTestId("current-route")).toHaveText(
      "/workspaces/create",
    );
  });
});
