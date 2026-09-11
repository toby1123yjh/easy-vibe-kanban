import { expect, test, type Page } from "@playwright/test";

async function openActions(page: Page, project: number) {
  await page
    .getByRole("button", {
      name: `More actions for Project ${project}`,
      exact: true,
    })
    .click();
}

async function settleDeletion(page: Page, result: "success" | "failure") {
  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent("fixture-delete-result", { detail }));
  }, result);
}

for (const width of [375, 1440]) {
  test(`${width}px project settings targets the clicked project`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await openActions(page, 2);
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-fixture-route",
      /\/settings\?.*projectId=project-2/,
    );
    const route = await page.locator("html").getAttribute("data-fixture-route");
    expect(route).not.toContain("organizations");
    const destination = new URL(route!, "http://fixture.invalid");
    expect(destination.searchParams.get("section")).toBe("projects");
    expect(destination.searchParams.get("projectId")).toBe("project-2");
  });
}

test("delete confirms the exact project, locks pending, reports failure, and retries", async ({
  page,
}) => {
  await page.goto("/");
  await openActions(page, 2);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Project 2");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-delete-requests",
  );
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-delete-requests",
    '["project-2"]',
  );
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open Project 1", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await settleDeletion(page, "failure");
  await expect(dialog).toContainText("Failed to delete project");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-delete-requests",
    '["project-2","project-2"]',
  );
  await settleDeletion(page, "success");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "More actions for Project 2",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-project-refreshes",
    "1",
  );
});

test("canceling project deletion never invokes mutation", async ({ page }) => {
  await page.goto("/");
  await openActions(page, 3);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Project 3");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-delete-requests",
  );
});

for (const width of [375, 1440]) {
  test(`${width}px board actions retain the project settings target`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?surface=board");
    await openActions(page, 2);
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-fixture-route",
      /projectId=project-2/,
    );
  });
}

test("board deletion navigates only after persistence and refreshes project discovery", async ({
  page,
}) => {
  await page.goto("/?surface=board");
  await openActions(page, 2);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Project 2");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-delete-requests",
  );
  await openActions(page, 2);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-delete-requests",
    '["project-2"]',
  );
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-fixture-route",
    "/projects",
  );
  await settleDeletion(page, "failure");
  await expect(dialog).toContainText("Failed to delete project");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await settleDeletion(page, "success");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-route",
    "/projects",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-project-refreshes",
    "1",
  );
});

test("an open board confirmation cannot delete after its Host scope changes", async ({
  page,
}) => {
  await page.goto("/?surface=board");
  await openActions(page, 2);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture-change-scope")),
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toContainText("Failed to delete project");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-delete-requests",
  );
});

test("scoped project settings keep Delete accessible while Host settings are unavailable", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Fixture host unavailable" }),
    }),
  );
  await page.goto("/?surface=settings&mode=actions");
  const name = page.getByPlaceholder("Enter project name");
  await expect(name).toHaveValue("Project 2");
  await expect(page.getByText("Project 1", { exact: true })).toHaveCount(0);
  await name.fill("Unsaved project name");
  await openActions(page, 2);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Project 2");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(name).toHaveValue("Unsaved project name");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-delete-requests",
  );
  await openActions(page, 2);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-delete-requests",
    '["project-2"]',
  );
  await settleDeletion(page, "failure");
  await expect(dialog).toContainText("Failed to delete project");
  await expect(name).toHaveValue("Unsaved project name");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await settleDeletion(page, "success");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-route",
    "/projects",
  );
});
