import { expect, test, type Page, type Route } from '@playwright/test';

const timestamp = '2026-10-04T01:00:00Z';
const mainConfig = {
  executor: 'CODEX',
  variant: 'DEFAULT',
  model_id: 'gpt-publication-test',
  reasoning_id: 'high',
};
const graph = {
  version: 2,
  nodes: [
    {
      id: 'start',
      type: 'start',
      data: { display_name: 'Start' },
      position: { x: 40, y: 140 },
    },
    {
      id: 'agent',
      type: 'agent',
      data: {
        display_name: 'Prepare report',
        executor_config: mainConfig,
        prompt_template: 'Prepare a report.',
      },
      position: { x: 340, y: 140 },
    },
    {
      id: 'end',
      type: 'end',
      data: { display_name: 'End' },
      position: { x: 640, y: 140 },
    },
  ],
  edges: [
    {
      id: 'start-agent',
      source: 'start',
      source_handle: 'output',
      target: 'agent',
      target_handle: 'input',
      type: 'default',
    },
    {
      id: 'agent-end',
      source: 'agent',
      source_handle: 'output',
      target: 'end',
      target_handle: 'input',
      type: 'default',
    },
  ],
};
const template = {
  id: 'report-template',
  source: 'project',
  project_id: 'project-one',
  name: 'Report workflow',
  description: 'Prepare and review a report',
  graph_json: JSON.stringify(graph),
  revision: 11,
  external_enabled: false,
  main_agent_config: mainConfig,
  main_agent_prompt: 'Discuss requirements before submitting work.',
  created_at: timestamp,
  updated_at: timestamp,
};
const instance = {
  id: 'report-instance',
  project_id: 'project-one',
  issue_id: 'report-issue',
  workflow_id: template.id,
  template_id: template.id,
  latest_run_id: null,
  workspace_id: 'prepared-workspace',
  name: 'Report instance',
  status: 'draft',
  main_session_id: null,
  main_session_bound_at: null,
  definition_locked_at: null,
  created_at: timestamp,
  updated_at: timestamp,
};
const capturedContext = {
  project_id: 'project-one',
  main_session_id: 'main-session',
  workflow_id: template.id,
  workflow_name: template.name,
  main_agent_config: mainConfig,
  main_agent_prompt: template.main_agent_prompt,
  prepared_issue_id: null,
  issue_id: null,
  instance_id: null,
  workspace_id: 'prepared-workspace',
  latest_run_id: null,
  definition_locked_at: null,
  allowed_actions: ['start'],
};
const preparedSession = {
  session: {
    id: 'main-session',
    workspace_id: 'prepared-workspace',
    name: 'Report discussion',
    executor: 'CODEX',
    agent_working_dir: null,
    created_at: timestamp,
    updated_at: timestamp,
  },
  context: capturedContext,
};

interface ApiCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

interface MockOptions {
  prepare?: (route: Route, call: ApiCall) => Promise<void>;
  update?: (route: Route, call: ApiCall) => Promise<void>;
  notifications?: (route: Route, url: URL) => Promise<void>;
  context?: (route: Route, sessionId: string) => Promise<void>;
  attempt?: (route: Route) => Promise<void>;
  run?: (route: Route, call: ApiCall) => Promise<void>;
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: data });
}

function success(data: unknown) {
  return { success: true, data, error_data: null, message: null };
}

