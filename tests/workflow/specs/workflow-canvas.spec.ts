import { expect, test, type Page } from "@playwright/test";

async function readGraph(page: Page) {
  const text = await page.getByTestId("graph-json").textContent();
  expect(text).toBeTruthy();
  return JSON.parse(text!) as {
    nodes: Array<{ id: string; position?: { x: number; y: number } }>;
    edges: Array<{ id: string; type: string }>;
  };
}

function workflowNodeLocator(page: Page, nodeId: string) {
  return page.locator(".react-flow__node").filter({
    has: page.getByTestId(`workflow-node-${nodeId}`),
  });
}

async function waitForWorkflowNodeVisible(page: Page, nodeId: string) {
  const node = workflowNodeLocator(page, nodeId);
  await expect
    .poll(async () => {
      if ((await node.count()) === 0) return "missing";
      return node.evaluate((element) => getComputedStyle(element).visibility);
    })
    .toBe("visible");
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
    element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
    element.dispatchEvent(new PointerEvent("pointerup", eventInit));
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    element.dispatchEvent(new MouseEvent("click", eventInit));
  });
}

async function doubleClickWorkflowNode(page: Page, nodeId: string) {
  const node = await waitForWorkflowNodeVisible(page, nodeId);
  await node.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
    element.dispatchEvent(new PointerEvent("pointerup", eventInit));
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    element.dispatchEvent(new MouseEvent("click", eventInit));
    element.dispatchEvent(new MouseEvent("dblclick", eventInit));
  });
}

async function getWorkflowNodeTransform(page: Page, nodeId: string) {
  return waitForWorkflowNodeVisible(page, nodeId).then((node) =>
    node.evaluate((element) => getComputedStyle(element).transform),
  );
}

test("adds a workflow node by dragging from the palette to the canvas", async ({
  page,
}) => {
  await page.goto("/");

  const before = await readGraph(page);
  await page.locator(".react-flow__pane").evaluate((pane) => {
    const rect = pane.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("application/x-vibe-workflow-node", "agent");
    dataTransfer.effectAllowed = "copy";

    pane.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 360,
        clientY: rect.top + 320,
        dataTransfer,
      }),
    );
    pane.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 360,
        clientY: rect.top + 320,
        dataTransfer,
      }),
    );
  });

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);

  const graph = await readGraph(page);
  const droppedNode = graph.nodes.find((node) => node.id.startsWith("agent-"));

  expect(droppedNode?.position?.x).toBeGreaterThan(0);
  expect(droppedNode?.position?.y).toBeGreaterThan(0);
});

test("moves an existing workflow node by dragging it on the canvas", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");

  const before = await readGraph(page);
  const beforeCondition = before.nodes.find((node) => node.id === "condition");
  expect(beforeCondition?.position).toBeTruthy();

  const node = await waitForWorkflowNodeVisible(page, "condition");
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
      const moved = graph.nodes.find((node) => node.id === "condition");
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

test("connects workflow nodes by dragging between visible handles", async ({
  page,
}) => {
  await page.goto("/");

  const before = await readGraph(page);
  const yesNode = await waitForWorkflowNodeVisible(page, "yes");
  const noNode = await waitForWorkflowNodeVisible(page, "no");
  const sourceHandle = yesNode.locator(".react-flow__handle-right.source");
  const targetHandle = noNode.locator(".react-flow__handle-left.target");
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges.length;
    })
    .toBe(before.edges.length + 1);

  const graph = await readGraph(page);
  expect(graph.edges.some((edge) => edge.id === "yes-no")).toBe(true);
});

test("renders professional workflow node chrome and validation markers", async ({
  page,
}) => {
  await page.goto("/");

  const conditionNode = page.getByTestId("workflow-node-condition");
  await expect(conditionNode).toBeVisible();
  await expect(page.getByTestId("workflow-node-kind-condition")).toHaveText(
    "Condition",
  );
  await expect(page.getByTestId("workflow-node-summary-condition")).toHaveText(
    "Branches: 2",
  );
  await expect(
    page.getByTestId("workflow-node-metadata-condition-Branches"),
  ).toHaveText("Branches 2");
  await expect(
    page.getByTestId("workflow-node-route-condition-true"),
  ).toHaveText("true");
  await expect(page.getByTestId("workflow-node-issue-condition")).toHaveText(
    "1",
  );
  await expect(conditionNode.locator(".react-flow__handle-left")).toHaveCount(
    1,
  );
  await expect(conditionNode.locator(".react-flow__handle-right")).toHaveCount(
    1,
  );
});

