import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 560 },
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
];

const settingsConfig = {
  config_version: 'fixture',
  theme: 'SYSTEM',
  executor_profile: { executor: 'CODEX', variant: null },
  disclaimer_acknowledged: true,
  onboarding_acknowledged: true,
  remote_onboarding_acknowledged: true,
  notifications: {
    sound_enabled: false,
    push_enabled: false,
    sound_file: 'ABSTRACT_SOUND1',
  },
  editor: {
    editor_type: 'VS_CODE',
    custom_command: null,
    remote_ssh_host: null,
    remote_ssh_user: null,
    auto_install_extension: true,
  },
  github: {
    pat: null,
    oauth_token: null,
    username: null,
    primary_email: null,
    default_pr_base: null,
  },
  analytics_enabled: false,
  workspace_dir: null,
  last_app_version: null,
  show_release_notes: false,
  language: 'EN',
  git_branch_prefix: '',
  showcases: { seen_features: [] },
  pr_auto_description_enabled: false,
  pr_auto_description_prompt: null,
  commit_reminder_enabled: false,
  commit_reminder_prompt: null,
  send_message_shortcut: 'ModifierEnter',
  relay_enabled: false,
  host_nickname: null,
  hidden_agents: [],
};

const userSystem = {
  version: '0.1.44',
  config: settingsConfig,
  machine_id: 'fixture-machine',
  login_status: { status: 'loggedout' },
  remote_auth_degraded: null,
  environment: {
    os_type: 'fixture',
    os_version: '1',
    os_architecture: 'x64',
    bitness: '64',
  },
  capabilities: {},
  shared_api_base: null,
  preview_proxy_port: null,
  executors: {},
};

async function installSettingsApi(page: Page) {
  const requestCount = new Map<string, number>();

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const mode = new URL(page.url()).searchParams.get('mode');
    const path = url.pathname;
    const count = (requestCount.get(path) ?? 0) + 1;
    requestCount.set(path, count);

    if (
      mode === 'degraded' &&
      (path.endsWith('/api/relay-auth/client/hosts') ||
        path.endsWith('/api/local/v1/hosts')) &&
      count > 1
    ) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Host discovery temporarily failed' }),
      });
      return;
    }

    if (path.endsWith('/api/info')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: userSystem,
          error_data: null,
          message: null,
        }),
      });
      return;
    }

    if (path.endsWith('/api/relay-auth/client/hosts')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            hosts: [
              {
                host_id: 'remote-1',
                host_name: 'Remote fixture host',
                paired_at: '2026-09-01T00:00:00Z',
              },
            ],
          },
          error_data: null,
          message: null,
        }),
      });
      return;
    }

    if (path.endsWith('/api/local/v1/hosts')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          hosts: [
            {
              id: 'remote-1',
              name: 'Remote fixture host',
              status: mode === 'offline' ? 'offline' : 'online',
            },
          ],
        }),
      });
      return;
    }

    if (path.endsWith('/api/tags')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          error_data: null,
          message: null,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Fixture endpoint not implemented' }),
    });
  });
}

async function openSettings(page: Page, mode?: string) {
  await installSettingsApi(page);
  await page.goto(mode ? `/?mode=${mode}` : '/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-surface')).toBeVisible();
}

async function expectContained(page: Page) {
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

test.describe('P8-R1/A1 Settings, Host, and update surfaces', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px keeps Settings navigation and Host picker usable`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openSettings(page);

      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
      ).toBeVisible();
      await expectContained(page);

      const hostPicker = page.getByLabel('Current host');
      await expect(hostPicker).toBeVisible();
      const hostBox = await hostPicker.boundingBox();
      if (!hostBox) throw new Error('Host picker geometry is unavailable');
      expect(hostBox.height).toBeGreaterThanOrEqual(44);

      const tabs = page.getByRole('navigation', {
        name: 'Settings categories',
      });
      const hostTab = tabs.getByRole('button', { name: 'Current Host' });
      await hostTab.focus();
      await expect(hostTab).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(hostTab).toHaveAttribute('aria-current', 'page');

      const sections = page.getByRole('navigation', {
        name: 'Settings sections',
      });
      const repositories = sections.getByRole('button', {
        name: 'Repositories',
      });
      await repositories.focus();
      await expect(repositories).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(repositories).toHaveAttribute('aria-current', 'page');
    });
  }

  test('375px keeps a restart-ready update action reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSettings(page);
    await page.getByTestId('report-ready').click();

    const updateStatus = page.locator(
      '.vk-settings-page__update-status[data-update-phase="restart-ready"]'
    );
    await expect(updateStatus).toBeVisible();
    const restart = page.getByRole('button', { name: 'Restart and install' });
    await expect(restart).toBeVisible();
    const restartBox = await restart.boundingBox();
    if (!restartBox) throw new Error('Restart action geometry is unavailable');
    expect(restartBox.height).toBeGreaterThanOrEqual(44);
    await restart.focus();
    await expect(restart).toBeFocused();
    await expectContained(page);
  });

  test('offline Host state is announced without a busy signal', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSettings(page, 'offline');

    const offline = page.locator(
      '[data-testid="settings-surface"] [data-state="offline"]'
    );
    await expect(offline).toBeVisible();
    await expect(offline).toHaveAttribute('role', 'status');
    await expect(offline).toHaveAttribute('aria-live', 'polite');
    await expect(offline).not.toHaveAttribute('aria-busy');
    await expect(offline).toContainText('Host unavailable');
    await expectContained(page);
  });

  test('cached Host content reports degraded refresh and keeps retry reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 560 });
    await openSettings(page, 'degraded');
    await page.getByTestId('refresh-host-sources').click();

    const degraded = page.locator(
      '[data-testid="settings-surface"] [data-state="degraded"]'
    );
    await expect(degraded).toBeVisible();
    await expect(degraded).toContainText('read-only');
    const retry = degraded.getByRole('button', { name: 'Retry refresh' });
    await expect(retry).toBeVisible();
    const retryBox = await retry.boundingBox();
    if (!retryBox) throw new Error('Degraded retry geometry is unavailable');
    expect(retryBox.height).toBeGreaterThanOrEqual(44);
    await expectContained(page);
  });
});
