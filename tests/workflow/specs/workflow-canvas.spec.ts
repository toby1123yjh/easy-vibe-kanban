import { expect, test, type Page } from '@playwright/test';

async function readGraph(page: Page) {
  const text = await page.getByTestId('graph-json').textContent();
  expect(text).toBeTruthy();
  return JSON.parse(text!) as {
    nodes: Array<{
      id: string;
      type: string;
      data?: Record<string, unknown>;
      position?: { x: number; y: number };
    }>;
    edges: Array<{
      id: string;
      source?: string;
      source_handle?: string;
      target?: string;
      target_handle?: string;
      type: string;
    }>;
  };
}

function workflowNodeLocator(page: Page, nodeId: string) {
  return page.locator('.react-flow__node').filter({
    has: page.getByTestId(`workflow-node-${nodeId}`),
  });
}

async function waitForWorkflowNodeVisible(page: Page, nodeId: string) {
  const node = workflowNodeLocator(page, nodeId);
  await expect
    .poll(async () => {
      if ((await node.count()) === 0) return 'missing';
      return node.evaluate((element) => getComputedStyle(element).visibility);
    })
    .toBe('visible');
  return node;
}

async function clickWorkflowNode(page: Page, nodeId: string) {
  const node = await waitForWorkflowNodeVisible(page, nodeId);
  await node.click({ force: true });
}

async function dragHandleToHandle({
  page,
  sourceNodeId,
  sourceSelector,
  targetNodeId,
  targetSelector,
}: {
  page: Page;
  sourceNodeId: string;
  sourceSelector: string;
  targetNodeId: string;
  targetSelector: string;
}) {
  const sourceNode = await waitForWorkflowNodeVisible(page, sourceNodeId);
  const targetNode = await waitForWorkflowNodeVisible(page, targetNodeId);
  const sourceHandle = sourceNode.locator(sourceSelector);
  const targetHandle = targetNode.locator(targetSelector);
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 16 }
  );
  await page.mouse.up();
}

async function getWorkflowNodeTransform(page: Page, nodeId: string) {
  return waitForWorkflowNodeVisible(page, nodeId).then((node) =>
    node.evaluate((element) => getComputedStyle(element).transform)
  );
}

test('shows the default workflow attempt skeleton without overlapping nodes', async ({
  page,
}) => {
  await page.goto('/?mode=default-graph');

  await expect(page.getByTestId('workflow-node-start')).toBeVisible();
  await expect(page.getByTestId('workflow-node-familiarize')).toContainText(
    'Understand project'
  );
  await expect(page.getByTestId('workflow-node-end')).toBeVisible();

  const graph = await readGraph(page);
  expect(graph.nodes.map((node) => node.id)).toEqual([
    'start',
    'familiarize',
    'end',
  ]);
  expect(graph.edges.map((edge) => edge.id)).toEqual([
    'start-familiarize',
    'familiarize-end',
  ]);

  const positions = graph.nodes.map((node) => node.position);
  for (const position of positions) {
    expect(position).toBeTruthy();
  }
  expect(positions[1]!.x - positions[0]!.x).toBeGreaterThan(200);
  expect(positions[2]!.x - positions[1]!.x).toBeGreaterThan(200);
});

test('adds an unconnected agent node from the toolbar', async ({ page }) => {
  await page.goto('/');

  const before = await readGraph(page);
  await clickWorkflowNode(page, 'condition');
  await page.getByRole('button', { name: 'Add Agent Node' }).click();

  await expect(page.getByTestId('node-inspector')).toContainText(
    'Display name'
  );
  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);

  const graph = await readGraph(page);
  const addedNode = graph.nodes.find((node) => node.id.startsWith('agent-'));
  expect(addedNode?.position).toBeTruthy();
  expect(addedNode!.position!.x).toBeGreaterThan(400);
  expect(
    graph.edges.some(
      (edge) => edge.source === 'condition' && edge.target === addedNode?.id
    )
  ).toBe(false);
  expect(graph.edges.length).toBe(before.edges.length);
});

test('moves an existing workflow node by dragging it on the canvas', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  const before = await readGraph(page);
  const beforeCondition = before.nodes.find((node) => node.id === 'condition');
  expect(beforeCondition?.position).toBeTruthy();

  const node = await waitForWorkflowNodeVisible(page, 'condition');
  const box = await node.boundingBox();
  expect(box).toBeTruthy();

  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 140, startY + 80, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const moved = graph.nodes.find((node) => node.id === 'condition');
      return {
        x: Math.round(moved?.position?.x ?? 0),
        y: Math.round(moved?.position?.y ?? 0),
      };
    })
    .not.toEqual({
      x: Math.round(beforeCondition!.position!.x),
      y: Math.round(beforeCondition!.position!.y),
    });

  expect(pageErrors).toEqual([]);
});

