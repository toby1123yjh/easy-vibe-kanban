import { test, expect } from "@playwright/test";

test("picker confirmation after route unmount cannot save defaults or start a workflow", async ({
  page,
}) => {
  const mutations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (
      (url.includes("/scratch/") && route.request().method() !== "GET") ||
      url.includes("/workflow-attempts")
    )
      mutations.push(url);
    const data = url.includes("/repos")
      ? []
      : url.includes("/inspect-directory")
        ? { path: "F:\\notes", is_git_repo: false, repo: null }
        : {
            payload: {
              type: "PROJECT_REPO_DEFAULTS",
              data: { repos: [], directory_path: "F:\\notes" },
            },
          };
    await route.fulfill({ json: { success: true, data, message: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Choose workflow location" }).click();
  const confirm = page.getByRole("button", {
    name: "Use this directory",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("unmount-workflow-fixture")),
  );
  await expect(page.getByText("Workflow route closed")).toBeVisible();
  await confirm.click();
  await expect(confirm).not.toBeVisible();
  expect(mutations).toEqual([]);
});

test("real workflow chooser prefills a non-Git project directory and carries it into create/run requests", async ({
  page,
}) => {
  const payloads: unknown[] = [];
  let defaultWrites = 0;
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/scratch/") && route.request().method() !== "GET")
      defaultWrites++;
    let data: unknown = {};
    if (url.includes("/repos")) data = [];
    else if (url.includes("/scratch/"))
      data = {
        payload: {
          type: "PROJECT_REPO_DEFAULTS",
          data: { repos: [], directory_path: "F:\\notes" },
        },
      };
    else if (url.includes("/inspect-directory"))
      data = { path: "F:\\notes", is_git_repo: false, repo: null };
    else if (url.includes("/workflow-attempts")) {
      payloads.push(route.request().postDataJSON());
      data = { id: "attempt-a" };
    }
    await route.fulfill({
      json: url.includes("/local/v1/")
        ? { data, txid: 1 }
        : { success: true, data, message: null },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Choose workflow location" }).click();
  await expect(page.locator("input").first()).toHaveValue("F:\\notes");
  await expect(page.getByRole("radio", { name: "Direct editing" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Isolated Worktree" })).toBeDisabled();
  await expect(page.getByText("F:\\notes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("The agent will edit files in this directory.")).toBeVisible();
  const unavailable = page.getByRole("button", { name: "Requires a Git repository" });
  await unavailable.focus();
  await expect(page.getByRole("tooltip")).toContainText("Requires a Git repository");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("button", { name: "Use this directory", exact: true })).toBeVisible();
  const dialog = await page.getByRole("dialog").boundingBox();
  expect(dialog!.width).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("output")).toHaveText("canceled");
  expect(payloads).toHaveLength(0);
  expect(defaultWrites).toBe(0);
  await page.getByRole("button", { name: "Choose workflow location" }).click();
  const confirm = page.getByRole("button", {
    name: "Use this directory",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator("output")).toContainText("directory_path");
  expect(payloads).toHaveLength(2);
  for (const payload of payloads)
    expect(payload).toMatchObject({ repos: [], directory_path: "F:\\notes" });
});