async function mockManagement(page: Page, options: MockOptions = {}) {
  const calls: ApiCall[] = [];
  let currentTemplate = { ...template };

  // Model discovery is also a read-only backend boundary. Exercise the real
  // controls without needing a local CLI or a second browser-side store.
  await page.routeWebSocket(
    '**/api/agents/discovered-options/ws?*',
    (socket) => {
      socket.send(
        JSON.stringify({
          JsonPatch: [
            {
              op: 'replace',
              path: '/options',
              value: {
                model_selector: {
                  providers: [],
                  models: [],
                  default_model: 'gpt-discovery-test',
                  agents: [],
                  permissions: [],
                },
                slash_commands: [],
                skills: [],
                skill_errors: [],
                loading_models: false,
                loading_agents: false,
                loading_slash_commands: false,
                loading_skills: false,
                error: null,
              },
            },
          ],
        })
      );
      socket.send(JSON.stringify({ Ready: true }));
    }
  );

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call: ApiCall = {
      method: request.method(),
      path: url.pathname,
      body: request.postData() ? request.postDataJSON() : null,
    };
    calls.push(call);

    if (
      /\/projects\/[^/]+\/workflows$/.test(url.pathname) &&
      call.method === 'GET'
    ) {
      const projectId = url.pathname.split('/').at(-2);
      await json(route, {
        workflows: [{ ...currentTemplate, project_id: projectId }],
      });
    } else if (/\/projects\/[^/]+\/scheduled-tasks$/.test(url.pathname)) {
      await json(route, { tasks: [] });
    } else if (
      url.pathname === '/api/local/v1/workflows/report-template' &&
      call.method === 'GET'
    ) {
      await json(route, currentTemplate);
    } else if (
      url.pathname === '/api/local/v1/workflows/report-template/attempt'
    ) {
      if (options.attempt) await options.attempt(route);
      else await json(route, null);
    } else if (
      url.pathname === '/api/local/v1/workflow-attempts/report-instance/run' &&
      options.run
    ) {
      await options.run(route, call);
    } else if (url.pathname === '/api/workspaces/prepared-workspace') {
      await json(
        route,
        success({
          id: 'prepared-workspace',
          container_ref: '/fixtures/report-workspace',
          workspace_kind: 'direct_folder',
          container_ownership: 'external',
          branch: 'direct-folder',
          setup_completed_at: null,
          created_at: timestamp,
          updated_at: timestamp,
          archived: false,
          pinned: false,
          name: 'Report workspace',
          worktree_deleted: false,
        })
      );
    } else if (
      url.pathname === '/api/sessions' &&
      url.searchParams.get('workspace_id') === 'prepared-workspace'
    ) {
      await json(route, success([preparedSession.session]));
    } else if (url.pathname === '/api/workspaces/prepared-workspace/repos') {
      await json(route, success([]));
    } else if (url.pathname === '/api/agents/garage') {
      await json(
        route,
        success(
          ['CODEX', 'CLAUDE_CODE'].map((executor) => ({
            executor,
            policy: {
              disabled: false,
              readiness: 'READY',
              capabilities: ['INITIAL_RUN', 'FOLLOW_UP', 'MCP'],
              diagnostics: [],
            },
          }))
        )
      );
    } else if (url.pathname === '/api/agents/preset-options') {
      await json(route, success(mainConfig));
    } else if (
      url.pathname === '/api/local/v1/workflows/report-template' &&
      call.method === 'PUT'
    ) {
      if (options.update) {
        await options.update(route, call);
      } else {
        currentTemplate = {
          ...currentTemplate,
          ...(call.body?.main_agent_config != null
            ? {
                main_agent_config: call.body
                  .main_agent_config as typeof mainConfig,
              }
            : {}),
          ...(call.body?.main_agent_prompt != null
            ? { main_agent_prompt: call.body.main_agent_prompt as string }
            : {}),
          ...(call.body?.graph_json != null
            ? { graph_json: call.body.graph_json as string }
            : {}),
          ...(call.body?.name != null
            ? { name: call.body.name as string }
            : {}),
          ...(call.body?.description != null
            ? { description: call.body.description as string }
            : {}),
          revision: currentTemplate.revision + 1,
        };
        await json(route, { data: currentTemplate, txid: 1 });
      }
    } else if (
      url.pathname === '/api/workflow-management/prepare-main-session'
    ) {
      if (options.prepare) await options.prepare(route, call);
      else await json(route, success(preparedSession));
    } else if (
      /\/api\/workflow-management\/sessions\/[^/]+\/context$/.test(url.pathname)
    ) {
      const sessionId = url.pathname.split('/').at(-2)!;
      if (options.context) await options.context(route, sessionId);
      else
        await json(
          route,
          success(sessionId === 'main-session' ? capturedContext : null)
        );
    } else if (
      /\/api\/workflow-management\/sessions\/[^/]+\/notifications$/.test(
        url.pathname
      )
    ) {
      if (options.notifications) await options.notifications(route, url);
      else await json(route, success({ notifications: [], next_cursor: null }));
    } else {
      // Fail closed for any accidental submit/start/fallback request.
      await json(
        route,
        {
          success: false,
          message: `Unexpected fixture API: ${call.method} ${call.path}`,
        },
        500
      );
    }
  });

  return { calls };
}

