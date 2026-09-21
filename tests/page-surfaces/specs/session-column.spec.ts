import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`sessions have a permanent peer column at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/sessions/recent?*", (route) => {
      expect(
        new URL(route.request().url()).searchParams.get("project_id"),
      ).toBe("project-2");
      return route.fulfill({
        json: { success: true, data: { sessions: [], next_cursor: null } },
      });
    });
    await page.goto("/?surface=board&sessionColumn");
    const columns = page.locator(".vk-kanban-columns > .vk-kanban-column");
    await expect(columns).toHaveCount(5);
    await expect(
      columns.first().getByRole("heading", { name: "Discuss", exact: true }),
    ).toBeVisible();
    await expect(
      columns.nth(1).getByRole("heading", { name: "Todo", exact: true }),
    ).toHaveCount(1);
    await expect(columns.first().locator(".vk-kanban-column__cards")).toBeEmpty();
    await expect(columns.first()).not.toContainText("No discussions yet.");
    await expect(columns.first().locator(".vk-kanban-column__count")).toHaveText("0");
    const sessionBox = await columns.first().boundingBox();
    const todoBox = await columns.nth(1).boundingBox();
    expect(sessionBox?.y).toBe(todoBox?.y);
    expect(sessionBox?.width).toBe(todoBox?.width);
    expect(sessionBox?.height).toBe(todoBox?.height);
    const discussDot = columns.first().locator(".vk-kanban-column__dot");
    const todoDot = columns.nth(1).locator(".vk-kanban-column__dot");
    await expect(discussDot).toBeVisible();
    await expect(discussDot).toHaveAttribute("aria-hidden", "true");
    const discussDotBox = await discussDot.boundingBox();
    const todoDotBox = await todoDot.boundingBox();
    expect(discussDotBox?.width).toBe(todoDotBox?.width);
    expect(discussDotBox?.height).toBe(todoDotBox?.height);
    await page.evaluate(() =>
      window.addEventListener("fixture-navigation", (event) => {
        document.documentElement.dataset.navigation = (
          event as CustomEvent<string>
        ).detail;
      }),
    );
    await columns
      .first()
      .getByRole("button", { name: "New discussion", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-navigation",
      "project-workspace-create:project-2",
    );
  });
}

test("sessions stay out of Issue columns and open the existing session", async ({
  page,
}) => {
  await page.route("**/api/sessions/recent?*", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          sessions: [
            {
              id: "session-1",
              workspace_id: "workspace-1",
              task_id: null,
              title: "Independent conversation",
            },
            {
              id: "task-session",
              workspace_id: "workspace-2",
              task_id: "task-1",
              title: "Issue execution",
            },
          ],
          next_cursor: null,
        },
      },
    }),
  );
  await page.goto("/?surface=board&sessionColumn");
  const column = page.getByRole("region", { name: "Discuss", exact: true });
  await expect(
    column.getByRole("button", {
      name: "Independent conversation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Issue execution")).toHaveCount(0);
  await expect(page.locator("[data-issue-id]")).toHaveCount(0);
  await expect(column.locator('[aria-roledescription="sortable"]')).toHaveCount(
    0,
  );
  await column
    .getByRole("button", { name: "Independent conversation", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-route",
    /\/workspaces\/workspace-1\?session_id=session-1/,
  );
});

test("session-column failure preserves the board and retries in place", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/sessions/recent?*", (route) =>
    fail
      ? route.fulfill({
          status: 500,
          json: { success: false, message: "Read failed" },
        })
      : route.fulfill({
          json: { success: true, data: { sessions: [], next_cursor: null } },
        }),
  );
  await page.goto("/?surface=board&sessionColumn");
  const column = page.getByRole("region", { name: "Discuss", exact: true });
  await expect(column.getByRole("alert")).toBeVisible();
  await expect(
    page.locator(".vk-kanban-columns > .vk-kanban-column"),
  ).toHaveCount(5);
  fail = false;
  await column.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(column.getByRole("alert")).toHaveCount(0);
  await expect(column.locator(".vk-kanban-column__cards")).toBeEmpty();
  await expect(column).not.toContainText("No discussions yet.");
});
