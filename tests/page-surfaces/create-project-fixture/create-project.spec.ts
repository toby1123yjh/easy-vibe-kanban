import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "Open create project" }).click();
  await page.getByLabel("Project name").fill("New project");
}
const create = (page: Page) =>
  page.getByRole("button", { name: "Create Project", exact: true }).click();
const data = (page: Page, key: string) =>
  page
    .locator("html")
    .getAttribute(`data-${key}`)
    .then((value) => JSON.parse(value ?? "null"));

test("directory is required, including Enter; cancel writes nothing", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("button", { name: "Create Project", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Project name").press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Choose a working directory",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await data(page, "inserts")).toBeNull();
  expect(await data(page, "saves")).toBeNull();
  expect(await data(page, "result")).toMatchObject({ action: "canceled" });
});

for (const mode of ["folder", "git"]) {
  test(`${mode} saves default to exact created project and selected host`, async ({
    page,
  }) => {
    await open(page, `?mode=${mode}`);
    await page.getByLabel("Machine", { exact: true }).selectOption("remote-1");
    await page
      .getByRole("button", {
        name: "Choose folder or Git repository",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      mode === "git" ? "feature/test" : "/fixture/folder",
    );
    await create(page);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(await data(page, "picker")).toMatchObject([
      { hostId: "remote-1", purpose: "project_default" },
    ]);
    expect(await data(page, "saves")).toEqual([
      {
        projectId: "created-project",
        hostId: "remote-1",
        value:
          mode === "git"
            ? {
                kind: "git",
                repo: { repo_id: "repo-2", target_branch: "feature/test" },
              }
            : { kind: "direct_folder", path: "/fixture/folder" },
      },
    ]);
  });
}

test("save failure retries without creating duplicate project", async ({
  page,
}) => {
  await open(page, "?fail");
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await create(page);
  await expect(page.getByRole("alert")).toContainText(
    "The working directory could not be saved",
  );
  await page
    .getByRole("button", { name: "Retry saving directory", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await data(page, "inserts")).toHaveLength(1);
  expect(await data(page, "saves")).toHaveLength(2);
});

test("cancel after failed save discards unfinished project instead of reporting success", async ({
  page,
}) => {
  await open(page, "?fail");
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await create(page);
  await expect(page.getByRole("alert")).toContainText(
    "The working directory could not be saved",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await data(page, "result")).toMatchObject({
    action: "canceled",
  });
  expect(await data(page, "removes")).toEqual(["created-project"]);
  expect(await data(page, "inserts")).toHaveLength(1);
});

test("pending save locks cancellation and machine selection", async ({
  page,
}) => {
  await open(page, "?hold");
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await create(page);
  await expect(page.getByLabel("Machine", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture-save-release")),
  );
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await data(page, "inserts")).toHaveLength(1);
});

test("changing machine requires choosing its directory again", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Create Project", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Machine", { exact: true }).selectOption("remote-1");
  await expect(
    page.getByRole("button", { name: "Create Project", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Project name").press("Enter");
  expect(await data(page, "inserts")).toBeNull();
});

test("failed cancellation stays open and retries removing the same project", async ({
  page,
}) => {
  await open(page, "?fail&cancel-fail");
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await create(page);
  await expect(page.getByRole("alert")).toContainText(
    "The working directory could not be saved",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not discard");
  expect(await data(page, "result")).toBeNull();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await data(page, "removes")).toEqual([
    "created-project",
    "created-project",
  ]);
  expect(await data(page, "inserts")).toHaveLength(1);
  expect(await data(page, "result")).toEqual({ action: "canceled" });
});

test("picker cancellation does not satisfy the required directory", async ({
  page,
}) => {
  await open(page, "?picker-cancel");
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Create Project", exact: true }),
  ).toBeDisabled();
  expect(await data(page, "inserts")).toBeNull();
});

test("host going offline prevents creation even by Enter", async ({ page }) => {
  await open(page);
  await page.getByLabel("Machine", { exact: true }).selectOption("remote-1");
  await page
    .getByRole("button", {
      name: "Choose folder or Git repository",
      exact: true,
    })
    .click();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture-host-offline")),
  );
  await expect(
    page.getByRole("button", { name: "Create Project", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Project name").press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Choose the working directory again",
  );
  expect(await data(page, "inserts")).toBeNull();
  expect(await data(page, "saves")).toBeNull();
});
