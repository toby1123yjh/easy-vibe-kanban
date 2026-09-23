import { expect, test, type Page } from "@playwright/test";
import type { fixture } from "../fixture/mocks";
declare global {
  interface Window {
    managedFixture: typeof fixture;
  }
}
const DEFAULT = "00000000-0000-0000-0000-000000000003";
async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("ready")).toHaveText("fixture ready");
}
const calls = (page: Page) =>
  page.evaluate(() => window.managedFixture.submissions);
const send = (page: Page) =>
  page.getByRole("button", { name: "Send", exact: true });
const selector = (page: Page) =>
  page.getByRole("combobox", { name: "sessionProject.label" });

test("creation failure shows a translated summary and keeps native error in collapsed details", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.managedFixture.fail = true;
  });
  await send(page).click();
  await expect(
    page.getByText("sessionProject.createFailed", { exact: true }),
  ).toBeVisible();
  const details = page.locator("details");
  await expect(details).not.toHaveAttribute("open");
  await expect(details.locator("pre")).toBeHidden();
  await details.locator("summary").click();
  await expect(details.locator("pre")).toHaveText("creation failed");
});

test("default project ignores stale draft path and sends without directory prompt", async ({
  page,
}) => {
  await open(page, "?path=/stale-draft");
  await expect(selector(page)).toHaveValue(DEFAULT);
  await expect(
    page.getByRole("button", { name: "Choose directory" }),
  ).toHaveCount(0);
  await send(page).click();
  expect((await calls(page))[0].data).toMatchObject({
    project_id: DEFAULT,
    mode: "managed_directory",
    repos: [],
    prompt: "Hello agent",
  });
  expect((await calls(page))[0].data.directory_path).toBeUndefined();
  expect(await page.evaluate(() => window.managedFixture.dialogCalls)).toEqual(
    [],
  );
});

test("project selection derives its direct folder without changing draft", async ({
  page,
}) => {
  await open(page, "?path=/project");
  await selector(page).selectOption("project-1");
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Hello agent",
  );
  await send(page).click();
  expect((await calls(page))[0].data).toMatchObject({
    project_id: "project-1",
    mode: "direct_folder",
    directory_path: "/project",
    repos: [],
  });
  expect(
    await page.evaluate(() => window.managedFixture.savedDefaults),
  ).toEqual([]);
});

test("Issue launch locks project and inherits Git branch without prompting", async ({
  page,
}) => {
  await open(page, "?project=1&repo=1");
  await expect(selector(page)).toHaveValue("project-1");
  await expect(selector(page)).toBeDisabled();
  await send(page).click();
  expect((await calls(page))[0].data).toMatchObject({
    project_id: "project-1",
    mode: "worktree",
    repos: [{ repo_id: "repo-1", target_branch: "main" }],
    linked_issue: { remote_project_id: "project-1", issue_id: "issue-1" },
  });
  expect(await page.evaluate(() => window.managedFixture.dialogCalls)).toEqual(
    [],
  );
});

for (const draft of ["missing", "stale"]) {
  test(`route Issue overrides ${draft} draft and cannot become standalone`, async ({
    page,
  }) => {
    await open(
      page,
      `?requiredIssue&repo=1${draft === "stale" ? "&project=1" : ""}`,
    );
    await expect(selector(page)).toHaveValue("project-1");
    await expect(selector(page)).toBeDisabled();
    await expect(page.getByTestId("linked-issue")).toHaveText("P-ROUTE");
    await expect(
      page.getByRole("button", { name: "Remove Issue link", exact: true }),
    ).toHaveCount(0);
    expect(await calls(page)).toEqual([]);

    // Even a later draft update cannot remove the route-owned association.
    await page.evaluate(() =>
      window.managedFixture.update({ linkedIssue: null }),
    );
    await expect(page.getByTestId("linked-issue")).toHaveText("P-ROUTE");
    await send(page).click();
    expect(await calls(page)).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          project_id: "project-1",
          linked_issue: {
            remote_project_id: "project-1",
            issue_id: "route-issue",
          },
        }),
        linkToIssue: { remoteProjectId: "project-1", issueId: "route-issue" },
      }),
    ]);
  });
}

test("standalone entry retains optional Issue linking and plain session creation", async ({
  page,
}) => {
  await open(page, "?project=1&repo=1");
  await expect(page.getByTestId("linked-issue")).toHaveText(
    "P-1Remove Issue link",
  );
  await page
    .getByRole("button", { name: "Remove Issue link", exact: true })
    .click();
  await expect(page.getByTestId("linked-issue")).toHaveCount(0);
  await expect(selector(page)).toBeEnabled();
  await selector(page).selectOption(DEFAULT);
  await send(page).click();
  expect((await calls(page))[0].data).toMatchObject({
    project_id: DEFAULT,
    linked_issue: null,
  });
  expect((await calls(page))[0].linkToIssue).toBeUndefined();
});