function mutations(calls: ApiCall[]) {
  return calls.filter((call) => call.method !== 'GET');
}

async function selectProject(page: Page, name = 'Report project') {
  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Report workflow' })
  ).toBeVisible();
}

async function openMainSettings(page: Page) {
  await selectProject(page);
  await page.getByRole('button', { name: 'Main Agent', exact: true }).click();
  await expect(page.getByLabel('Main Agent instructions')).toBeVisible();
}

test('requires explicit project choice, preserves scope, and opens settings without execution', async ({
  page,
}) => {
  const { calls } = await mockManagement(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?mode=management');
  await expect(
    page.getByText('Choose the project whose workspace this workflow will use.')
  ).toBeVisible();
  expect(calls).toEqual([]);

  await page.getByRole('button', { name: 'Load more projects' }).click();
  await expect(page.getByTestId('project-pages')).toHaveText('1');
  await openMainSettings(page);
  await expect(page.getByLabel('Main Agent instructions')).toHaveValue(
    template.main_agent_prompt
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Main Agent instructions')).toHaveCount(0);
  await selectProject(page, 'Research project');
  expect(
    calls.some((call) => call.path.includes('/projects/project-two/workflows'))
  ).toBe(true);
  expect(mutations(calls)).toEqual([]);
  expect(errors).toEqual([]);
});

test('project discovery failure retries the real chooser without selecting a fallback', async ({
  page,
}) => {
  const { calls } = await mockManagement(page);
  await page.goto('/?mode=management&projectsError=1');
  await expect(page.getByText('Could not load projects')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('combobox', { name: 'Project' })).toBeVisible();
  await expect(page.getByTestId('project-retries')).toHaveText('1');
  expect(calls).toEqual([]);
});

test('publishes full provider/model/reasoning and prompt with the current revision, without graph changes', async ({
  page,
}) => {
  const { calls } = await mockManagement(page);
  await page.goto('/?mode=management');
  await openMainSettings(page);
  await expect(
    page.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  await page
    .getByLabel('Main Agent instructions')
    .fill('Discuss materials, then submit the approved report.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  expect(mutations(calls)).toEqual([
    {
      method: 'PUT',
      path: '/api/local/v1/workflows/report-template',
      body: {
        expected_revision: 11,
        name: null,
        description: null,
        graph_json: null,
        main_agent_config: mainConfig,
        main_agent_prompt:
          'Discuss materials, then submit the approved report.',
      },
    },
  ]);

  await page.getByLabel('Main Agent instructions').fill('Second publication.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  expect(mutations(calls).at(-1)?.body?.expected_revision).toBe(12);
});

test('save conflict keeps the draft and prevents preparation or automatic execution', async ({
  page,
}) => {
  const { calls } = await mockManagement(page, {
    update: async (route) =>
      json(
        route,
        {
          error_data: {
            workflow_id: template.id,
            expected_revision: 11,
            current_revision: 12,
          },
        },
        409
      ),
  });
  await page.goto('/?mode=management');
  await openMainSettings(page);
  await page
    .getByLabel('Main Agent instructions')
    .fill('My unsaved requirements');
  await page.getByRole('button', { name: 'Open main conversation' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Workflow changed from revision 11 to 12'
  );
  await expect(page.getByLabel('Main Agent instructions')).toHaveValue(
    'My unsaved requirements'
  );
  expect(mutations(calls).map((call) => call.path)).toEqual([
    '/api/local/v1/workflows/report-template',
  ]);
});

test('opening a conversation saves first and navigates to the returned exact Session without submission', async ({
  page,
}) => {
  const { calls } = await mockManagement(page);
  await page.goto('/?mode=management');
  await openMainSettings(page);
  await page
    .getByLabel('Main Agent instructions')
    .fill('Updated for new Sessions only.');
  await page.getByRole('button', { name: 'Open main conversation' }).click();
  await expect(page.getByTestId('prepared-workspace')).toBeVisible();
  await expect(page.getByTestId('management-location')).toHaveText(
    JSON.stringify({
      pathname: '/workspaces/prepared-workspace',
      search: { session_id: 'main-session' },
    })
  );
  expect(mutations(calls).map((call) => call.path)).toEqual([
    '/api/local/v1/workflows/report-template',
    '/api/workflow-management/prepare-main-session',
  ]);
  expect(mutations(calls)[1]?.body).toMatchObject({
    project_id: 'project-one',
    workflow_id: template.id,
    request_id: expect.any(String),
  });
  expect(mutations(calls)[1]?.body?.issue_id).toBeUndefined();
});

test('preparation retry keeps request identity and explicit Issue, including remote exact-session navigation', async ({
  page,
}) => {
  let attempts = 0;
  const { calls } = await mockManagement(page, {
    prepare: async (route) => {
      attempts += 1;
      if (attempts === 1)
        await json(
          route,
          { success: false, message: 'Temporary preparation error' },
          503
        );
      else await json(route, success(preparedSession));
    },
  });
  await page.goto('/?mode=management-button&remote=1&issue=report-issue');
  await page.getByRole('button', { name: 'Open main conversation' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Temporary preparation error'
  );
  await page.getByRole('button', { name: 'Open main conversation' }).click();
  await expect(page.getByTestId('management-location')).toHaveText(
    JSON.stringify({
      pathname: '/hosts/remote-host/workspaces/prepared-workspace',
      search: { session_id: 'main-session' },
    })
  );
  const prepares = mutations(calls);
  expect(prepares).toHaveLength(2);
  expect(prepares[0].body).toEqual(prepares[1].body);
  expect(prepares[0].body).toMatchObject({
    issue_id: 'report-issue',
    request_id: expect.any(String),
  });
});

test('a deleted original main Session is not silently replaced by another create path', async ({
  page,
}) => {
  const { calls } = await mockManagement(page, {
    prepare: async (route) =>
      json(
        route,
        {
          success: false,
          error_data: { code: 'instance_binding_conflict' },
          message:
            'The original main Session was deleted and cannot be replaced.',
        },
        409
      ),
  });
  await page.goto('/?mode=management-button&issue=report-issue');
  await page.getByRole('button', { name: 'Open main conversation' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be replaced');
  await page.getByRole('button', { name: 'Open main conversation' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be replaced');
  await expect(page.getByTestId('prepared-workspace')).toHaveCount(0);
  expect(mutations(calls).map((call) => call.path)).toEqual([
    '/api/workflow-management/prepare-main-session',
    '/api/workflow-management/prepare-main-session',
  ]);
  expect(mutations(calls)[0].body).toEqual(mutations(calls)[1].body);
});

test('an unavailable execution Host disables preparation without any requests', async ({
  page,
}) => {
  const { calls } = await mockManagement(page);
  await page.goto('/?mode=management-button&blocked=1');
  await expect(
    page.getByRole('button', { name: 'Open main conversation' })
  ).toBeDisabled();
  expect(calls).toEqual([]);
});

async function openEditorMainSettings(page: Page) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Main Agent', exact: true }).click();
  await expect(page.getByLabel('Main Agent instructions')).toBeVisible();
}

test('the production instance dialog prepares the existing Issue rather than an unrelated discussion', async ({
  page,
}) => {
  const { calls } = await mockManagement(page, {
    attempt: async (route) => json(route, instance),
  });
  await page.goto('/?mode=management-editor');
  await expect(page.getByLabel('Workflow name')).toHaveValue(template.name);
  await expect(
    page.getByRole('button', { name: 'Add Node', exact: true })
  ).toBeEnabled();
  await openEditorMainSettings(page);
  // Two explicit entries point to the same Issue; choose the dialog entry.
  await page
    .locator('.vk-keyboard-dialog')
    .getByRole('button', { name: 'Open main conversation' })
    .click();
  await expect(page.getByTestId('prepared-workspace')).toBeVisible();
  expect(mutations(calls)).toHaveLength(1);
  expect(mutations(calls)[0]).toMatchObject({
    path: '/api/workflow-management/prepare-main-session',
    body: {
      issue_id: 'report-issue',
      project_id: 'project-one',
      workflow_id: template.id,
    },
  });
  await expect(page.getByTestId('management-location')).toContainText(
    '"session_id":"main-session"'
  );
});

test('publishing Main Agent configuration retains unsaved canvas work and advances its save revision', async ({
  page,
}) => {
  const { calls } = await mockManagement(page);
  await page.goto('/?mode=management-editor');
  await expect(
    page.getByRole('button', { name: 'Add Node', exact: true })
  ).toBeEnabled();
  await page
    .locator('.react-flow__node[data-id="agent"]')
    .dblclick({ force: true });
  await page
    .getByLabel('Prompt template', { exact: true })
    .fill('Unsaved report Node requirement.');
  await page.getByRole('button', { name: 'Close configuration' }).click();
  await page.getByLabel('Workflow name').fill('My unsaved workflow title');
  await openEditorMainSettings(page);
  await page
    .getByLabel('Main Agent instructions')
    .fill('Published instructions must not overwrite canvas work.');
  const dialog = page.locator('.vk-keyboard-dialog');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(page.getByLabel('Workflow name')).toHaveValue(
    'My unsaved workflow title'
  );
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => mutations(calls).length).toBe(2);
  const [publication, canvasSave] = mutations(calls);
  expect(publication.body).toMatchObject({
    expected_revision: 11,
    graph_json: null,
  });
  expect(canvasSave.body).toMatchObject({
    expected_revision: 12,
    name: 'My unsaved workflow title',
  });
  const savedGraph = JSON.parse(
    String(canvasSave.body?.graph_json)
  ) as typeof graph;
  expect(
    savedGraph.nodes.find((node) => node.id === 'agent')?.data.prompt_template
  ).toBe('Unsaved report Node requirement.');
  expect(savedGraph.edges.map((edge) => edge.id)).toEqual(
    graph.edges.map((edge) => edge.id)
  );
  expect(
    mutations(calls).every(
      (call) => call.path === '/api/local/v1/workflows/report-template'
    )
  ).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an unresolved instance lookup never exposes editable definitions and stays locked after terminal success', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls } = await mockManagement(page, {
    attempt: async (route) => {
      await delayed;
      await json(route, {
        ...instance,
        status: 'succeeded',
        definition_locked_at: timestamp,
      });
    },
  });
  await page.goto('/?mode=management-editor');
  const name = page.getByLabel('Workflow name');
  await expect(name).toHaveValue(template.name);
  await expect(name).toHaveAttribute('readonly', '');
  await expect(
    page.getByRole('button', { name: 'Add Node', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Main Agent', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  release!();
  await expect(
    page.getByText('Its workflow is permanently read-only', { exact: false })
  ).toBeVisible();
  await expect(name).toHaveAttribute('readonly', '');
  await expect(
    page.getByRole('button', { name: 'Add Node', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  expect(mutations(calls)).toEqual([]);
});

test('instance discovery errors fail closed without enabling publication, rename, or graph mutation', async ({
  page,
}) => {
  const { calls } = await mockManagement(page, {
    attempt: async (route) =>
      json(route, { message: 'Instance unavailable' }, 503),
  });
  await page.goto('/?mode=management-editor');
  await expect(page.getByRole('alert')).toContainText(
    'Could not verify the instance'
  );
  await expect(page.getByLabel('Workflow name')).toHaveAttribute(
    'readonly',
    ''
  );
  await expect(
    page.getByRole('button', { name: 'Add Node', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Main Agent', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
  expect(mutations(calls)).toEqual([]);
});

test('a locked terminal instance keeps Session/results controls but never persists its graph during execution actions', async ({
  page,
}) => {
  const { calls } = await mockManagement(page, {
    attempt: async (route) =>
      json(route, {
        ...instance,
        status: 'failed',
        latest_run_id: 'failed-report-run',
        main_session_id: 'main-session',
        main_session_bound_at: timestamp,
        definition_locked_at: timestamp,
      }),
    run: async (route) =>
      json(
        route,
        { message: 'Use an explicit resume for this accepted instance.' },
        409
      ),
  });
  await page.goto('/?mode=management-editor');
  await expect(
    page.getByText('Its workflow is permanently read-only', { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open main conversation' })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Main Agent', exact: true })
  ).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Open latest run' }).click();
  await expect(page.getByTestId('opened-run')).toHaveText('failed-report-run');
  expect(mutations(calls)).toEqual([]);

  await page
    .locator('.react-flow__node[data-id="agent"]')
    .dblclick({ force: true });
  await expect(
    page.getByLabel('Prompt template', { exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close configuration' }).click();
  const run = page.getByRole('button', { name: 'Run workflow attempt' });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole('alert')).toContainText('explicit resume');
  expect(mutations(calls).map((call) => call.path)).toEqual([
    '/api/local/v1/workflow-attempts/report-instance/run',
  ]);
});

test('a deleted bound main Session disables instance preparation rather than permitting a replacement', async ({
  page,
}) => {
  const { calls } = await mockManagement(page, {
    attempt: async (route) =>
      json(route, {
        ...instance,
        status: 'cancelled',
        main_session_bound_at: timestamp,
        definition_locked_at: timestamp,
      }),
  });
  await page.goto('/?mode=management-editor');
  await expect(
    page.getByRole('button', { name: 'Open main conversation' })
  ).toBeDisabled();
  expect(mutations(calls)).toEqual([]);
});

const humanWait = {
  id: 'human-wait',
  sequence: 1,
  instance_id: 'report-instance',
  run_id: 'report-run',
  main_session_id: 'main-session',
  event_key: 'node-review:waiting',
  kind: 'human_wait',
  node_execution_id: 'review-execution',
  interaction_id: 'review-execution',
  observed_status: 'waiting_human',
  summary: 'Review requires a decision.',
  created_at: timestamp,
  current_status: 'waiting_human',
  is_resolved: false,
};
const completed = {
  ...humanWait,
  id: 'completed-run',
  sequence: 2,
  event_key: 'report-run:succeeded',
  kind: 'terminal',
  node_execution_id: null,
  interaction_id: null,
  observed_status: 'succeeded',
  current_status: 'succeeded',
  summary: 'Report completed.',
  is_resolved: true,
};

test('refreshes historical waits across pages in place, deduplicates replay, and retains messages on errors', async ({
  page,
}) => {
  let resolved = false;
  let failed = false;
  const { calls } = await mockManagement(page, {
    notifications: async (route, url) => {
      if (failed)
        return json(
          route,
          { success: false, message: 'Temporary notification error' },
          503
        );
      const wait = resolved
        ? { ...humanWait, current_status: 'succeeded', is_resolved: true }
        : humanWait;
      await json(
        route,
        success(
          url.searchParams.has('cursor')
            ? { notifications: [wait, completed], next_cursor: null }
            : { notifications: [wait], next_cursor: 1 }
        )
      );
    },
  });
  await page.goto('/?mode=management-notifications');
  const rows = page.getByTestId('workflow-system-messages').locator('li');
  await expect(rows).toHaveCount(2);
  const waitRow = page.locator(
    '[data-message-key="workflow-notification:human-wait"]'
  );
  await expect(waitRow).toContainText('waiting for a response');
  await expect(page.getByTestId('main-session-context')).toContainText(
    'gpt-publication-test'
  );
  const firstRow = await waitRow.elementHandle();

  resolved = true;
  await page.getByRole('button', { name: 'Refresh notifications' }).click();
  await expect(waitRow).toContainText('has been resolved');
  await expect(rows).toHaveCount(2);
  expect(await firstRow!.evaluate((element) => element.isConnected)).toBe(true);
  const notificationReads = calls.filter((call) =>
    call.path.endsWith('/notifications')
  );
  expect(notificationReads).toHaveLength(4);

  failed = true;
  await page.getByRole('button', { name: 'Refresh notifications' }).click();
  await expect(page.getByRole('alert')).toContainText('Refresh failed');
  await expect(rows).toHaveCount(2);
  await expect(waitRow).toContainText('has been resolved');
  expect(mutations(calls)).toEqual([]);
});

test('Session switching cannot display late notifications from the previous Session or launch an Agent', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls } = await mockManagement(page, {
    notifications: async (route) => {
      await delayed;
      await json(
        route,
        success({ notifications: [humanWait], next_cursor: null })
      ).catch(() => undefined);
    },
  });
  await page.goto('/?mode=management-notifications');
  await expect
    .poll(
      () => calls.filter((call) => call.path.endsWith('/notifications')).length
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Open another Session' }).click();
  await expect
    .poll(() =>
      calls.some((call) => call.path.includes('/other-session/context'))
    )
    .toBe(true);
  release!();
  await expect(
    page.getByTestId('workflow-system-messages').locator('li')
  ).toHaveCount(0);
  await expect(page.getByTestId('main-session-context')).toHaveText('null');
  expect(
    calls.some((call) => call.path.includes('/other-session/notifications'))
  ).toBe(false);
  expect(mutations(calls)).toEqual([]);
});
