import { expect, test, type Page } from '@playwright/test';
import type { SessionListItem, TaskSummary } from '../../../shared/types';

const timestamp = '2026-09-08T00:00:00Z';
function task(id: number): TaskSummary {
  return {
    id: `task-${id}`,
    project_id: 'project-1',
    issue_id: 'issue-1',
    parent_task_id: null,
    title: `Task ${id}`,
    execution_kind: 'agent',
    status: 'succeeded',
    open_target: {
      kind: 'agent',
      session_id: `session-${id}`,
      workspace_id: 'workspace-1',
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}
function session(id: number): SessionListItem {
  return {
    id: `session-${id}`,
    workspace_id: 'workspace-1',
    task_id: id < 3 ? `task-${id}` : null,
    project_id: id < 3 ? 'project-1' : null,
    issue_id: id < 3 ? 'issue-1' : null,
    title: id < 3 ? `Task ${id}` : 'Standalone',
    executor: 'CODEX',
    created_at: timestamp,
    updated_at: timestamp,
  };
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function setup(page: Page) {
  const state = {
    tasks: [task(1), task(2)],
    sessions: [session(1), session(2), session(3)],
    lookups: 0,
    lookupError: false,
    deleteError: false,
    requiresStop: false,
    stopRequests: 0,
    staleBinding: false,
    gate: null as ReturnType<typeof deferred> | null,
    writes: [] as {
      path: string;
      session: string | null;
      host: string | null;
      scope: string | null;
    }[],
    unexpectedRequests: [] as string[],
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      state.unexpectedRequests.push(url.pathname);
      return route.abort();
    }
    if (!url.pathname.startsWith('/__fixture/')) return route.continue();
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, json: data });
    const success = (data: unknown) =>
      json({ success: true, data, message: null });
    if (url.pathname === '/__fixture/tasks') return json(state.tasks);
    if (url.pathname === '/__fixture/sessions') return json(state.sessions);
    const match = url.pathname.match(
      /^\/__fixture\/api\/sessions\/([^/]+)\/task$/
    );
    if (match) {
      state.lookups++;
      if (state.lookupError)
        return json({ success: false, message: 'Binding lookup failed' }, 503);
      const found = state.staleBinding
        ? null
        : (state.tasks.find(
            (row) =>
              row.open_target.kind === 'agent' &&
              row.open_target.session_id === match[1]
          ) ?? null);
      return success(found);
    }
    if (route.request().method() === 'DELETE') {
      if (url.searchParams.get('stop_running') === 'true') state.stopRequests++;
      state.writes.push({
        path: url.pathname,
        session: url.searchParams.get('session_id'),
        host: url.searchParams.get('fixture_host'),
        scope: url.searchParams.get('fixture_scope'),
      });
      if (state.gate) await state.gate.promise;
      if (state.requiresStop && url.searchParams.get('stop_running') !== 'true')
        return json({ success: false, message: 'Agent is active', error_data: { code: 'session_requires_stop' } }, 409);
      if (state.deleteError)
        return json(
          {
            success: false,
            message: 'Session has an active run. Stop it before deleting.',
          },
          409
        );
      const taskMatch = url.pathname.match(
        /^\/__fixture\/api\/tasks\/([^/]+)$/
      );
      if (taskMatch) {
        const found = state.tasks.find((row) => row.id === taskMatch[1]);
        if (
          !found ||
          found.open_target.kind !== 'agent' ||
          found.open_target.session_id !== url.searchParams.get('session_id')
        )
          return json({ success: false, message: 'Binding mismatch' }, 409);
        state.tasks = state.tasks.filter((row) => row.id !== found.id);
        state.sessions = state.sessions.filter(
          (row) => row.id !== url.searchParams.get('session_id')
        );
      } else {
        const standaloneMatch = url.pathname.match(
          /^\/__fixture\/api\/sessions\/([^/]+)$/
        );
        if (!standaloneMatch)
          throw new Error(`Unexpected mutation ${url.pathname}`);
        state.sessions = state.sessions.filter(
          (row) => row.id !== standaloneMatch[1]
        );
      }
      return success(null);
    }
    throw new Error(
      `Unexpected fixture request ${route.request().method()} ${url.pathname}`
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('task-count')).toHaveText('2');
  await expect(page.getByTestId('session-count')).toHaveText('3');
  return state;
}

async function openDelete(
  page: Page,
  surface: 'project' | 'sidebar',
  title = 'Task 1'
) {
  const button = page
    .getByTestId(surface)
    .getByRole('button', { name: `Delete ${title}`, exact: true });
  await button.focus();
  await button.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const surface of ['project', 'sidebar'] as const) {
  test(`${surface}: stop requires a separate confirmation and failure preserves data`, async ({ page }) => {
    const state = await setup(page);
    state.requiresStop = true;
    const dialog = await openDelete(page, surface);
    await dialog.getByRole('button', { name: 'Delete Task and session', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Stop and delete', exact: true })).toBeVisible();
    expect(state.stopRequests).toBe(0);
    await expect(page.getByTestId('task-count')).toHaveText('2');
    state.deleteError = true;
    await dialog.getByRole('button', { name: 'Stop and delete', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('task-count')).toHaveText('2');
    expect(state.stopRequests).toBe(1);
    state.deleteError = false;
    await dialog.getByRole('button', { name: 'Stop and delete', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('task-count')).toHaveText('1');
    expect(state.stopRequests).toBe(2);
  });

  test(`${surface}: cancel second confirmation never stops`, async ({ page }) => {
    const state = await setup(page);
    state.requiresStop = true;
    const dialog = await openDelete(page, surface);
    await dialog.getByRole('button', { name: 'Delete Task and session', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Stop and delete', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.stopRequests).toBe(0);
    await expect(page.getByTestId('session-count')).toHaveText('3');
  });
  test(`${surface}: cancellation names exact scope without deleting`, async ({
    page,
  }) => {
    const state = await setup(page);
    const dialog = await openDelete(page, surface);
    await expect(dialog).toContainText(
      'Delete "Task 1" and its bound session history'
    );
    await expect(dialog).toContainText('working files');
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .getByTestId(surface)
        .getByRole('button', { name: 'Delete Task 1', exact: true })
    ).toBeFocused();
    expect(state.writes).toEqual([]);
    await expect(page.getByTestId('task-count')).toHaveText('2');
    await expect(page.getByTestId('navigations')).toHaveText('0');
  });

  test(`${surface}: exact deletion refreshes both lists and preserves sibling Issue`, async ({
    page,
  }) => {
    const state = await setup(page);
    const dialog = await openDelete(page, surface);
    await dialog
      .getByRole('button', { name: 'Delete Task and session', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('task-count')).toHaveText('1');
    await expect(page.getByTestId('session-count')).toHaveText('2');
    await expect(page.getByTestId('project')).toContainText('Keep this Issue');
    await expect(
      page
        .getByTestId('project')
        .getByRole('button', { name: 'Delete Task 2', exact: true })
    ).toHaveCount(1);
    await expect(
      page
        .getByTestId('sidebar')
        .getByRole('button', { name: 'Delete Task 2', exact: true })
    ).toHaveCount(1);
    await expect(page.getByTestId('navigations')).toHaveText('1');
    expect(state.writes).toEqual([
      {
        path: '/__fixture/api/tasks/task-1',
        session: 'session-1',
        host: 'local',
        scope: 'explicit',
      },
    ]);
    expect(state.unexpectedRequests).toEqual([]);
  });
}

test('pending deletion blocks duplicate cross-entry activation and dismiss', async ({
  page,
}) => {
  const state = await setup(page);
  state.gate = deferred();
  const dialog = await openDelete(page, 'project');
  await page
    .getByTestId('sidebar')
    .getByRole('button', {
      name: 'Delete Task 2',
      exact: true,
      includeHidden: true,
    })
    .evaluate((button: HTMLButtonElement) => button.click());
  expect(state.lookups).toBe(1);
  await dialog
    .getByRole('button', { name: 'Delete Task and session', exact: true })
    .click();
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Deleting…', exact: true })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  state.gate.release();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test('conflict keeps both records visible and offers retry', async ({
  page,
}) => {
  const state = await setup(page);
  state.deleteError = true;
  const dialog = await openDelete(page, 'sidebar');
  await dialog
    .getByRole('button', { name: 'Delete Task and session', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('active run');
  await expect(page.getByTestId('task-count')).toHaveText('2');
  await expect(page.getByTestId('session-count')).toHaveText('3');
  await expect(page.getByTestId('navigations')).toHaveText('0');
  state.deleteError = false;
  await dialog
    .getByRole('button', { name: 'Delete Task and session', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('task-count')).toHaveText('1');
  expect(state.writes).toHaveLength(2);
});

test('standalone session uses Session deletion only', async ({ page }) => {
  const state = await setup(page);
  const dialog = await openDelete(page, 'sidebar', 'Standalone');
  await expect(dialog).toContainText('Delete session "Standalone"');
  await dialog
    .getByRole('button', { name: 'Delete session', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('session-count')).toHaveText('2');
  await expect(page.getByTestId('task-count')).toHaveText('2');
  expect(state.writes[0].path).toBe('/__fixture/api/sessions/session-3');
});

test('lookup failure never defaults to standalone and can retry', async ({
  page,
}) => {
  const state = await setup(page);
  state.lookupError = true;
  const dialog = await openDelete(page, 'sidebar');
  await expect(dialog.getByRole('alert')).toContainText(
    'Binding lookup failed'
  );
  await expect(dialog.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  state.lookupError = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Delete Task and session', exact: true })
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('stale project Task binding must not fall back to standalone', async ({
  page,
}) => {
  const state = await setup(page);
  state.staleBinding = true;
  const dialog = await openDelete(page, 'project');
  await expect(dialog.getByRole('alert')).toContainText('no longer bound');
  await expect(dialog.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('a repeated binding lookup failure clears the previously confirmed target', async ({
  page,
}) => {
  const state = await setup(page);
  const dialog = await openDelete(page, 'project');
  await expect(
    dialog.getByRole('button', { name: 'Delete Task and session', exact: true })
  ).toBeEnabled();
  state.lookupError = true;
  await page
    .getByRole('button', {
      name: 'Switch language',
      exact: true,
      includeHidden: true,
    })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(dialog.getByRole('alert')).toContainText(
    'Binding lookup failed'
  );
  await expect(dialog.getByRole('button', { name: /删除/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /重试/ })).toBeEnabled();
  expect(state.writes).toEqual([]);
});

test.describe('touch access', () => {
  test.use({ hasTouch: true });
  test('Task delete actions remain visible and at least 44px without hover', async ({
    page,
  }) => {
    const state = await setup(page);
    for (const surface of ['project', 'sidebar']) {
      const button = page
        .getByTestId(surface)
        .getByRole('button', { name: 'Delete Task 1', exact: true });
      await expect(button).toHaveCSS('opacity', '1');
      const rect = await button.boundingBox();
      expect(rect?.width).toBeGreaterThanOrEqual(44);
      expect(rect?.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByTestId('project')
      .getByRole('button', { name: 'Delete Task 1', exact: true })
      .tap();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Task 1');
    await expect(page.locator('.vk-kanban-card--overlay')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    expect(state.writes).toEqual([]);
  });
});

for (const change of ['Switch host', 'Switch selection']) {
  test(`${change} before confirmation rejects stale mutation`, async ({
    page,
  }) => {
    const state = await setup(page);
    const dialog = await openDelete(page, 'project');
    await expect(
      dialog.getByRole('button', {
        name: 'Delete Task and session',
        exact: true,
      })
    ).toBeEnabled();
    // Programmatic navigation while the dialog is modal simulates external route updates.
    await page
      .getByRole('button', { name: change, exact: true, includeHidden: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await dialog
      .getByRole('button', { name: 'Delete Task and session', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Host or selection has changed'
    );
    expect(state.writes).toEqual([]);
    await expect(page.getByTestId('navigations')).toHaveText('0');
  });

  test(`${change} during deletion retains original Host and avoids late navigation`, async ({
    page,
  }) => {
    const state = await setup(page);
    state.gate = deferred();
    const dialog = await openDelete(page, 'sidebar');
    await dialog
      .getByRole('button', { name: 'Delete Task and session', exact: true })
      .click();
    await expect.poll(() => state.writes.length).toBe(1);
    await page
      .getByRole('button', { name: change, exact: true, includeHidden: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    if (change === 'Switch host')
      await expect(page.getByTestId('host')).toHaveText('remote-host');
    else await expect(page.getByTestId('selection')).toHaveText('session-2');
    state.gate.release();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('navigations')).toHaveText('0');
    expect(state.writes[0].host).toBe('local');
    if (change === 'Switch host') {
      await expect(page.getByTestId('task-count')).toHaveText('2');
      await expect(page.getByTestId('session-count')).toHaveText('3');
    } else {
      await expect(page.getByTestId('task-count')).toHaveText('1');
      await expect(page.getByTestId('session-count')).toHaveText('2');
    }
  });
}

for (const action of ['Cancel', 'Confirm', 'Escape']) {
  test(`shared confirmation preserves existing ${action} result and focus`, async ({
    page,
  }) => {
    const state = await setup(page);
    const trigger = page.getByRole('button', {
      name: 'Basic confirmation',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeFocused();
    if (action === 'Escape') await page.keyboard.press('Escape');
    else
      await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('confirmation')).toHaveText(
      action === 'Confirm' ? 'confirmed' : 'canceled'
    );
    await expect(trigger).toBeFocused();
    expect(state.writes).toEqual([]);
  });
}
