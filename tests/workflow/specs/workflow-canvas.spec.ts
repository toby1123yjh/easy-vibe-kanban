import { expect, test, type Page } from "@playwright/test";

async function readGraph(page: Page) {
  const text = await page.getByTestId("graph-json").textContent();
  expect(text).toBeTruthy();
  return JSON.parse(text!) as {
    nodes: Array<{ id: string; position?: { x: number; y: number } }>;
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

async function doubleClickWorkflowRunNode(page: Page, nodeId: string) {
  const node = page.getByTestId(`workflow-run-node-${nodeId}`);

  await expect(node).toBeVisible();
  await node.dblclick();
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
  const edge = graph.edges.find((candidate) => candidate.id === "yes-no");
  expect(edge).toMatchObject({
    source: "yes",
    source_handle: "output-right",
    target: "no",
    target_handle: "input-left",
  });
});

test("loads legacy workflow graphs and assigns default handles", async ({
  page,
}) => {
  await page.goto("/?legacy=1");

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.edges[0];
    })
    .toMatchObject({
      source_handle: "output-right",
      target_handle: "input-left",
    });
});

test("uses a smooth step preview path while stretching a new connection", async ({
  page,
}) => {
  await page.goto("/");

  const yesNode = await waitForWorkflowNodeVisible(page, "yes");
  const sourceHandle = yesNode.locator(".react-flow__handle-right.source");
  const sourceBox = await sourceHandle.boundingBox();
  expect(sourceBox).toBeTruthy();

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 90, { steps: 8 });

  const connectionPath = await page
    .locator(".react-flow__connection-path")
    .getAttribute("d");
  expect(connectionPath).toBeTruthy();
  expect(connectionPath).not.toContain("C");
  expect(connectionPath).toContain("L");

  await page.mouse.up();
});

test("reconnects an existing workflow edge by dragging an endpoint", async ({
  page,
}) => {
  await page.goto("/");
  await waitForWorkflowNodeVisible(page, "condition");
  await waitForWorkflowNodeVisible(page, "no");

  const edgeTargetUpdater = page
    .getByTestId("rf__edge-condition-yes")
    .locator(".react-flow__edgeupdater-target");
  const noTargetHandle = workflowNodeLocator(page, "no").locator(
    ".react-flow__handle-left.target",
  );

  const updaterBox = await edgeTargetUpdater.boundingBox();
  const targetBox = await noTargetHandle.boundingBox();
  expect(updaterBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  await page.mouse.move(
    updaterBox!.x + updaterBox!.width / 2,
    updaterBox!.y + updaterBox!.height / 2,
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
      return graph.edges.find((edge) => edge.id === "condition-yes")?.target;
    })
    .toBe("no");

  const graph = await readGraph(page);
  expect(graph.edges.find((edge) => edge.id === "condition-yes")).toMatchObject(
    {
      source: "condition",
      source_handle: "output-right",
      target: "no",
      target_handle: "input-left",
    },
  );
});

test("presents the workflow entry as canvas-first before running", async ({
  page,
}) => {
  await page.goto("/?mode=entry");

  const openCanvas = page.getByRole("button", {
    name: "Open workflow canvas",
  });
  const runExisting = page.getByRole("button", {
    name: "Run existing workflow",
  });

  await expect(openCanvas).toBeVisible();
  await expect(runExisting).toBeVisible();

  const openBox = await openCanvas.boundingBox();
  const runBox = await runExisting.boundingBox();
  expect(openBox).toBeTruthy();
  expect(runBox).toBeTruthy();
  expect(openBox!.width).toBeGreaterThan(runBox!.width);

  await openCanvas.click();
  await expect(page.getByTestId("workflow-entry-action")).toHaveText(
    "open-canvas",
  );

  await runExisting.click();
  await expect(page.getByTestId("workflow-entry-action")).toHaveText(
    "run-existing",
  );
});

test("opens a node conversation panel when double-clicking a run agent node", async ({
  page,
}) => {
  await page.goto("/?mode=run-canvas");

  await doubleClickWorkflowRunNode(page, "yes");

  await expect(page).toHaveURL(/\/\?mode=run-canvas$/);
  await expect(
    page.getByTestId("workflow-node-conversation-panel"),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("workflow-node-session-id")).toContainText(
    "session-agent",
  );
  await expect(
    page.getByTestId("workflow-node-conversation-panel"),
  ).toContainText("process-agent");
  await expect(
    page.getByTestId("workflow-node-conversation-panel"),
  ).toContainText("input");
  await expect(
    page.getByTestId("workflow-node-conversation-panel"),
  ).toContainText("done");
});

