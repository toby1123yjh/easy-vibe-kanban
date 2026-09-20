import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`${theme} ${width}px confirmation separates content and safe actions without overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/?confirmation=true');
      const trigger = page.getByTestId('confirmation-open');
      await trigger.click();
      const dialog = page.getByRole('alertdialog');
      const cancel = dialog.getByRole('button', { name: '取消' });
      await expect(cancel).toBeFocused();
      await expect(dialog).toContainText('very-long-directory-name-');
      await dialog.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished)
        );
      });
      const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          inner: element.clientWidth,
          scroll: element.scrollWidth,
          titleSize: getComputedStyle(element.querySelector('h2')!).fontSize,
          bodySize: getComputedStyle(element.querySelector('p')!).fontSize,
          padding: getComputedStyle(element).paddingTop,
          footerBorder: getComputedStyle(
            element.querySelector('.vk-confirm-dialog__footer')!
          ).borderTopWidth,
          footerAlignment: getComputedStyle(
            element.querySelector('.vk-confirm-dialog__footer')!
          ).justifyContent,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(15);
      expect(geometry.right).toBeLessThanOrEqual(width - 15);
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.inner);
      if (width === 1280) expect(geometry.width).toBeCloseTo(560, 0);
      expect(geometry.titleSize).toBe('18px');
      expect(geometry.bodySize).toBe('14px');
      expect(geometry.padding).toBe(width === 375 ? '16px' : '24px');
      expect(geometry.footerBorder).toBe('1px');
      expect(geometry.footerAlignment).toBe('flex-end');
      if (width === 375) {
        expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.getByTestId('confirmation-result')).toHaveText(
        'canceled'
      );
    });
  }
}

test('single acknowledgement focuses its sole action and resolves', async ({
  page,
}) => {
  await page.goto('/?confirmation=true');
  const trigger = page.getByTestId('confirmation-single');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button')).toHaveCount(1);
  const confirm = dialog.getByRole('button', { name: '确定' });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('confirmation-result')).toHaveText('confirmed');
});

test('pending confirmation blocks repeat confirmation, cancellation and dismissal', async ({
  page,
}) => {
  await page.goto('/?confirmation=true');
  await page.getByTestId('confirmation-open').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(dialog.getByRole('button', { name: '处理中' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('confirmation-result')).toHaveText('none');
});
