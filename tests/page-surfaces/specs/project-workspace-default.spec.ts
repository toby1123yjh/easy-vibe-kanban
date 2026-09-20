import { expect, test } from "@playwright/test";

for (const [status, message, missing] of [
  [400, "Scratch not found", true],
  [404, "Not found", true],
  [400, "Invalid project identifier", false],
  [503, "Unavailable", false],
] as const) {
  test(`workspace lookup ${status} ${message} preserves the unconfigured/error distinction`, async ({
    page,
  }) => {
    await page.route(
      "**/api/scratch/PROJECT_REPO_DEFAULTS/project-1",
      (route) =>
        route.fulfill({
          status,
          json: { success: false, message },
        }),
    );
    await page.goto("/");
    const moduleUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/web-core/src/shared/hooks/useProjectRepoDefaults.ts`;
    const result = await page.evaluate(async (url) => {
      const { getProjectWorkspaceDefaultOrThrow } = await import(url);
      try {
        return { value: await getProjectWorkspaceDefaultOrThrow("project-1") };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }, moduleUrl);
    expect(result).toEqual(missing ? { value: null } : { error: message });
  });
}