test("shows runtime input output and rendered prompt for a run node", async ({
  page,
}) => {
  await page.goto("/?mode=run-canvas");

  await doubleClickWorkflowRunNode(page, "yes");
  await page.getByRole("tab", { name: "Input / Output" }).click();

  const panel = page.getByTestId("workflow-node-debug-panel");
  await expect(panel).toContainText("Rendered Prompt");
  await expect(panel).toContainText("Review {{input}} and {{upstream}}");
  await expect(panel).toContainText("input");
  await expect(panel).toContainText("done");
  await expect(panel).toContainText("session-agent");
  await expect(panel).toContainText("process-agent");
});

test("keeps an agent step session surface inside the run canvas", async ({
  page,
}) => {
  await page.goto("/?mode=run-canvas");

  await doubleClickWorkflowRunNode(page, "yes");

  const panel = page.getByTestId("workflow-node-session-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("session-agent");
  await expect(panel).toContainText("process-agent");
  await expect(page).toHaveURL(/\/\?mode=run-canvas$/);
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
  await expect(conditionNode.locator(".react-flow__handle")).toHaveCount(8);
  await expect(
    conditionNode.locator(".react-flow__handle-left.target"),
  ).toHaveCount(1);
  await expect(
    conditionNode.locator(".react-flow__handle-right.source"),
  ).toHaveCount(1);
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

test("inserts a workflow node from an edge midpoint action", async ({
  page,
}) => {
  await page.goto("/");
  await waitForWorkflowNodeVisible(page, "start");
  await expect(page.getByTestId("workflow-edge-start-condition")).toBeAttached();

  await page.getByTestId("workflow-edge-insert-start-condition").click();
  await page.getByRole("menuitem", { name: "Agent Step" }).click();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return {
        nodeCount: graph.nodes.length,
        hasInsertedAgent: graph.nodes.some((node) =>
          node.id.startsWith("agent-"),
        ),
        hasOriginalEdge: graph.edges.some(
          (edge) => edge.id === "start-condition",
        ),
      };
    })
    .toEqual({
      nodeCount: 6,
      hasInsertedAgent: true,
      hasOriginalEdge: false,
    });
});

test("adds a workflow node from quick add search", async ({ page }) => {
  await page.goto("/");

  const before = await readGraph(page);
  await page.keyboard.press("ControlOrMeta+K");
  await page
    .getByRole("dialog", { name: "Add workflow step" })
    .getByRole("textbox")
    .fill("agent");
  await page.getByRole("option", { name: "Agent Step" }).click();

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      return graph.nodes.length;
    })
    .toBe(before.nodes.length + 1);
});

test("selects a node and keeps the minimap on a visible canvas surface", async ({
  page,
}) => {
  await page.goto("/");

  await clickWorkflowNode(page, "condition");
  await expect(page.getByTestId("node-inspector")).toContainText(
    "Condition Step",
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
  await expect(page.getByTestId("node-dialog")).toContainText("Condition Step");
});

test("keeps agent output capture out of the user-facing node dialog", async ({
  page,
}) => {
  await page.goto("/");

  await clickWorkflowNode(page, "yes");

  const dialog = page.getByTestId("node-dialog");
  await expect(dialog).toContainText("Agent Step");
  await expect(dialog).toContainText("Role Template ID");
  await expect(dialog).toContainText("Prompt Template");
  await expect(dialog).not.toContainText("Output Capture");
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
});

test("edits agent configuration through the node dialog", async ({ page }) => {
  await page.goto("/");

  await clickWorkflowNode(page, "yes");
  const dialog = page.getByTestId("node-dialog");

  await dialog.getByLabel("Role Template ID").fill("planner");
  await dialog.getByLabel("Prompt Template").fill("Plan from {{input}}");

  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      const node = graph.nodes.find((candidate) => candidate.id === "yes") as
        | undefined
        | { data?: { role_template_id?: string; prompt_template?: string } };
      return node?.data;
    })
    .toMatchObject({
      role_template_id: "planner",
      prompt_template: "Plan from {{input}}",
    });
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
  await expect(page.getByTestId("node-dialog")).toContainText("Condition Step");
});

test("opens a node configuration dialog in read-only mode", async ({
  page,
}) => {
  await page.goto("/?readonly=1");

  await doubleClickWorkflowNode(page, "condition");
  await expect(page.getByTestId("node-dialog")).toContainText("Condition Step");
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
