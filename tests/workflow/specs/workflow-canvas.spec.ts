import { expect, test, type Page } from '@playwright/test';

async function readGraph(page: Page) {
  const text = await page.getByTestId('graph-json').textContent();
  expect(text).toBeTruthy();
  return JSON.parse(text!) as {
    nodes: Array<{ id: string; position?: { x: number; y: number } }>;
    edges: Array<{ id: string; type: string }>;
  };
}

test('adds a workflow node by dragging from the palette to the canvas', async ({
  page,
}) => {
  await page.goto('/');

  const before = await readGraph(page);
  await page.locator('.react-flow__pane').evaluate((pane) => {
    const rect = pane.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-vibe-workflow-node', 'agent');
    dataTransfer.effectAllowed = 'copy';

    pane.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 360,
        clientY: rect.top + 320,
        dataTransfer,
      })
    );
    pane.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 360,
        clientY: rect.top + 320,
        dataTransfer,
      })
    );
  });

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);

  const graph = await readGraph(page);
  const droppedNode = graph.nodes.find((node) => node.id.startsWith('agent-'));

  expect(droppedNode?.position?.x).toBeGreaterThan(0);
  expect(droppedNode?.position?.y).toBeGreaterThan(0);
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
      const condition = graph.nodes.find((node) => node.id === 'condition') as
        | undefined
        | {
            data?: {
              branches?: Array<{ name?: string; target_node_id?: string }>;
            };
          };
      return condition?.data?.branches?.find(
        (branch) => branch.name === 'false'
      )?.target_node_id;
    })
    .toBe('yes');
});
