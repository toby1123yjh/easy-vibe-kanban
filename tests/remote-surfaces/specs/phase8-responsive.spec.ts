import { expect, test } from '@playwright/test';

const viewports = [375, 768, 1024, 1440];

async function expectContained(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
    )
    .toEqual({
      viewport: await page.evaluate(() => window.innerWidth),
      document: await page.evaluate(() => window.innerWidth),
      body: await page.evaluate(() => window.innerWidth),
    });
}

for (const width of viewports) {
  test(`Remote login is contained and keyboard operable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?page=login');
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expectContained(page);

    const email = page.getByLabel('Email');
    await email.focus();
    await expect(email).toBeFocused();
    if (width === 375) {
      expect((await email.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
        44
      );
    }
  });

  test(`Invitation is contained and provider actions are focusable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?page=invitation');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "You're invited"
    );
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub' })
    ).toBeVisible();
    await expectContained(page);

    const provider = page.getByRole('button', { name: 'Continue with GitHub' });
    await provider.focus();
    await expect(provider).toBeFocused();
    if (width === 375) {
      expect(
        (await provider.boundingBox())?.height ?? 0
      ).toBeGreaterThanOrEqual(44);
    }
  });

  test(`Remote Home keeps organization and project actions usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?page=home');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Organizations'
    );
    await expect(
      page.getByRole('link', { name: /Open project/ }).first()
    ).toBeVisible();
    await expectContained(page);

    const project = page.getByRole('link', { name: /Open project/ }).first();
    await project.focus();
    await expect(project).toBeFocused();
    await project.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.lastNavigation))
      .toContain('/projects/');
  });
}