test("renders semantic workflow edges with route chips", async ({ page }) => {
  await page.goto("/");
  await waitForWorkflowNodeVisible(page, "condition");

  await expect(page.getByTestId("workflow-edge-condition-yes")).toBeAttached();
  await expect(page.getByTestId("workflow-edge-chip-condition-yes")).toHaveText(
    "Condition",
  );
  await expect(page.getByTestId("workflow-edge-chip-condition-no")).toHaveText(
    "Condition",
  );
});

test("selects a node and keeps the minimap on a visible canvas surface", async ({
  page,
}) => {
  await page.goto("/");

  await clickWorkflowNode(page, "condition");
  await expect(page.getByTestId("node-inspector")).toContainText(
    "Condition Properties",
  );
  await expect(
    page.getByTestId("node-inspector").locator("input").first(),
  ).toHaveValue("Condition");

  const minimapBackground = await page
    .locator(".react-flow__minimap")
    .evaluate((minimap) => getComputedStyle(minimap).backgroundColor);
  expect(minimapBackground).not.toBe("rgb(255, 255, 255)");
});

test("opens a node configuration dialog from a single canvas click", async ({
  page,
}) => {
  await page.goto("/");

  await clickWorkflowNode(page, "condition");
  await expect(page.getByTestId("node-dialog")).toContainText(
    "Condition Properties",
  );
});

test("customizes condition branches from the node configuration dialog", async ({
  page,
}) => {
  await page.goto("/");

  await clickWorkflowNode(page, "condition");
  await page
    .getByTestId("node-dialog")
    .getByRole("button", { name: "Add branch" })
    .click();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const condition = graph.nodes.find((node) => node.id === "condition") as
        | undefined
        | {
            data?: {
              branches?: Array<{ name?: string; target_node_id?: string }>;
            };
          };
      return condition?.data?.branches?.length;
    })
    .toBe(3);
});

test("opens a node configuration dialog from the canvas", async ({ page }) => {
  await page.goto("/");

  await doubleClickWorkflowNode(page, "condition");
  await expect(page.getByTestId("node-dialog")).toContainText(
    "Condition Properties",
  );
});

test("opens a node configuration dialog in read-only mode", async ({
  page,
}) => {
  await page.goto("/?readonly=1");

  await doubleClickWorkflowNode(page, "condition");
  await expect(page.getByTestId("node-dialog")).toContainText(
    "Condition Properties",
  );
});

test("allows read-only nodes to move visually without persisting the graph", async ({
  page,
}) => {
  await page.goto("/?readonly=1");

  const beforeGraph = await readGraph(page);
  const beforeCondition = beforeGraph.nodes.find(
    (node) => node.id === "condition",
  );
  expect(beforeCondition?.position).toBeTruthy();

  const beforeTransform = await getWorkflowNodeTransform(page, "condition");
  const node = await waitForWorkflowNodeVisible(page, "condition");
  const box = await node.boundingBox();
  expect(box).toBeTruthy();

  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 60, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => getWorkflowNodeTransform(page, "condition"))
    .not.toBe(beforeTransform);

  const afterGraph = await readGraph(page);
  const afterCondition = afterGraph.nodes.find(
    (node) => node.id === "condition",
  );
  expect(afterCondition?.position).toEqual(beforeCondition?.position);
});

test("edits condition branch routing from the edge inspector", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("rf__edge-condition-yes")).toBeAttached();
  await page.getByTestId("select-condition-edge").click();

  await expect(page.getByText("Edge Properties")).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue("condition_branch");
  await expect(page.locator("select").nth(1)).toHaveValue("true");

  await page.locator("select").nth(1).selectOption("false");

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const condition = graph.nodes.find((node) => node.id === "condition") as
        | undefined
        | {
            data?: {
              branches?: Array<{ name?: string; target_node_id?: string }>;
            };
          };
      return condition?.data?.branches?.find(
        (branch) => branch.name === "false",
      )?.target_node_id;
    })
    .toBe("yes");
});
