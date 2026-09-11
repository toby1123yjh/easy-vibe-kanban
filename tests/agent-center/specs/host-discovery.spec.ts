import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    agentCenterCalls: { relay: number; paired: number; garage: number };
  }
}

test('signed-out local users do not query cloud discovery', async ({
  page,
}) => {
  await page.goto('/?signedOut=true&cloudError=true');
  await expect(page.locator('#agent-center-title')).toBeVisible();
  await page.getByRole('button', { name: 'Rescan host', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Rescan host', exact: true })
  ).toBeEnabled();
  expect(await page.evaluate(() => window.agentCenterCalls.relay)).toBe(0);
  await expect(page.getByText(/Could not load remote hosts/)).toHaveCount(0);
});

test('cloud failure has separate retry and does not degrade local scan', async ({
  page,
}) => {
  await page.goto('/?cloudError=true');
  await expect(page.locator('#agent-center-title')).toBeVisible();
  await expect(page.getByText(/Could not load remote hosts/)).toBeVisible();
  const discovery = page.getByTestId('host-discovery-probe');
  await expect(discovery).toHaveAttribute('data-canonical', 'true');
  await expect(discovery).toHaveAttribute('data-host-error', 'false');
  await expect(discovery).toHaveAttribute('data-remote-error', 'true');
  await expect(page.getByText('Could not rescan this host.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rescan host', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Rescan host', exact: true })
  ).toBeEnabled();
  expect(await page.evaluate(() => window.agentCenterCalls.relay)).toBe(1);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.agentCenterCalls.relay))
    .toBe(2);
  await expect(page.getByText('PRIVATE_CLOUD_ERROR')).toHaveCount(0);
});

for (const query of ['cloudError=true', 'signedOut=true']) {
  test(`explicit remote target never falls back to local: ${query}`, async ({
    page,
  }) => {
    await page.goto(`/?host=remote-fixture&${query}`);
    await expect(
      page.getByRole('status').or(page.getByRole('alert'))
    ).toBeVisible();
    await expect(page.locator('#agent-center-title')).toHaveCount(0);
    expect(await page.evaluate(() => window.agentCenterCalls.garage)).toBe(0);
  });
}

test('real local scan failure remains visible', async ({ page }) => {
  await page.goto('/?signedOut=true&scanError=true');
  await expect(
    page.getByRole('heading', { name: 'Codex', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rescan host', exact: true }).click();
  await expect(
    page.locator('.vk-agent-center__refresh-diagnostics')
  ).toBeVisible();
  await expect(page.getByText('PRIVATE_SCAN_ERROR')).toHaveCount(0);
});
