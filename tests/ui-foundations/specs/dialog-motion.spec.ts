import { expect, test } from '@playwright/test';

test('dialog animates without replacing its centering transform and exits faster', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('release-notes-trigger').click();
  const dialog = page.getByRole('dialog');
  const motion = await dialog.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    const centers = [0, 90, 180].map((time) => {
      animation.currentTime = time;
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const duration = getComputedStyle(element).animationDuration;
    animation.finish();
    return { centers, duration, width: innerWidth, height: innerHeight };
  });
  expect(motion.duration).toBe('0.18s');
  for (const center of motion.centers) {
    expect(center.x).toBeCloseTo(motion.width / 2, 0);
    expect(center.y).toBeCloseTo(motion.height / 2, 0);
  }
  await page.getByTestId('release-notes-close').evaluate((element: HTMLButtonElement) => element.click());
  const exitDuration = await dialog.evaluate((element) => getComputedStyle(element).animationDuration);
  expect(exitDuration).toBe('0.12s');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('release-notes-trigger')).toBeFocused();
});

test('legacy dialog has a noninteractive exit and supports reopen and reduced motion', async ({ page }) => {
  await page.goto('/');
  const open = page.getByTestId('keyboard-motion-open');
  const dialog = page.getByTestId('keyboard-motion-dialog');
  await open.click();
  await expect(dialog).toHaveAttribute('data-state', 'open');
  await page.getByTestId('keyboard-motion-close').evaluate((element: HTMLButtonElement) => element.click());
  await expect(dialog).toHaveAttribute('data-state', 'closed');
  expect(await dialog.evaluate((element) => element.parentElement?.inert)).toBe(true);
  expect(await dialog.evaluate((element) => getComputedStyle(element).animationFillMode)).toBe('forwards');
  // Reopening before the close timer completes must not remove the new dialog.
  await open.evaluate((element: HTMLButtonElement) => element.click());
  await page.waitForTimeout(250);
  await expect(dialog).toHaveAttribute('data-state', 'open');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await dialog.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThan(0.001);
  await page.getByTestId('keyboard-motion-close').click();
  await expect(dialog).toHaveCount(0);
});

test('legacy dialog cleans up when animation CSS is unavailable', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: '.vk-dialog-content-motion { animation: none !important; }' });
  await page.getByTestId('keyboard-motion-open').click();
  await expect(page.getByTestId('keyboard-motion-dialog')).toBeVisible();
  await page.getByTestId('keyboard-motion-close').click();
  await expect(page.getByTestId('keyboard-motion-dialog')).toHaveCount(0);
});
