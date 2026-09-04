import { expect, test } from '@playwright/test';

const fixtureNotifications = [
  {
    id: 'notification-unread',
    organization_id: 'org-1',
    user_id: 'fixture-user',
    notification_type: 'issue_comment_added',
    payload: {
      actor_user_id: 'actor-1',
      issue_id: 'issue-1',
      issue_simple_id: 'ISSUE-1',
      issue_title: 'Narrow viewport notification',
    },
    issue_id: 'issue-1',
    comment_id: 'comment-1',
    seen: false,
    dismissed_at: null,
    created_at: '2026-09-03T08:00:00.000Z',
  },
  {
    id: 'notification-read',
    organization_id: 'org-1',
    user_id: 'fixture-user',
    notification_type: 'issue_status_changed',
    payload: {
      actor_user_id: 'actor-1',
      issue_id: 'issue-2',
      issue_simple_id: 'ISSUE-2',
      issue_title: 'Completed notification',
      old_status_name: 'In progress',
      new_status_name: 'Done',
    },
    issue_id: 'issue-2',
    comment_id: null,
    seen: true,
    dismissed_at: null,
    created_at: '2026-09-03T07:00:00.000Z',
  },
];

async function mockNotificationsApi(page: import('@playwright/test').Page) {
  const notificationRows = fixtureNotifications.map((notification) => ({
    ...notification,
    payload: { ...notification.payload },
  }));
  let pendingMutationRefresh = false;

  await page.route(
    '**/api/local/v1/fallback/notifications**',
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      const notifications = pendingMutationRefresh
        ? notificationRows
        : fixtureNotifications;
      pendingMutationRefresh = false;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications }),
      });
    }
  );

  await page.route(
    '**/api/local/v1/organizations/org-1/members**',
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          members: [
            {
              user_id: 'actor-1',
              role: 'MEMBER',
              joined_at: '2026-01-01T00:00:00.000Z',
              first_name: 'Ada',
              last_name: 'Lovelace',
              username: 'ada',
              email: 'ada@example.test',
              avatar_url: null,
            },
          ],
        }),
      });
    }
  );

  await page.route('**/api/local/v1/notifications**', async (route) => {
    if (!['PATCH', 'POST'].includes(route.request().method())) {
      await route.fallback();
      return;
    }

    const requestBody = JSON.parse(route.request().postData() ?? '{}') as {
      id?: string;
      seen?: boolean;
      changes?: { seen?: boolean };
      updates?: Array<{
        id?: string;
        seen?: boolean;
        changes?: { seen?: boolean };
      }>;
    };
    const updates = requestBody.updates ?? [requestBody];
    for (const update of updates) {
      const updateId =
        update.id ??
        (requestBody.updates
          ? undefined
          : new URL(route.request().url()).pathname.split('/').pop());
      const row = notificationRows.find(
        (notification) => notification.id === updateId
      );
      const seen = update.seen ?? update.changes?.seen;
      if (row && typeof seen === 'boolean') {
        row.seen = seen;
      }
    }
    pendingMutationRefresh = true;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ txid: 1 }),
    });
  });
}

async function gotoFixture(page: import('@playwright/test').Page) {
  await mockNotificationsApi(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Floating panel contract' })
  ).toBeVisible();
}

test('200% zoom keeps the floating configuration flow usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await gotoFixture(page);

  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.getByTestId('panel-trigger').click();
  const panel = page.getByRole('dialog', { name: 'Node configuration' });
  await expect(panel).toBeVisible();
  const input = page.getByTestId('panel-input');
  await input.fill('Long localized node title');
  await expect(input).toHaveValue('Long localized node title');
  await expect(input).toBeFocused();
});

test('keyboard focus order and return remain deterministic for a non-modal panel', async ({
  page,
}) => {
  await gotoFixture(page);
  const trigger = page.getByTestId('autofocus-trigger');
  await trigger.focus();
  await trigger.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Close panel', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('reduced motion removes transitions from shared primitives', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoFixture(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          '--vk-duration-normal'
        )
      )
    )
    .toBe('0ms');
  await page.getByTestId('panel-trigger').click();
  await expect(
    page.getByRole('dialog', { name: 'Node configuration' })
  ).toBeVisible();
});