test('connects workflow nodes through semantic handles', async ({ page }) => {
  await page.goto('/');

  const before = await readGraph(page);
  await dragHandleToHandle({
    page,
    sourceNodeId: 'yes',
    sourceSelector: '.react-flow__handle[data-handleid="default"]',
    targetNodeId: 'no',
    targetSelector: '.react-flow__handle[data-handleid="input"]',
  });

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges.length;
    })
    .toBe(before.edges.length + 1);

  const graph = await readGraph(page);
  const edge = graph.edges.find((candidate) => candidate.id === 'yes-no');
  expect(edge).toMatchObject({
    source: 'yes',
    source_handle: 'default',
    target: 'no',
    target_handle: 'input',
  });
});

test('loads legacy workflow graphs and assigns default handles', async ({
  page,
}) => {
  await page.goto('/?legacy=1');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges.find((edge) => edge.id === 'condition-yes');
    })
    .toMatchObject({
      source_handle: 'branch:branch-condition-yes',
      target_handle: 'input',
    });
});

test('uses a stable preview path while stretching a new connection', async ({
  page,
}) => {
  await page.goto('/');

  const yesNode = await waitForWorkflowNodeVisible(page, 'yes');
  const sourceHandle = yesNode.locator(
    '.react-flow__handle[data-handleid="default"]'
  );
  const sourceBox = await sourceHandle.boundingBox();
  expect(sourceBox).toBeTruthy();

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 90, { steps: 8 });

  const connectionPath = await page
    .locator('.react-flow__connection-path')
    .getAttribute('d');
  expect(connectionPath).toBeTruthy();
  expect(connectionPath).toContain('M');
  expect(connectionPath).not.toContain('NaN');

  await page.mouse.up();
});

test('reconnects an existing workflow edge by dragging an endpoint', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('workflow-edge-condition-yes').click();
  await waitForWorkflowNodeVisible(page, 'condition');
  await waitForWorkflowNodeVisible(page, 'no');

  const edgeTargetUpdater = page
    .getByTestId('rf__edge-condition-yes')
    .locator('.react-flow__edgeupdater-target');
  const noTargetHandle = workflowNodeLocator(page, 'no').locator(
    '.react-flow__handle[data-handleid="input"]'
  );

  const updaterBox = await edgeTargetUpdater.boundingBox();
  const targetBox = await noTargetHandle.boundingBox();
  expect(updaterBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  await page.mouse.move(
    updaterBox!.x + updaterBox!.width / 2,
    updaterBox!.y + updaterBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 16 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges.find((edge) => edge.id === 'condition-yes')?.target;
    })
    .toBe('no');

  const graph = await readGraph(page);
  expect(graph.edges.find((edge) => edge.id === 'condition-yes')).toMatchObject(
    {
      source: 'condition',
      source_handle: 'branch:branch-condition-yes',
      target: 'no',
      target_handle: 'input',
    }
  );
});

test('opens Node configuration for selected Nodes and does not create a session panel', async ({
  page,
}) => {
  await page.goto('/');

  await clickWorkflowNode(page, 'start');
  await expect(page.getByTestId('node-inspector')).toContainText(
    'Select a node to inspect'
  );
  await expect(page.getByTestId('workflow-node-session-panel')).toHaveCount(0);

  await clickWorkflowNode(page, 'end');
  await expect(page.getByTestId('node-inspector')).toContainText(
    'Select a node to inspect'
  );
  await expect(page.getByTestId('workflow-node-session-panel')).toHaveCount(0);

  await clickWorkflowNode(page, 'yes');
  await expect(page.getByTestId('node-inspector')).toContainText(
    'Display name'
  );
  await expect(page.getByTestId('workflow-node-session-panel')).toHaveCount(0);
});

test('opens agent node context menu and edits through Node inspector', async ({
  page,
}) => {
  await page.goto('/');

  await clickWorkflowNode(page, 'yes');
  const yesNode = await waitForWorkflowNodeVisible(page, 'yes');
  await yesNode.click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Edit' }).click();
  const inspector = page.getByTestId('node-inspector');
  await expect(inspector).toBeVisible();
  await inspector.getByLabel('Display name').fill('Review code');
  await inspector.getByLabel('Prompt template').fill('Review implementation');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.find((node) => node.id === 'yes')?.data;
    })
    .toMatchObject({
      display_name: 'Review code',
      prompt_template: 'Review implementation',
    });
});

