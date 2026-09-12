import { expect, test } from "@playwright/experimental-ct-vue";
import SearchGroupedResultsHarness from "./SearchGroupedResultsHarness.vue";

test.describe("Grouped Search header", () => {
  for (const width of [356, 736, 1240]) {
    test(`keeps long titles, metadata and actions inside ${width}px results`, async ({ mount }) => {
      const component = await mount(SearchGroupedResultsHarness, { props: { width } });
      const dimensions = await component.locator(".session-group-header").evaluate((header) => {
        const box = header.getBoundingClientRect();
        const title = header.querySelector<HTMLElement>(".session-group-title");
        if (!title) throw new Error("The group title is missing");
        const items = [
          ...header.querySelectorAll<HTMLElement>(".session-group-title, .badge, button, a"),
        ];
        return {
          width: header.clientWidth,
          scroll: header.scrollWidth,
          titleWidth: title.getBoundingClientRect().width,
          titleHeight: title.getBoundingClientRect().height,
          titleLineHeight: Number.parseFloat(getComputedStyle(title).lineHeight),
          contained: items.every((item) => {
            const bounds = item.getBoundingClientRect();
            return (
              bounds.left >= box.left &&
              bounds.right <= box.right &&
              item.scrollWidth <= item.clientWidth + 1
            );
          }),
        };
      });
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
      expect(dimensions.titleWidth).toBeGreaterThan(Math.min(width * 0.75, 300));
      expect(dimensions.titleHeight / dimensions.titleLineHeight).toBeLessThanOrEqual(5);
      expect(dimensions.contained).toBe(true);
      await expect(
        component.getByRole("button", { name: "Filter search to this session" }),
      ).toBeVisible();
      await expect(component.getByRole("link", { name: "Go to session" })).toBeVisible();
    });
  }

  test("native Space and Enter toggle once while Tab reaches independent actions", async ({
    mount,
    page,
  }) => {
    const component = await mount(SearchGroupedResultsHarness, { props: { width: 356 } });
    const toggle = component.locator(".session-group-toggle");
    const results = component.locator(".session-group-results");
    await toggle.focus();
    await expect(toggle).toBeFocused();
    const outline = await toggle.evaluate((button) => getComputedStyle(button).outlineStyle);
    expect(outline).toBe("solid");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(results).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(results).toBeVisible();
    await page.keyboard.press("Tab");
    const filter = component.getByRole("button", { name: "Filter search to this session" });
    await expect(filter).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(component.getByLabel("Filter count")).toHaveText("1");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(component.getByRole("link", { name: "Go to session" })).toBeFocused();
  });
});
