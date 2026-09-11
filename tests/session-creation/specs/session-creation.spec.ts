import { expect, test } from "@playwright/test";

for (const scenario of [
  { mode: "success", direct: false, status: "success", appears: true },
  { mode: "create-failure", direct: false, status: "error", appears: false },
  { mode: "link-failure", direct: false, status: "error", appears: true },
  { mode: "success", direct: true, status: "success", appears: true },
  { mode: "create-failure", direct: true, status: "error", appears: false },
  { mode: "followup-failure", direct: true, status: "error", appears: true },
]) {
  test(`${scenario.direct ? "direct" : "task"} session ${scenario.mode}`, async ({
    page,
  }) => {
    await page.goto(
      `/?mode=${scenario.mode}&direct=${scenario.direct ? 1 : 0}`,
    );
    await expect(page.getByTestId("rows")).toHaveText("[]");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByTestId("status")).toHaveText(scenario.status);
    await expect(page.getByTestId("calls")).toHaveText(
      scenario.appears ? /^[23]\/1$/ : "1/1",
    );
    if (scenario.appears) {
      await expect(page.getByRole("navigation")).toHaveText("Issue task");
      await expect(page.getByTestId("rows")).toHaveText(
        JSON.stringify([
          {
            id: "session-1",
            workspace_id: "workspace-1",
            name: "Issue task",
            issue_id:
              !scenario.direct && scenario.status === "success"
                ? "issue-1"
                : null,
          },
        ]),
      );
    } else {
      await expect(page.getByTestId("rows")).toHaveText("[]");
    }
  });
}
