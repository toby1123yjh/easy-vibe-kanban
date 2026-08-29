import { expect, test, type Page } from "@playwright/test";

async function gotoFixture(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Canonical task title" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("fixture-initialized")) return;
    localStorage.clear();
    sessionStorage.setItem("fixture-initialized", "true");
  });
});

test("header keeps canonical task title above issue and workspace context", async ({
  page,
}) => {
  await gotoFixture(page);
  await expect(
    page.getByText("Issue VIB-42 / /workspaces/task-1 / feature/task-1"),
  ).toBeVisible();
});

test("Inspector collapse preserves tab, content, width, and focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoFixture(page);

  const inspector = page.locator(".vk-agent-workbench__inspector");
  await page.getByRole("tab", { name: "Terminal" }).click();
  await page.getByLabel("Terminal buffer").fill("pnpm run check");
  const widthBefore = (await inspector.boundingBox())?.width;

  await page.getByRole("button", { name: "Close Inspector" }).click();
  await expect(inspector).toHaveAttribute("data-visible", "false");
  const open = page.getByRole("button", { name: "Inspector" });
  await expect(open).toBeFocused();
  await open.click();

  await expect(page.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("Terminal buffer")).toHaveValue(
    "pnpm run check",
  );
  await expect(
    page.getByRole("button", { name: "Close Inspector" }),
  ).toBeFocused();
  expect((await inspector.boundingBox())?.width).toBe(widthBefore);
});

test("Inspector separator supports keyboard resizing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoFixture(page);

  const inspector = page.locator(".vk-agent-workbench__inspector");
  const separator = page.getByRole("separator", { name: "Resize Inspector" });
  await separator.focus();
  await expect(separator).toHaveAttribute("aria-valuenow", "380");

  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "396");
  expect((await inspector.boundingBox())?.width).toBe(396);

  await separator.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "320");
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "480");
});

test("drafts are session isolated and acknowledgements preserve newer typing", async ({
  page,
}) => {
  await gotoFixture(page);
  const editor = page.getByPlaceholder("Message session-1");
  await editor.fill("session one draft");
  await page.getByRole("button", { name: "Switch session" }).click();
  await page.getByPlaceholder("Message session-2").fill("session two draft");
  await page.getByRole("button", { name: "Switch session" }).click();
  await expect(editor).toHaveValue("session one draft");

  await page.getByRole("button", { name: "Send snapshot" }).click();
  await editor.fill("newer text");
  await page.getByRole("button", { name: "Acknowledge send" }).click();
  await expect(editor).toHaveValue("newer text");

  await page.reload();
  await expect(page.getByPlaceholder("Message session-1")).toHaveValue(
    "newer text",
  );
});

test("runtime controls remain distinct and expose canonical blocked reasons", async ({
  page,
}) => {
  await gotoFixture(page);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Follow up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Follow up" })).toHaveAttribute(
    "title",
    "provider_capability_missing",
  );
  await expect(page.getByRole("button", { name: "Queue" })).toHaveAttribute(
    "title",
    "runtime_terminal",
  );
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
});

test("narrow layout opens a full-screen Inspector and honors reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoFixture(page);

  const inspector = page.locator(".vk-agent-workbench__inspector");
  const box = await inspector.boundingBox();
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(844);
  await expect(inspector).toHaveCSS("position", "fixed");
  await expect(inspector).toHaveCSS("transition-duration", "0s");

  await page.getByRole("button", { name: "Close Inspector" }).click();
  await expect(page.getByLabel("Conversation timeline")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspector" })).toBeFocused();
});