test('export controls remain keyboard reachable with touch-sized targets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoFixture(page);

  const exportSection = page.getByRole('region', { name: 'Export contract' });
  await expect(exportSection).toBeVisible();
  await expect(page.getByLabel('Organization')).toBeVisible();

  const selectAll = exportSection.getByRole('button', { name: 'Deselect all' });
  await expect(selectAll).toHaveCSS('min-height', '44px');
  await expect(
    exportSection.getByRole('button', {
      name: 'Long project name for narrow screens',
    })
  ).toHaveCSS('min-height', '44px');
  await expect(exportSection.getByRole('button', { name: 'Export' })).toHaveCSS(
    'min-height',
    '44px'
  );

  await selectAll.focus();
  await expect(selectAll).toBeFocused();
  await selectAll.press('Enter');
  await expect(
    exportSection.getByRole('button', { name: 'Select all' })
  ).toBeFocused();
  await expect(
    exportSection.getByRole('button', { name: 'Export' })
  ).toBeDisabled();
  await exportSection
    .getByRole('button', { name: 'Select all' })
    .press('Enter');
  await expect(
    exportSection.getByRole('button', { name: 'Export' })
  ).toBeEnabled();
  await exportSection.getByRole('button', { name: 'Export' }).press('Enter');
  await expect(page.getByTestId('export-submitted')).toHaveText(
    'project-1,project-2'
  );
});

test.describe('export responsive contract', () => {
  for (const viewport of [375, 768, 1024, 1440]) {
    test(`${viewport}px keeps export content within the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 812 });
      await gotoFixture(page);

      const section = page.getByRole('region', { name: 'Export contract' });
      const box = await section.boundingBox();
      if (!box) throw new Error('Export geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          }))
        )
        .toEqual({
          viewport,
          document: viewport,
          body: viewport,
        });

      const exportButton = section.getByRole('button', { name: 'Export' });
      await expect(exportButton).toBeVisible();
      if (viewport < 640) {
        await expect(exportButton).toHaveCSS('min-height', '44px');
      }
    });
  }
});

test.describe('crash screen responsive and keyboard contract', () => {
  for (const viewport of [375, 768, 1024, 1440]) {
    test(`${viewport}px keeps recovery controls visible and keyboard usable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 812 });
      await gotoFixture(page);

      const section = page.getByRole('region', {
        name: 'Crash screen contract',
      });
      const alert = section.getByRole('alert');
      const box = await alert.boundingBox();
      if (!box) throw new Error('Crash screen geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport);
      await expect(
        section.getByRole('button', { name: /crashScreen\.reload/ })
      ).toHaveCSS('min-height', '44px');

      const reload = section.getByRole('button', {
        name: /crashScreen\.reload/,
      });
      await reload.focus();
      await expect(reload).toBeFocused();
      await reload.press('Enter');
      await expect(section.getByTestId('crash-reload-count')).toHaveText('1');

      const details = section.getByRole('button', {
        name: /crashScreen\.(showDetails|hideDetails)/,
      });
      await details.focus();
      await details.press('Enter');
      await expect(section.locator('pre')).toBeVisible();
      await details.press('Enter');
      await expect(section.locator('pre')).toBeHidden();
    });
  }
});

test.describe('project sunset responsive contract', () => {
  for (const viewport of [375, 768, 1024, 1440]) {
    test(`${viewport}px keeps recovery actions visible and within the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 812 });
      await gotoFixture(page);

      const section = page.getByRole('region', {
        name: 'Project sunset contract',
      });
      const sunset = section.locator('.fixture-sunset');
      const exportButton = section.getByRole('button', { name: 'Export data' });
      const shutdownLink = section.getByRole('link', {
        name: 'Read about the shutdown',
      });

      await expect(exportButton).toBeVisible();
      await expect(shutdownLink).toBeVisible();
      await expect(exportButton).toHaveCSS('min-height', '44px');
      await expect(shutdownLink).toHaveCSS('min-height', '44px');

      const box = await sunset.boundingBox();
      if (!box) throw new Error('Project sunset geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          }))
        )
        .toEqual({
          viewport,
          document: viewport,
          body: viewport,
        });

      await exportButton.focus();
      await expect(exportButton).toBeFocused();
      await exportButton.press('Enter');
      await expect(section.getByTestId('sunset-destination')).toHaveText(
        'export'
      );
    });
  }
});

test.describe('notifications responsive contract', () => {
  for (const viewport of [375, 768, 1024, 1440]) {
    test(`${viewport}px keeps notifications within the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 812 });
      await gotoFixture(page);

      const section = page.getByRole('region', {
        name: 'Notifications contract',
      });
      const notifications = section.locator('.fixture-notifications');
      await expect(
        section.getByRole('heading', { name: 'Notifications', exact: true })
      ).toBeVisible();

      const box = await notifications.boundingBox();
      if (!box) throw new Error('Notifications geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          }))
        )
        .toEqual({
          viewport,
          document: viewport,
          body: viewport,
        });

      const markAll = section.getByRole('button', {
        name: 'Mark all as read',
      });
      await expect(markAll).toBeVisible();
      await expect(markAll).toHaveCSS('min-height', '44px');

      const openButtons = section.getByRole('button', {
        name: /Open notification:/,
      });
      await expect(openButtons).toHaveCount(2);
      for (const button of await openButtons.all()) {
        await expect(button).toHaveCSS('min-height', '44px');
      }

      const readButtons = section.getByRole('button', {
        name: /Mark notification as read:/,
      });
      await expect(readButtons).toHaveCount(1);
      for (const button of await readButtons.all()) {
        await expect(button).toHaveCSS('min-height', '44px');
      }
    });
  }
});

