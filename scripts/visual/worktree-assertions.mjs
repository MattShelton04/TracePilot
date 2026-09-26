/** Exercise table geometry in the browser; DOM-only tests cannot detect anonymous cells. */
export async function assertWorktreeLayout(page) {
  const originalViewport = page.viewportSize();
  const stale = page.locator(".wt-row--stale").first();
  const active = page.locator(".wt-row:not(.wt-row--stale)").first();
  await stale.waitFor({ state: "visible" });
  await active.waitFor({ state: "visible" });

  async function assertAligned(state) {
    const error = await page.locator(".wt-table").evaluate((table) => {
      const headers = [...table.querySelectorAll("thead th")].map((cell) =>
        cell.getBoundingClientRect(),
      );
      for (const row of table.querySelectorAll("tbody tr")) {
        const cells = [...row.children];
        if (cells.length !== headers.length) return "Worktree column count changed";
        for (const [index, cell] of cells.entries()) {
          const rect = cell.getBoundingClientRect();
          const header = headers[index];
          if (Math.abs(rect.x - header.x) > 1 || Math.abs(rect.width - header.width) > 1) {
            return `Misaligned worktree column ${index + 1} in ${row.className}`;
          }
        }
      }
      return null;
    });
    if (error) throw new Error(`${state}: ${error}`);
  }

  try {
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 960, height: 640 },
      { width: 2560, height: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      await assertAligned(`${viewport.width}px unselected`);
      for (const [name, row] of [
        ["stale", stale],
        ["active", active],
      ]) {
        await row.locator(".wt-row-select").click();
        await page.waitForFunction(() => !!document.querySelector(".wt-row--selected"));
        await assertAligned(`${viewport.width}px selected ${name}`);
        await row.locator(".wt-row-select").click();
        await page.waitForFunction(() => !document.querySelector(".wt-row--selected"));
      }
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
    await page.locator(".wt-list").evaluate((list) => {
      list.scrollLeft = 0;
      list.scrollTop = 0;
    });
  }
}
