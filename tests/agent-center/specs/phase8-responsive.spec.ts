import { expect, test } from '@playwright/test';

const viewports = [375, 768, 1024, 1440] as const;

for (const width of viewports) {
  test(`Agent Center fits ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.locator('#agent-center-title')).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(metrics.documentWidth).toBe(metrics.viewport);
    expect(metrics.bodyWidth).toBe(metrics.viewport);

    await expect(
      page.getByRole('button', { name: 'Providers', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Claude Code/ })
    ).toBeVisible();
  });
}

test('Agent Center keeps narrow provider rail scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const providers = page.locator('.vk-agent-center__providers');
  await expect(providers).toBeVisible();
  const overflow = await providers.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  expect(
    await page
      .getByRole('button', { name: 'Claude Code' })
      .evaluate((element) => element.getBoundingClientRect().height)
  ).toBeGreaterThanOrEqual(44);
});

test('Agent Center supports keyboard provider and tab activation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/');
  const claude = page.getByRole('button', { name: /^Claude Code/ });
  await claude.focus();
  await expect(claude).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(claude).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'Claude Code' })
  ).toBeVisible();

  const mcp = page.getByRole('button', { name: 'MCP', exact: true });
  await mcp.focus();
  await expect(mcp).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mcp).toHaveAttribute('aria-current', 'page');
});

test('Agent Center controls expose 44px touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const heights = await page
    .locator('.vk-agent-center button, .vk-agent-center select')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height)
    );
  expect(heights.length).toBeGreaterThan(4);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});

test('Agent Center disables spinner motion when reduced motion is requested', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const animation = await page.evaluate(() => {
    const marker = document.createElement('span');
    marker.className = 'vk-agent-center-spin';
    document.body.append(marker);
    const animationName = getComputedStyle(marker).animationName;
    marker.remove();
    return animationName;
  });
  expect(animation).toBe('none');
});
