import { expect, test } from '@playwright/test';

test('existing sessions can open or delete but cannot change their project', async ({ page }) => {
  let projectReads = 0;
  let moves = 0;
  await page.route('**/api/projects?*', async route => {
    projectReads++;
    await route.fulfill({ json: { success: true, data: { projects: [], next_cursor: null } } });
  });
  await page.route('**/api/sessions/*/project', async route => {
    moves++;
    await route.fulfill({ status: 404 });
  });
  await page.route('**/api/sessions/recent?*', route => route.fulfill({ json: {
    success: true,
    data: { sessions: [{ id: 'session-1', workspace_id: 'workspace-1', task_id: null, title: 'Independent chat' }], next_cursor: null },
  } }));
  await page.goto('/?defaultProject');
  await expect(page.getByRole('heading', { name: 'Default project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Independent chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText('Move to project', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configure default directory in Settings' })).toHaveCount(0);
  expect(projectReads).toBe(0);
  expect(moves).toBe(0);
});

test('session list failure keeps real retry without project move controls', async ({ page }) => {
  let failed = true;
  await page.route('**/api/sessions/recent?*', route => failed
    ? route.fulfill({ status: 500, json: { success: false, message: 'Read failed' } })
    : route.fulfill({ json: { success: true, data: { sessions: [{ id: 's', workspace_id: 'w', task_id: null, title: 'Recovered session' }], next_cursor: null } } }));
  await page.goto('/?defaultProject');
  await expect(page.getByRole('alert')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recovered session' })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
});
