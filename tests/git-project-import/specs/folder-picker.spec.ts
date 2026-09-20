import { test, expect } from "@playwright/test";

test("native picker opens once, cancellation preserves value, and it can reopen", async ({
  page,
}) => {
  let calls = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/filesystem/pick-folder", async (route) => {
    calls++;
    expect(route.request().postDataJSON().initial_path).toBe("/previous");
    if (calls === 1) await waiting;
    await route.fulfill({
      json: {
        success: true,
        data: calls === 1 ? null : "/chosen",
        message: null,
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Choose directory", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "system directory window",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(calls).toBe(1);
  release();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByLabel("Selected directory")).toHaveText("/previous");
  await page
    .getByRole("button", { name: "Choose directory", exact: true })
    .click();
  await expect(page.getByLabel("Selected directory")).toHaveText("/chosen");
  expect(calls).toBe(2);
});

test("remote host accepts its path without opening a local native picker", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/filesystem/")) requests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch host" }).click();
  await page
    .getByRole("button", { name: "Choose directory", exact: true })
    .click();
  await expect(
    page.getByText("Enter a directory path on the selected remote host."),
  ).toBeVisible();
  await page.getByLabel("Directory path", { exact: true }).fill("/remote/work");
  await page.getByRole("button", { name: "Use this directory" }).click();
  await expect(page.getByLabel("Selected directory")).toHaveText(
    "/remote/work",
  );
  expect(requests).toEqual([]);
});

test("native picker failure offers manual entry instead of the custom browser", async ({
  page,
}) => {
  await page.route("**/api/filesystem/pick-folder", (route) =>
    route.fulfill({ status: 500, body: "Picker unavailable" }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Choose directory", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Directory path", { exact: true }).fill("/manual");
  await page.getByRole("button", { name: "Use this directory" }).click();
  await expect(page.getByLabel("Selected directory")).toHaveText("/manual");
});
