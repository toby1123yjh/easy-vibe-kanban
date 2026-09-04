import { expect, type Locator, test } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 375, height: 760, candidateCount: 1 },
  { name: 'tablet', width: 768, height: 900, candidateCount: 1 },
  { name: 'desktop', width: 1024, height: 900, candidateCount: 3 },
  { name: 'wide', width: 1440, height: 900, candidateCount: 3 },
];

async function expectTouchTargets(locator: Locator, minimum = 44) {
  const undersized = await locator.evaluateAll(
    (items, minimumSize) =>
      items.flatMap((item) => {
        const element = item as HTMLElement;
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const layoutWidth = element.offsetWidth;
        const layoutHeight = element.offsetHeight;
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          bounds.width === 0 ||
          bounds.height === 0
        ) {
          return [];
        }
        if (layoutWidth >= minimumSize && layoutHeight >= minimumSize) {
          return [];
        }
        return [
          {
            label:
              element.getAttribute('aria-label') ??
              element.textContent?.trim() ??
              element.tagName,
            className: element.className,
            width: layoutWidth,
            height: layoutHeight,
            minHeight: style.minHeight,
            rootFontSize: getComputedStyle(document.documentElement).fontSize,
          },
        ];
      }),
    minimum
  );

  expect(undersized).toEqual([]);
}

for (const viewport of viewports) {
  test(`Arena stays contained at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto('/');

    const region = page.getByRole('region', { name: 'Arena' });
    await expect(region).toBeVisible();
    await expect(page.locator('article')).toHaveCount(viewport.candidateCount);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: 'Candidate result' })
    ).toHaveCount(viewport.candidateCount === 1 ? 1 : 0);

    const layout = await page.evaluate(() => {
      const arena = document.querySelector<HTMLElement>('[role="region"]');
      const bounds = arena?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        arenaLeft: bounds?.left ?? -1,
        arenaRight: bounds?.right ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(layout.bodyWidth).toBeLessThanOrEqual(viewport.width);
    expect(layout.arenaLeft).toBeGreaterThanOrEqual(0);
    expect(layout.arenaRight).toBeLessThanOrEqual(viewport.width + 1);
  });
}

for (const viewport of [
  { name: 'desktop', width: 1024 },
  { name: 'wide', width: 1440 },
]) {
  test(`${viewport.name} Arena renders equal candidate columns`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: 900 });
    await page.goto('/');

    await expect(page.locator('article')).toHaveCount(3);
    const boxes = await page.locator('article').evaluateAll((items) =>
      items.map((item) => {
        const bounds = item.getBoundingClientRect();
        return {
          left: Math.round(bounds.left),
          width: Math.round(bounds.width),
        };
      })
    );
    expect(new Set(boxes.map(({ left }) => left)).size).toBe(3);
    expect(
      Math.max(...boxes.map(({ width }) => width)) -
        Math.min(...boxes.map(({ width }) => width))
    ).toBeLessThanOrEqual(1);
  });
}

test('Arena selector fallback follows candidate count and container width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/?many=1');
  await expect(
    page.getByRole('combobox', { name: 'Candidate result' })
  ).toBeVisible();
  await expect(page.locator('article')).toHaveCount(1);

  await page.goto('/?constrained=1');
  await expect(
    page.getByRole('combobox', { name: 'Candidate result' })
  ).toBeVisible();
  await expect(page.locator('article')).toHaveCount(1);
});

test('candidate selector supports keyboard selection and restores focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/?many=1');

  const selector = page.getByRole('combobox', { name: 'Candidate result' });
  await selector.focus();
  await expect(selector).toBeFocused();
  await page.keyboard.press('Enter');

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  // Radix transfers focus to the selected option asynchronously after the
  // popup is mounted. Wait for that handoff before driving the option list.
  await expect(page.getByRole('option').first()).toBeFocused();
  await expectTouchTargets(page.getByRole('option'));
  await page.getByRole('option').first().press('ArrowDown');
  await expect(page.getByRole('option').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(selector).toContainText('Candidate 2');
  await expect(
    page.getByRole('heading', { name: 'Candidate 2' })
  ).toBeVisible();
  await expect(listbox).toBeHidden();
  await expect(selector).toBeFocused();
});

test('Arena controls keep mobile touch targets and menu focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/');

  await expectTouchTargets(page.locator('button, a[href], [role="combobox"]'));

  const moreActions = page.getByRole('button', {
    name: 'More Arena actions',
  });
  await moreActions.focus();
  await expect(moreActions).toBeFocused();
  await page.keyboard.press('Enter');

  const menu = page.getByRole('menu');
  const firstItem = page.getByRole('menuitem').first();
  await expect(menu).toBeVisible();
  await expect(firstItem).toBeFocused();
  await expectTouchTargets(page.getByRole('menuitem'));
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(moreActions).toBeFocused();
});