test("missing workspace blocks send and explicit setup saves project on original Host", async ({
  page,
}) => {
  await open(page);
  await selector(page).selectOption("project-1");
  await expect(send(page)).toBeDisabled();
  await page.getByRole("button", { name: "sessionProject.configure" }).click();
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({
      kind: "confirmed",
      selection: { mode: "direct_folder", path: "/configured" },
    }),
  );
  await expect(send(page)).toBeEnabled();
  expect(
    await page.evaluate(() => window.managedFixture.savedDefaults),
  ).toEqual([
    ["project-1", { kind: "direct_folder", path: "/configured" }, "host-a"],
  ]);
  await send(page).click();
  expect((await calls(page))[0].data.directory_path).toBe("/configured");
});

test("cancel setup leaves project blocked; default needs no setup", async ({
  page,
}) => {
  await open(page);
  await selector(page).selectOption("project-1");
  await page.getByRole("button", { name: "sessionProject.configure" }).click();
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({ kind: "cancelled" }),
  );
  await expect(send(page)).toBeDisabled();
  await selector(page).selectOption(DEFAULT);
  await send(page).click();
  expect((await calls(page))[0].data.mode).toBe("managed_directory");
});

test("lookup failure blocks send and retry reloads it", async ({ page }) => {
  await open(page, "?path=/project");
  await page.evaluate(() => {
    window.managedFixture.targetFailure = true;
  });
  await selector(page).selectOption("project-1");
  await expect(page.getByRole("alert")).toContainText("sessionProject.failed");
  await expect(send(page)).toBeDisabled();
  await page.evaluate(() => {
    window.managedFixture.targetFailure = false;
  });
  await page.getByRole("button", { name: "buttons.retry" }).click();
  await send(page).click();
  expect((await calls(page))[0].data.directory_path).toBe("/project");
});

test("late project response cannot overwrite default target", async ({
  page,
}) => {
  await open(page, "?path=/old");
  await page.evaluate(() => {
    window.managedFixture.targetDeferred = true;
  });
  await selector(page).selectOption("project-1");
  await expect(send(page)).toBeDisabled();
  await selector(page).selectOption(DEFAULT);
  await page.evaluate(() => window.managedFixture.resolveTarget());
  await send(page).click();
  expect((await calls(page))[0].data).toMatchObject({
    project_id: DEFAULT,
    mode: "managed_directory",
  });
  expect((await calls(page))[0].data.directory_path).toBeUndefined();
});

test("same tick submission does not allocate twice", async ({ page }) => {
  await open(page);
  await expect(send(page)).toBeEnabled();
  await page.evaluate(() => {
    window.managedFixture.deferred = true;
    window.managedFixture.sendTwice();
  });
  expect(await calls(page)).toHaveLength(1);
  await expect(send(page)).toBeDisabled();
  await page.evaluate(() => window.managedFixture.finish());
  await expect
    .poll(() => page.evaluate(() => window.managedFixture.created))
    .toEqual(["workspace-1"]);
});

test("late creation cannot clear another Host draft", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.managedFixture.deferred = true;
  });
  await send(page).click();
  await page.evaluate(() =>
    window.managedFixture.update({
      hostId: "host-b",
      message: "New Host draft",
    }),
  );
  await page.evaluate(() => window.managedFixture.finish());
  await expect(send(page)).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "New Host draft",
  );
  expect(
    await page.evaluate(() => ({
      created: window.managedFixture.created,
      clears: window.managedFixture.clears,
    })),
  ).toEqual({ created: [], clears: 0 });
});

test("late picker after Host change cannot save old selection", async ({
  page,
}) => {
  await open(page);
  await selector(page).selectOption("project-1");
  await page.getByRole("button", { name: "sessionProject.configure" }).click();
  await page.evaluate(() => window.managedFixture.update({ hostId: "host-b" }));
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({
      kind: "confirmed",
      selection: { mode: "direct_folder", path: "/old-host" },
    }),
  );
  await expect(selector(page)).toHaveValue(DEFAULT);
  await send(page).click();
  expect(
    await page.evaluate(() => window.managedFixture.savedDefaults),
  ).toEqual([]);
});

test("project entry seeds ownership even without an Issue", async ({
  page,
}) => {
  await open(page, "?initialProject=1&path=/project");
  await expect(selector(page)).toHaveValue("project-1");
  await expect(selector(page)).toBeEnabled();
  await send(page).click();
  expect((await calls(page))[0].data).toMatchObject({
    project_id: "project-1",
    directory_path: "/project",
    linked_issue: null,
  });
});

test("missing remote Host cannot fall back to local creation", async ({
  page,
}) => {
  await open(page);
  await expect(send(page)).toBeEnabled();
  await page.evaluate(() => window.managedFixture.update({ hostId: "" }));
  await expect(send(page)).toBeDisabled();
  await expect(selector(page)).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("defaultProject.offline");
  expect(await calls(page)).toEqual([]);
});
