import { expect, test, type Page } from "@playwright/test";
import type { fixture } from "../fixture/mocks";

declare global {
  interface Window {
    managedFixture: typeof fixture;
  }
}
async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("ready")).toHaveText("fixture ready");
}
const calls = (page: Page) =>
  page.evaluate(() => window.managedFixture.submissions);

test("fresh standalone composer sends managed mode without prompting or choosing a path", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("region", { name: "Composer" })).toBeVisible();
  expect(await page.evaluate(() => window.managedFixture.dialogCalls)).toEqual(
    [],
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  expect((await calls(page))[0].data).toMatchObject({
    mode: "managed_directory",
    repos: [],
    prompt: "Hello agent",
  });
  expect((await calls(page))[0].data.directory_path).toBeUndefined();
});

test("explicit selected directory overrides managed allocation", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Choose directory" }).click();
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({
      kind: "confirmed",
      selection: { mode: "direct_folder", path: "/existing" },
    }),
  );
  await expect(page.getByTestId("summary")).toHaveText("Direct folder");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await calls(page))[0].data).toMatchObject({
    mode: "direct_folder",
    directory_path: "/existing",
    repos: [],
  });
});

test("project direct-folder default is retained and saved to the original Host", async ({
  page,
}) => {
  await open(page, "?project=1&path=/project");
  await expect
    .poll(() => page.evaluate(() => window.managedFixture.dialogCalls.length))
    .toBe(1);
  expect(
    await page.evaluate(() => window.managedFixture.dialogCalls[0]),
  ).toMatchObject({
    initialPath: "/project",
    initialMode: "direct_folder",
    hostId: "host-a",
  });
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({
      kind: "confirmed",
      selection: { mode: "direct_folder", path: "/project" },
    }),
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await calls(page))[0].data).toMatchObject({
    mode: "direct_folder",
    linked_issue: { remote_project_id: "project-1", issue_id: "issue-1" },
  });
  await expect
    .poll(() => page.evaluate(() => window.managedFixture.savedDefaults))
    .toEqual([
      ["project-1", { kind: "direct_folder", path: "/project" }, "host-a"],
    ]);
});

test("initial hydration blocks creation until workspace defaults finish", async ({
  page,
}) => {
  await open(page, "?defaultsLoading=1");
  expect(await calls(page)).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.managedFixture.update({ hasResolvedInitialWorkspaceDefaults: true }),
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await calls(page))[0].data.mode).toBe("managed_directory");
});

test("same-tick submit and pending activation do not allocate twice", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.managedFixture.deferred = true;
    window.managedFixture.sendTwice();
  });
  expect(await calls(page)).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.managedFixture.finish());
  await expect
    .poll(() => page.evaluate(() => window.managedFixture.created))
    .toEqual(["workspace-1"]);
});

test("picker completion after a Host change cannot select the old directory", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Choose directory" }).click();
  await page.evaluate(() => window.managedFixture.update({ hostId: "host-b" }));
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({
      kind: "confirmed",
      selection: { mode: "direct_folder", path: "/old-host" },
    }),
  );
  await expect(page.getByTestId("summary")).toHaveText("Automatic directory");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await calls(page))[0].data.mode).toBe("managed_directory");
});

test("project Git target keeps its worktree and branch semantics", async ({
  page,
}) => {
  await open(page, "?project=1&repo=1");
  await expect
    .poll(() => page.evaluate(() => window.managedFixture.dialogCalls.length))
    .toBe(1);
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({
      kind: "confirmed",
      selection: {
        mode: "worktree",
        repo: window.managedFixture.state.repos[0],
        targetBranch: "feature",
      },
    }),
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await calls(page))[0].data).toMatchObject({
    mode: "worktree",
    repos: [{ repo_id: "repo-1", target_branch: "feature" }],
  });
  expect((await calls(page))[0].data.directory_path).toBeUndefined();
});

test("cancelled override preserves the automatic target", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Choose directory" }).click();
  await page.evaluate(() =>
    window.managedFixture.resolveDialog({ kind: "cancelled" }),
  );
  await expect(page.getByTestId("summary")).toHaveText("Automatic directory");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await calls(page))[0].data.mode).toBe("managed_directory");
});

test("failed creation retains draft and permits retry without stale pending lock", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.managedFixture.fail = true;
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("error")).toHaveText("creation failed");
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Hello agent",
  );
  expect(await page.evaluate(() => window.managedFixture.clears)).toBe(0);
  await page.evaluate(() => {
    window.managedFixture.fail = false;
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.managedFixture.created))
    .toEqual(["workspace-2"]);
  expect(await calls(page)).toHaveLength(2);
});

test("late creation completion cannot navigate or clear a different Host draft", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.managedFixture.deferred = true;
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.evaluate(() =>
    window.managedFixture.update({
      hostId: "host-b",
      message: "New Host draft",
    }),
  );
  await page.evaluate(() => window.managedFixture.finish());
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
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
