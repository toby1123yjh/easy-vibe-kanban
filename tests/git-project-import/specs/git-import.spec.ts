import { test, expect, type Page } from '@playwright/test';
const repo = {
  id: 'repo-1',
  name: 'repo',
  display_name: 'repo',
  path: '/workspaces/repo-unique',
};
const job = (state = 'succeeded') => ({
  id: 'job-1',
  request_id: 'request-1',
  url: 'git@github.com:org/repo.git',
  connection_id: null,
  branch: 'main',
  directory_path: repo.path,
  state,
  phase: state,
  progress: state === 'succeeded' ? 100 : 20,
  error: null,
  repo: state === 'succeeded' ? repo : null,
});
async function setup(page: Page, state = 'succeeded') {
  const starts: any[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    let data: unknown = [];
    if (url.endsWith('/inspect'))
      data = {
        url: 'git@github.com:org/repo.git',
        branches: ['main', 'dev'],
        default_branch: 'main',
        suggested_directory: '/workspaces/repo',
      };
    else if (
      url.endsWith('/git-imports') &&
      route.request().method() === 'POST'
    ) {
      starts.push(route.request().postDataJSON());
      data = job(state);
    } else if (url.endsWith('/cancel')) data = job('cancelled');
    else if (url.includes('/git-imports/')) data = job(state);
    await route.fulfill({ json: { success: true, data, message: null } });
  });
  return starts;
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Open create project' }).click();
  await page.getByLabel('Project name').fill('Imported project');
  await page
    .getByRole('radio', { name: 'Git repository', exact: true })
    .check();
  await page
    .getByLabel('Repository URL', { exact: true })
    .fill('git@github.com:org/repo.git');
  await page.getByRole('button', { name: 'Read branches' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Branch', exact: true }),
  ).toHaveValue('main');
}
test('clone precedes project creation; project creation failure retries without cloning again', async ({
  page,
}) => {
  const starts = await setup(page);
  await page.goto('/?failCreate');
  await open(page);
  await expect(
    page.getByRole('button', { name: 'Create Project', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Download repository' }).click();
  await expect(
    page.getByRole('button', { name: 'Create Project', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => document.documentElement.dataset.inserts),
  ).toBeUndefined();
  await page
    .getByRole('button', { name: 'Create Project', exact: true })
    .click();
  await expect(page.getByText('Project persistence failed')).toBeVisible();
  await page
    .getByRole('button', { name: 'Create Project', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(starts).toHaveLength(1);
  expect(starts[0]).toMatchObject({
    directory_path: null,
    branch: 'main',
    connection_id: null,
  });
});
test('association failure retries same project and downloaded Repo', async ({
  page,
}) => {
  const starts = await setup(page);
  await page.goto('/?fail');
  await open(page);
  await page.getByRole('button', { name: 'Download repository' }).click();
  await page
    .getByRole('button', { name: 'Create Project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry saving directory', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Retry saving directory', exact: true })
    .click();
  expect(starts).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      JSON.parse(document.documentElement.dataset.inserts!),
    ),
  ).toHaveLength(1);
});
test('running clone blocks close and project creation; cancel keeps path and retry allocates a new request', async ({
  page,
}) => {
  const starts = await setup(page, 'running');
  await page.goto('/');
  await open(page);
  await page.getByRole('button', { name: 'Download repository' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel download' }).click();
  await expect(page.getByText(/Partial files are kept/)).toBeVisible();
  await page.getByRole('button', { name: 'Prepare retry' }).click();
  await page.getByRole('button', { name: 'Download repository' }).click();
  expect(starts).toHaveLength(2);
  expect(starts[0].request_id).not.toBe(starts[1].request_id);
});
test('private-key connection saves input-only credentials; editing retains them with null', async ({
  page,
}) => {
  const writes: any[] = [];
  let connections: any[] = [];
  await page.route('**/api/git-connections**', async (route) => {
    let data: unknown = connections;
    if (['POST', 'PUT'].includes(route.request().method())) {
      const input = route.request().postDataJSON();
      writes.push(input);
      const connection = {
        id: 'c1',
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        auth_mode: input.auth_mode,
        fingerprint: 'SHA256:fixture',
        has_passphrase: true,
        credential_ready: true,
        credential_error: null,
      };
      connections = [connection];
      data = connection;
    }
    await route.fulfill({ json: { success: true, data, message: null } });
  });
  await page.goto('/?settings');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Connection name').fill('Personal GitHub');
  await page.getByLabel('Authentication').selectOption('private_key');
  await page
    .getByLabel('Private key', { exact: true })
    .fill('TEST PRIVATE KEY');
  await page.getByLabel('Key passphrase (optional)').fill('test-only');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('SHA256:fixture')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Private key', { exact: true })).toHaveValue('');
  await page.getByLabel('Connection name').fill('Renamed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(writes[1]).toMatchObject({
    private_key: null,
    password: null,
    name: 'Renamed',
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Key passphrase (optional)').fill('temporary');
  await page.getByLabel('Key passphrase (optional)').fill('');
  await page
    .getByLabel('Import private key file')
    .setInputFiles({
      name: 'new.key',
      mimeType: 'text/plain',
      buffer: Buffer.from('NEW TEST KEY'),
    });
  await expect(page.getByLabel('Private key', { exact: true })).toHaveValue(
    'NEW TEST KEY',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(writes[2]).toMatchObject({
    private_key: 'NEW TEST KEY',
    password: '',
  });
});

test('reload reconnects to the canonical clone without starting another download', async ({
  page,
}) => {
  const starts = await setup(page, 'running');
  await page.goto('/');
  await open(page);
  await page.getByRole('button', { name: 'Download repository' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel download' }),
  ).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Open create project' }).click();
  await page
    .getByRole('radio', { name: 'Git repository', exact: true })
    .check();
  await expect(
    page.getByRole('button', { name: 'Cancel download' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create Project', exact: true }),
  ).toBeDisabled();
  expect(starts).toHaveLength(1);
});

test('lost start response recovers the same saved request after reload only on explicit action', async ({
  page,
}) => {
  const starts = await setup(page);
  const lost: unknown[] = [];
  await page.route('**/api/git-imports', async (route) => {
    lost.push(route.request().postDataJSON());
    await route.abort('failed');
  });
  await page.goto('/');
  await open(page);
  await page.getByRole('button', { name: 'Download repository' }).click();
  await expect(
    page.getByRole('button', { name: 'Recover download request' }),
  ).toBeEnabled();
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.unroute('**/api/git-imports');
  await page.getByRole('button', { name: 'Open create project' }).click();
  await page
    .getByRole('radio', { name: 'Git repository', exact: true })
    .check();
  await expect(
    page.getByRole('button', { name: 'Recover download request' }),
  ).toBeEnabled();
  expect(starts).toHaveLength(0);
  await page.getByRole('button', { name: 'Recover download request' }).click();
  await expect(
    page.getByRole('button', { name: 'Create Project', exact: true }),
  ).toBeDisabled();
  expect(starts[0]).toEqual(lost[0]);
});

test('parent folder browsing chooses a new child rather than overwriting the parent', async ({
  page,
}) => {
  const starts = await setup(page);
  await page.route('**/api/filesystem/pick-folder', (route) =>
    route.fulfill({
      json: { success: true, data: 'F:\\sources', message: null },
    }),
  );
  await page.goto('/');
  await open(page);
  await page.getByRole('button', { name: 'Choose parent folder' }).click();
  await expect(page.getByLabel('Download directory')).toHaveValue(
    'F:\\sources\\repo',
  );
  await page.getByRole('button', { name: 'Download repository' }).click();
  expect(starts[0].directory_path).toBe('F:\\sources\\repo');
});

test('success during Host degradation is delivered only after that Host recovers', async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/git-imports', async (route) => {
    await held;
    await route.fulfill({
      json: { success: true, data: job(), message: null },
    });
  });
  await page.goto('/?panel');
  await page.getByLabel('Repository URL').fill('git@github.com:org/repo.git');
  await page.getByRole('button', { name: 'Read branches' }).click();
  await page.getByRole('button', { name: 'Download repository' }).click();
  await page.getByRole('button', { name: 'Toggle availability' }).click();
  release();
  await expect(page.getByText('Repository downloaded')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.ready),
  ).toBeUndefined();
  await page.getByRole('button', { name: 'Toggle availability' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.ready))
    .toContain(repo.path);
});

test('connection save settling during degradation unlocks the editor after recovery', async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/git-connections', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.fulfill({ json: { success: true, data: [], message: null } });
  });
  await page.goto('/?settings');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Connection name').fill('Native');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle availability' }).click();
  release();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Toggle availability' }).click();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Connection name')).toHaveValue('Native');
});

test('delayed private-key import cannot modify a cancelled draft', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/?settings');
  await page.evaluate(() => {
    File.prototype.text = () =>
      new Promise((resolve) => {
        (window as any).resolveFile = () => resolve('OLD PRIVATE KEY');
      });
  });
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Authentication').selectOption('private_key');
  await page.getByLabel('Import private key file').setInputFiles({
    name: 'fixture.key',
    mimeType: 'text/plain',
    buffer: Buffer.from('OLD PRIVATE KEY'),
  });
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as any).resolveFile());
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Authentication').selectOption('private_key');
  await expect(page.getByLabel('Private key', { exact: true })).toHaveValue('');
});

