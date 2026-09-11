import { expect, test, type Locator, type Page } from "@playwright/test";

function canvas(page: Page) {
  return page.getByTestId("visual-canvas");
}

async function viewportTransform(page: Page) {
  return canvas(page).locator(".react-flow__viewport").getAttribute("style");
}

async function styleOf(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      radius: parseFloat(style.borderRadius),
      animation: style.animationName,
      beforeAnimation: getComputedStyle(element, "::before").animationName,
      afterAnimation: getComputedStyle(element, "::after").animationName,
    };
  });
}

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  // The fixture is intentionally API-free. Fail closed if it starts requesting
  // a real backend; fonts are irrelevant to these deterministic style checks.
  await page.route("**/api/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("uses one quiet background and readable cards in both themes without resetting the graph", async ({
  page,
}) => {
  await page.goto("/visual.html");
  const node = page.getByTestId("workflow-node-plan");
  await expect(node).toBeVisible();
  await expect(canvas(page).locator(".react-flow__background")).toHaveCount(1);
  await expect(canvas(page).locator(".react-flow__pane")).toHaveCSS(
    "background-image",
    "none",
  );
  await expect(node).toHaveCSS("width", "248px");
  const light = await styleOf(node);
  expect(luminance(light.background)).toBeGreaterThan(0.8);
  expect(contrast(light.color, light.background)).toBeGreaterThanOrEqual(4.5);
  expect(light.radius).toBeGreaterThanOrEqual(4);
  expect(light.radius).toBeLessThanOrEqual(6);
  await expect(page.getByTestId("workflow-node-start")).toHaveText("Start");
  const transform = await viewportTransform(page);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(async () => luminance((await styleOf(node)).background))
    .toBeLessThan(0.08);
  const dark = await styleOf(node);
  expect(luminance(dark.background)).toBeLessThan(0.08);
  expect(contrast(dark.color, dark.background)).toBeGreaterThanOrEqual(4.5);
  expect(await viewportTransform(page)).toBe(transform);
  await expect(canvas(page).locator(".react-flow")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(node).toHaveCSS("background-color", light.background);
  expect(await viewportTransform(page)).toBe(transform);
});

