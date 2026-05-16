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
  await node.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    element.dispatchEvent(new PointerEvent('pointerup', eventInit));
    element.dispatchEvent(new MouseEvent('mouseup', eventInit));
    element.dispatchEvent(new MouseEvent('click', eventInit));
  });
}

async function doubleClickWorkflowNode(page: Page, nodeId: string) {
  const node = await waitForWorkflowNodeVisible(page, nodeId);
  await node.dblclick({ force: true });
}

async function rightClickWorkflowNode(page: Page, nodeId: string) {
  const node = await waitForWorkflowNodeVisible(page, nodeId);
  const box = await node.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, {
    button: 'right',
  });
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
    '熟悉项目'
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

test('adds an agent step from the toolbar and auto-connects selected node', async ({
  page,
}) => {
  await page.goto('/');

  const before = await readGraph(page);
  await clickWorkflowNode(page, 'condition');
  await page.getByRole('button', { name: 'Add Agent Step' }).click();

  await expect(page.getByTestId('agent-step-edit-dialog')).toBeVisible();
  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);

  const graph = await readGraph(page);
  const addedNode = graph.nodes.find((node) => node.id.startsWith('agent-'));
  expect(addedNode?.position).toBeTruthy();
  expect(addedNode!.position!.x).toBeGreaterThan(500);
  expect(
    graph.edges.some(
      (edge) => edge.source === 'condition' && edge.target === addedNode?.id
    )
  ).toBe(true);
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

test('connects workflow nodes from non-default handle directions', async ({
  page,
}) => {
  await page.goto('/');

  const before = await readGraph(page);
  await dragHandleToHandle({
    page,
    sourceNodeId: 'yes',
    sourceSelector: '.react-flow__handle-bottom.source',
    targetNodeId: 'no',
    targetSelector: '.react-flow__handle-top.target',
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
    source_handle: 'output-bottom',
    target: 'no',
    target_handle: 'input-top',
  });
});

test('loads legacy workflow graphs and assigns default handles', async ({
  page,
}) => {
  await page.goto('/?legacy=1');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges[0];
    })
    .toMatchObject({
      source_handle: 'output-right',
      target_handle: 'input-left',
    });
});

test('uses a stable bezier preview path while stretching a new connection', async ({
  page,
}) => {
  await page.goto('/');

  const yesNode = await waitForWorkflowNodeVisible(page, 'yes');
  const sourceHandle = yesNode.locator('.react-flow__handle-right.source');
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
  expect(connectionPath).toContain('C');
  expect(connectionPath).not.toContain('NaN');

  await page.mouse.up();
});

test('reconnects an existing workflow edge by dragging an endpoint', async ({
  page,
}) => {
  await page.goto('/');
  await waitForWorkflowNodeVisible(page, 'condition');
  await waitForWorkflowNodeVisible(page, 'no');

  const edgeTargetUpdater = page
    .getByTestId('rf__edge-condition-yes')
    .locator('.react-flow__edgeupdater-target');
  const noTargetHandle = workflowNodeLocator(page, 'no').locator(
    '.react-flow__handle-left.target'
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
      source_handle: 'output-right',
      target: 'no',
      target_handle: 'input-left',
    }
  );
});

test('opens a draft agent session panel on double-click and ignores start/end', async ({
  page,
}) => {
  await page.goto('/');

  await doubleClickWorkflowNode(page, 'start');
  await expect(page.getByTestId('workflow-node-session-panel')).toHaveCount(0);

  await doubleClickWorkflowNode(page, 'end');
  await expect(page.getByTestId('workflow-node-session-panel')).toHaveCount(0);

  await doubleClickWorkflowNode(page, 'yes');
  await expect(page.getByTestId('workflow-node-session-panel')).toBeVisible();
  await expect(page.getByTestId('workflow-node-session-panel')).toContainText(
    'Yes path'
  );
  await expect(page.getByTestId('workflow-node-session-id')).toContainText(
    'session-yes'
  );
  await expect(page.getByLabel('Message')).toBeVisible();
});

test('opens agent context menu and edits title and default prompt', async ({
  page,
}) => {
  await page.goto('/');

  await rightClickWorkflowNode(page, 'yes');
  const menu = page.getByTestId('agent-step-context-menu');
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Open Session' })
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Run From Here' })
  ).toBeDisabled();

  await menu.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByTestId('agent-step-edit-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Step title').fill('Review code');
  await dialog.getByLabel('Default prompt').fill('Review implementation');
  await dialog.getByRole('button', { name: 'Save step' }).click();

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
  await rightClickWorkflowNode(page, 'yes');
  await page
    .getByTestId('agent-step-context-menu')
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

test('renders polished workflow chrome, dark minimap, and active edge beam', async ({
  page,
}) => {
  await page.goto('/');

  const conditionNode = page.getByTestId('workflow-node-condition');
  await expect(conditionNode).toBeVisible();
  await expect(page.getByTestId('workflow-node-kind-condition')).toHaveText(
    'Condition'
  );
  await expect(page.getByTestId('workflow-node-summary-condition')).toHaveText(
    'Branches: 2'
  );
  await expect(conditionNode.locator('.react-flow__handle')).toHaveCount(8);
  await expect(page.getByTestId('workflow-node-session-yes')).toHaveText(
    'Session ready'
  );
  await expect(page.getByTestId('workflow-node-session-no')).toHaveText(
    'Draft session'
  );

  const minimapBackground = await page
    .locator('.react-flow__minimap')
    .evaluate((minimap) => getComputedStyle(minimap).backgroundColor);
  expect(minimapBackground).not.toBe('rgb(255, 255, 255)');
  await expect(page.locator('.workflow-edge-beam')).not.toHaveCount(0);
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
    page.getByRole('dialog', { name: 'Add workflow step' })
  ).toHaveCount(0);
});

test('presents the workflow entry as canvas-first for both actions', async ({
  page,
}) => {
  await page.goto('/?mode=entry');

  const openCanvasButtons = page.getByRole('button', {
    name: 'Open workflow attempt canvas',
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
    .getByRole('button', { name: /Open canvas/i })
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

test('edits condition branch routing from the edge inspector', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByTestId('rf__edge-condition-yes')).toBeAttached();
  await page.getByTestId('select-condition-edge').click();

  await expect(page.getByText('Edge Properties')).toBeVisible();
  await expect(page.locator('select').first()).toHaveValue('condition_branch');
  await expect(page.locator('select').nth(1)).toHaveValue('true');

  await page.locator('select').nth(1).selectOption('false');

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const condition = graph.nodes.find((node) => node.id === 'condition');
      const branches = condition?.data?.branches as
        | Array<{ name?: string; target_node_id?: string }>
        | undefined;
      return branches?.find((branch) => branch.name === 'false')
        ?.target_node_id;
    })
    .toBe('yes');
});