test('Git form fits a narrow viewport without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await page.goto('/');
  await open(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test('retrying a recovered cancelled job cannot revive its obsolete recovery record', async ({
  page,
}) => {
  await setup(page, 'cancelled');
  await page.goto('/?panel');
  await page.getByLabel('Repository URL').fill('git@github.com:org/repo.git');
  await page.getByRole('button', { name: 'Read branches' }).click();
  await page.getByRole('button', { name: 'Download repository' }).click();
  await expect(
    page.getByRole('button', { name: 'Prepare retry' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Prepare retry' }).click();
  await page.getByRole('button', { name: 'Toggle availability' }).click();
  await page.getByRole('button', { name: 'Toggle availability' }).click();
  await expect(
    page.getByRole('button', { name: 'Download repository' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Prepare retry' }),
  ).not.toBeVisible();
});

test('connection test reports transport failure; delete failure keeps the saved connection', async ({
  page,
}) => {
  const connection = {
    id: 'c1',
    name: 'Native',
    host: 'github.com',
    port: 22,
    username: 'git',
    auth_mode: 'native',
    credential_ready: true,
    credential_error: null,
    fingerprint: null,
  };
  await page.route('**/api/git-connections**', async (route) => {
    if (route.request().method() !== 'GET')
      return route.fulfill({
        status: 409,
        json: {
          success: false,
          data: null,
          message: 'Connection is currently in use',
        },
      });
    await route.fulfill({
      json: { success: true, data: [connection], message: null },
    });
  });
  await page.goto('/?settings');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page
    .getByLabel('Repository URL to test')
    .fill('git@github.com:org/repo.git');
  await page.getByRole('button', { name: 'Test', exact: true }).last().click();
  await expect(page.getByText('Connection is currently in use')).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete connection', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  await expect(page.getByText('Connection is currently in use')).toBeVisible();
  await expect(page.getByText('Native', { exact: true })).toBeVisible();
});

test('connection editor is cleared on Host switch without copying credentials', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/?settings');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Authentication').selectOption('private_key');
  await page.getByLabel('Private key', { exact: true }).fill('HOST A KEY');
  await page.getByRole('button', { name: 'Switch host' }).click();
  await expect(
    page.getByLabel('Private key', { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add connection' }),
  ).toBeVisible();
});
