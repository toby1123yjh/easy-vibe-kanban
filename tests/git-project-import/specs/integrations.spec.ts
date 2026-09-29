import { expect, test, type Page } from '@playwright/test';

const initial = { id: 'system-1', name: 'Document service', enabled: true, project_ids: ['project-1'], created_at: '2026-09-29T00:00:00Z' };
const key = 'vk_ext_test_key_once';

async function setup(page: Page, failList = false) {
  const writes: unknown[] = [];
  let record = { ...initial };
  await page.route('**/api/integration-settings**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/projects')) {
      return route.fulfill({ json: { success: true, data: [{ id: 'project-1', name: 'Documents' }, { id: 'project-2', name: 'Reports' }] } });
    }
    if (request.method() === 'GET') {
      return route.fulfill({ status: failList ? 500 : 200, json: failList ? { success: false, message: 'Host unavailable' } : { success: true, data: [record] } });
    }
    const body = request.postDataJSON();
    writes.push(body);
    if (path.endsWith('/system-1/enabled')) {
      // Simulate a project auto-granted after the browser loaded the list.
      record = { ...record, enabled: body.enabled, project_ids: [...new Set([...record.project_ids, 'project-3'])] };
      return route.fulfill({ json: { success: true, data: record } });
    }
    if (path.endsWith('/system-1')) {
      record = { ...record, ...body };
      return route.fulfill({ json: { success: true, data: record } });
    }
    return route.fulfill({ json: { success: true, data: { integration: { ...record, ...body }, api_key: key } } });
  });
  await page.goto('/?integrations');
  return writes;
}

test('creates a scoped key, shows it once and never persists the raw key', async ({ page }) => {
  const writes = await setup(page);
  await page.getByRole('button', { name: 'Add integration' }).click();
  await page.getByLabel('System name').fill('Reports service');
  await page.getByRole('checkbox', { name: 'Reports', exact: true }).check();
  await page.getByRole('button', { name: 'Generate API Key' }).click();
  await expect(page.getByLabel('Copy this API Key now. It will not be shown again.')).toHaveValue(key);
  expect(writes).toEqual([{ name: 'Reports service', project_ids: ['project-2'] }]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(key);
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  await expect(page.locator(`input[value="${key}"]`)).toHaveCount(0);
});

test('updates project access and toggles availability without dropping grants', async ({ page }) => {
  const writes = await setup(page);
  await page.getByRole('button', { name: 'Edit access' }).click();
  await page.getByRole('checkbox', { name: 'Reports', exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Enable or disable Document service' });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(writes).toEqual([
    { name: initial.name, enabled: true, project_ids: ['project-1', 'project-2'], expected_project_ids: ['project-1'] },
    { enabled: false },
  ]);
  await expect(page.getByText('Authorized projects: 3')).toBeVisible();
});

test('load failure disables edits instead of pretending the integration list is empty', async ({ page }) => {
  const writes = await setup(page, true);
  await expect(page.getByRole('alert')).toContainText('Could not load integrations');
  await expect(page.getByRole('button', { name: 'Add integration' })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('a stale grant edit keeps its draft and can reload current access', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Edit access' }).click();
  await page.getByLabel('System name').fill('Unsaved name');
  await page.route('**/api/integration-settings/system-1', route => route.fulfill({
    status: 409,
    json: { success: false, message: 'Project access changed while editing. Cancel this edit and reopen it to load the current grants.' },
  }));
  await page.route('**/api/integration-settings', route => route.fulfill({
    json: { success: true, data: [{ ...initial, project_ids: ['project-1', 'project-2'] }] },
  }));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Project access changed');
  await expect(page.getByLabel('System name')).toHaveValue('Unsaved name');
  await expect(page.getByText('Authorized projects: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit access' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reports', exact: true })).toBeChecked();
});

test('switching host removes the previous hosts key and draft', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Add integration' }).click();
  await page.getByLabel('System name').fill('Reports service');
  await page.getByRole('button', { name: 'Generate API Key' }).click();
  await expect(page.locator(`input[value="${key}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Switch host' }).click();
  await expect(page.locator(`input[value="${key}"]`)).toHaveCount(0);
  await expect(page.getByLabel('System name')).toHaveCount(0);
});

test('file results show verified records with a partial warning, and load only when opened', async ({ page }) => {
  let requests = 0;
  await page.route('**/workflow-runs/run-1/file-changes', route => {
    requests += 1;
    return route.fulfill({ json: { files: [{ path: 'report.txt', change_type: 'modified' }, { path: 'obsolete.txt', change_type: 'deleted' }], collection_status: 'partial', reasons: ['unobserved_command_script_mcp_or_provider_writes'] } });
  });
  await page.goto('/?result');
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Execution result' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Report ready');
  await expect(dialog).toContainText('report.txt');
  await expect(dialog).toContainText('Modified');
  await expect(dialog).toContainText('Deleted');
  await expect(dialog).toContainText('This list may be incomplete');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('template access failure is visible and does not optimistically enable the switch', async ({ page }) => {
  await page.route('**/workflows/template-1/external-access', route => route.fulfill({ status: 409, json: { message: 'Template no longer exists' } }));
  await page.goto('/?externalSwitch');
  const toggle = page.getByRole('switch', { name: 'Allow external calls' });
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('Template no longer exists');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
});