test("selection stays static and configuration switches in the same nonmodal inset frame", async ({
  page,
}) => {
  await page.goto("/visual.html");
  const plan = page.getByTestId("workflow-node-plan");
  await expect(plan).toBeVisible();
  const transform = await viewportTransform(page);
  const canvasBox = await canvas(page).boundingBox();
  await plan.click();
  const frame = page.locator(".workflow-configuration-frame");
  await expect(frame).toBeVisible();
  await expect(frame).not.toHaveAttribute("aria-modal", "true");
  await expect(frame.getByRole("heading")).toHaveText("Plan the change");
  const frameElement = await frame.elementHandle();
  const box = await frame.boundingBox();
  expect(box!.x).toBeGreaterThan(900);
  expect(box!.x + box!.width).toBeLessThan(1600);
  const toolbarBox = await page.locator("header").boundingBox();
  expect(box!.y).toBeGreaterThan(toolbarBox!.y + toolbarBox!.height);
  expect(box!.y + box!.height).toBeLessThan(900);
  expect(await viewportTransform(page)).toBe(transform);
  expect(await canvas(page).boundingBox()).toEqual(canvasBox);
  const selectedStyle = await styleOf(plan);
  expect(selectedStyle.animation).toBe("none");
  expect(selectedStyle.beforeAnimation).toBe("none");
  expect(selectedStyle.afterAnimation).toBe("none");

  await frame.getByRole("textbox", { name: "Task name" }).fill("Keep my draft");
  await expect(plan).toContainText("Keep my draft");
  await expect(
    canvas(page).locator('.react-flow__node[data-id="plan"]'),
  ).toHaveClass(/selected/);
  const scroll = frame.locator("[data-object-content-key]");
  await scroll.evaluate((element) => {
    element.scrollTop = 240;
  });
  await page
    .getByTestId("workflow-node-build")
    .click({ position: { x: 30, y: 30 } });
  await expect(frame.getByRole("heading")).toHaveText("Implement the change");
  expect(
    await frameElement!.evaluate(
      (element) =>
        element === document.querySelector(".workflow-configuration-frame"),
    ),
  ).toBe(true);
  expect(await viewportTransform(page)).toBe(transform);
  await plan.click();
  await expect(frame.getByRole("textbox")).toHaveValue("Keep my draft");
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBe(240);
  // Keyboard focus can leave the nonmodal panel; it is not a trapped drawer.
  await page.getByRole("button", { name: "Dark", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "Dark", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Dark", exact: true }).press("Enter");
  await expect(frame.getByRole("textbox")).toHaveValue("Keep my draft");
  expect(await viewportTransform(page)).toBe(transform);
});

test("only running edges animate and terminal updates retain viewport and selection", async ({
  page,
}) => {
  await page.goto("/visual.html?mode=run");
  const node = page.getByTestId("workflow-run-node-build");
  await expect(node).toBeVisible();
  await expect(canvas(page).locator(".react-flow__background")).toHaveCount(1);
  await expect(node).toHaveCSS("width", "248px");
  await expect
    .poll(async () =>
      canvas(page).locator(".workflow-edge-beam-running").count(),
    )
    .toBeGreaterThan(0);
  const runningBeam = canvas(page)
    .locator(".workflow-edge-beam-running")
    .first();
  await expect(runningBeam).not.toHaveCSS("animation-name", "none");
  expect((await styleOf(node)).beforeAnimation).toBe("none");
  await node.click();
  const transform = await viewportTransform(page);
  await page.getByRole("button", { name: "Complete run" }).click();
  await expect(canvas(page).locator(".workflow-edge-beam-running")).toHaveCount(
    0,
  );
  await expect(node).toContainText("Succeeded");
  await expect(
    canvas(page).locator('.react-flow__node[data-id="build"]'),
  ).toHaveClass(/selected/);
  expect(await viewportTransform(page)).toBe(transform);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect
    .poll(async () => luminance((await styleOf(node)).background))
    .toBeLessThan(0.08);
  expect(
    contrast((await styleOf(node)).color, (await styleOf(node)).background),
  ).toBeGreaterThanOrEqual(4.5);
  expect(await viewportTransform(page)).toBe(transform);
});

test("System theme follows the OS and reduced motion removes canvas and frame effects", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/visual.html");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const plan = page.getByTestId("workflow-node-plan");
  await plan.click();
  await expect(page.locator(".workflow-configuration-frame")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".workflow-side-panel-content")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.goto("/visual.html?mode=run");
  await expect(page.getByTestId("workflow-run-node-build")).toBeVisible();
  await expect(
    canvas(page).locator(".workflow-edge-beam-running").first(),
  ).toHaveCSS("animation-name", "none");
});

test("explicit fit animates smoothly and reacts to a reduced-motion preference change", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/visual.html");
  await expect(page.getByTestId("workflow-node-plan")).toBeVisible();
  const original = await viewportTransform(page);

  async function fitFrames() {
    await canvas(page).locator(".react-flow__controls-zoomout").click();
    await expect.poll(() => viewportTransform(page)).not.toBe(original);
    return canvas(page).evaluate(async (element) => {
      const viewport = element.querySelector<HTMLElement>(
        ".react-flow__viewport",
      )!;
      const fit = element.querySelector<HTMLButtonElement>(
        ".react-flow__controls-fitview",
      )!;
      const positions = new Set<string>();
      fit.click();
      const started = performance.now();
      while (performance.now() - started < 360) {
        await new Promise(requestAnimationFrame);
        positions.add(viewport.style.transform);
      }
      return positions.size;
    });
  }

  expect(await fitFrames()).toBeGreaterThan(3);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await fitFrames()).toBeLessThanOrEqual(2);
});