test('duplicates agent configuration without copying session identity', async ({
  page,
}) => {
  await page.goto('/');

  const before = await readGraph(page);
  const yesNode = await waitForWorkflowNodeVisible(page, 'yes');
  await yesNode.click({ button: 'right' });
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Duplicate' })
    .click();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);

  const graph = await readGraph(page);
  const duplicate = graph.nodes.find(
    (node) => node.id.startsWith('agent-') && node.data?.display_name
  );
  expect(duplicate?.data).toMatchObject({
    role_template_id: 'reviewer',
    prompt_template: 'Review {{input}} and {{upstream}}',
  });
  expect(duplicate?.data?.session_id).toBeUndefined();
});

test('renders polished workflow chrome and quiet idle edges', async ({
  page,
}) => {
  await page.goto('/');

  const conditionNode = page.getByTestId('workflow-node-condition');
  await expect(conditionNode).toBeVisible();
  await expect(page.getByTestId('workflow-node-kind-condition')).toContainText(
    'Condition'
  );
  await expect(conditionNode.locator('.react-flow__handle')).toHaveCount(3);
  await expect(page.getByTestId('workflow-node-agent-yes')).toContainText(
    'Default agent'
  );

  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await expect(page.locator('.workflow-edge-beam-running')).toHaveCount(0);
});

test('does not expose old edge midpoint insert or quick add search paths', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByTestId('workflow-edge-insert-start-condition')
  ).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+K');
  await expect(
    page.getByRole('dialog', { name: 'Add workflow Node' })
  ).toHaveCount(0);
});

test('presents the workflow entry as canvas-first for both actions', async ({
  page,
}) => {
  await page.goto('/?mode=entry');

  const openCanvasButtons = page.getByRole('button', {
    name: 'Open workflow attempt',
  });
  await expect(openCanvasButtons).toHaveCount(2);

  await openCanvasButtons.first().click();
  await expect(page.getByTestId('workflow-entry-action')).toHaveText(
    'open-canvas'
  );

  await openCanvasButtons.nth(1).click();
  await expect(page.getByTestId('workflow-entry-action')).toHaveText(
    'open-canvas'
  );
});

test('shows workflow attempts in the issue task attempt list without direct run action', async ({
  page,
}) => {
  await page.goto('/?mode=task-attempts');

  await expect(page.getByText('Task Attempts')).toBeVisible();
  await expect(
    page.getByTestId('task-attempt-workflow-attempt-1')
  ).toContainText('Workflow attempt for Familiarize code');
  await expect(
    page.getByRole('button', { name: 'Run workflow attempt' })
  ).toHaveCount(0);

  await page
    .getByTestId('task-attempt-workflow-attempt-1')
    .getByRole('button', { name: /Open workflow/i })
    .click();
  await expect(page.getByTestId('task-attempt-action')).toHaveText(
    'open:workflow'
  );
});

test('allows read-only nodes to move visually without persisting the graph', async ({
  page,
}) => {
  await page.goto('/?readonly=1');

  const beforeGraph = await readGraph(page);
  const beforeCondition = beforeGraph.nodes.find(
    (node) => node.id === 'condition'
  );
  expect(beforeCondition?.position).toBeTruthy();

  const beforeTransform = await getWorkflowNodeTransform(page, 'condition');
  const node = await waitForWorkflowNodeVisible(page, 'condition');
  const box = await node.boundingBox();
  expect(box).toBeTruthy();

  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 60, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => getWorkflowNodeTransform(page, 'condition'))
    .not.toBe(beforeTransform);

  const afterGraph = await readGraph(page);
  const afterCondition = afterGraph.nodes.find(
    (node) => node.id === 'condition'
  );
  expect(afterCondition?.position).toEqual(beforeCondition?.position);
});

test('edits condition branch conditions from the node inspector', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByTestId('select-condition-node').click();

  const branchCondition = page
    .getByTestId('node-inspector')
    .locator('textarea')
    .first();
  await expect(branchCondition).toHaveValue('Input asks to ship');
  await branchCondition.fill('Upstream result needs implementation');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const condition = graph.nodes.find((node) => node.id === 'condition');
      const branches = condition?.data?.branches as
        | Array<{ condition?: string; target_node_id?: string }>
        | undefined;
      return branches?.find((branch) => branch.target_node_id === 'yes')
        ?.condition;
    })
    .toBe('Upstream result needs implementation');
});
