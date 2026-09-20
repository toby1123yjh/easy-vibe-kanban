import { test, expect } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`loading keeps final board geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?loading");
    const board = page.locator(".vk-project-kanban");
    await expect(board).toHaveAttribute("aria-busy", "true");
    await expect(board.locator(".vk-kanban-column")).toHaveCount(5);
    const before = await board.boundingBox();
    const columnBefore = await board
      .locator(".vk-kanban-column")
      .first()
      .boundingBox();
    await page.getByRole("button", { name: "Finish loading" }).click();
    await expect(board).not.toHaveAttribute("aria-busy", "true");
    const after = await board.boundingBox();
    const columnAfter = await board
      .locator(".vk-kanban-column")
      .first()
      .boundingBox();
    expect(after).toEqual(before);
    expect(columnAfter?.x).toBe(columnBefore?.x);
    expect(columnAfter?.width).toBe(columnBefore?.width);
    await expect(board.locator(".vk-kanban-skeleton-line")).toHaveCount(0);
  });
}