test('notifications support keyboard focus, individual read, and mark-all actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoFixture(page);

  const section = page.getByRole('region', {
    name: 'Notifications contract',
  });
  const openFirst = section
    .getByRole('button', {
      name: /Open notification:/,
    })
    .first();
  await openFirst.focus();
  await expect(openFirst).toBeFocused();
  await openFirst.press('Enter');

  const readButtons = section.getByRole('button', {
    name: /Mark notification as read:/,
  });
  await expect(readButtons).toHaveCount(0);
  await expect(
    section.getByRole('button', { name: 'Mark all as read' })
  ).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Floating panel contract' })
  ).toBeVisible();
  const reloadedSection = page.getByRole('region', {
    name: 'Notifications contract',
  });

  const markAll = reloadedSection.getByRole('button', {
    name: 'Mark all as read',
  });
  await expect(markAll).toBeVisible();
  await markAll.focus();
  await expect(markAll).toBeFocused();
  await markAll.press('Enter');
  await expect(markAll).toBeHidden();
  await expect(
    reloadedSection.getByRole('button', { name: /Mark notification as read:/ })
  ).toHaveCount(0);
});

test.describe('404 responsive and keyboard contract', () => {
  for (const viewport of [375, 768, 1024, 1440]) {
    test(`${viewport}px keeps the recovery action visible and contained`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 812 });
      await gotoFixture(page);

      const section = page.getByRole('region', { name: '404 page contract' });
      const surface = section.locator('.fixture-not-found');
      const box = await surface.boundingBox();
      if (!box) throw new Error('404 geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          }))
        )
        .toEqual({ viewport, document: viewport, body: viewport });

      const home = section.getByRole('button', { name: 'Back to home' });
      await expect(home).toBeVisible();
      await expect(home).toHaveCSS('min-height', '44px');
      await home.focus();
      await expect(home).toBeFocused();
      await home.press('Enter');
      await expect(section.getByTestId('not-found-destination')).toHaveText(
        'home'
      );
    });
  }
});

test.describe('release notes responsive and keyboard contract', () => {
  for (const viewport of [375, 768, 1024, 1440]) {
    test(`${viewport}px contains long release content and actions`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 812 });
      await gotoFixture(page);

      const section = page.getByRole('region', {
        name: 'Release notes contract',
      });
      const trigger = page.getByTestId('release-notes-trigger');
      await trigger.click();

      const dialog = page.getByRole('dialog', { name: "What's New" });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      if (!box) throw new Error('Release notes geometry is unavailable');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport);
      expect(box.y + box.height).toBeLessThanOrEqual(812);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          }))
        )
        .toEqual({ viewport, document: viewport, body: viewport });

      const body = dialog.locator('.fixture-release-notes-body');
      await expect(body).toBeVisible();
      expect(
        await body.evaluate((element) => element.scrollHeight)
      ).toBeGreaterThan(await body.evaluate((element) => element.clientHeight));
      await expect(dialog.getByTestId('release-notes-close')).toHaveCSS(
        'min-height',
        '44px'
      );
      await expect(
        dialog.getByRole('button', { name: 'Open on GitHub' })
      ).toHaveCSS('min-height', '44px');
    });
  }

  test('keyboard activation closes and returns focus to the trigger', async ({
    page,
  }) => {
    await gotoFixture(page);
    const trigger = page.getByTestId('release-notes-trigger');
    await trigger.focus();
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog', { name: "What's New" });
    await expect(dialog).toBeVisible();
    const close = dialog.getByTestId('release-notes-close');
    await close.focus();
    await expect(close).toBeFocused();
    await close.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
