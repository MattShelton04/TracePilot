import { expect, test } from "@playwright/experimental-ct-vue";
import { FIXTURE_ANALYTICS } from "../../../apps/desktop/src/__tests__/views/analyticsFixtures";
import AnalyticsMetricPanels from "../../../apps/desktop/src/components/analytics/AnalyticsMetricPanels.vue";

// Run from packages/ui: pnpm exec playwright test -c playwright-desktop-ct.config.ts
// Kept outside UI/src for desktop imports; .ct.ts also avoids jsdom test discovery.

test.describe("Analytics metric panel layout", () => {
  for (const width of [280, 480, 760]) {
    test(`keeps values and labels inside ${width}px panels`, async ({ mount }) => {
      const data = structuredClone(FIXTURE_ANALYTICS);
      data.productivityMetrics.avgTokensPerTurn = 896.1805555555555;
      data.productivityMetrics.avgTokensPerApiSecond = 150.58343057176197;
      data.apiDurationStats.totalSessionsWithDuration = 123_456_789;
      const component = await mount(AnalyticsMetricPanels, { props: { data } });
      await component.evaluate((root, panelWidth) => {
        // Match the desktop's two-column parent without depending on global app CSS.
        root.style.display = "grid";
        root.style.gridTemplateColumns = "repeat(2, 1fr)";
        root.style.gap = "14px";
        root.style.width = `${panelWidth * 2 + 14}px`;
      }, width);
      const geometry = await component.evaluate((root) => ({
        rootWidth: root.clientWidth,
        rootScrollWidth: root.scrollWidth,
        grids: [...root.querySelectorAll<HTMLElement>(".metric-grid")].map((grid) => ({
          width: grid.getBoundingClientRect().width,
          scrollWidth: grid.scrollWidth,
          clientWidth: grid.clientWidth,
          cells: [...grid.querySelectorAll<HTMLElement>(".metric-item")].map((item) => {
            const value = item.querySelector<HTMLElement>(".metric-value");
            const label = item.querySelector<HTMLElement>(".metric-label");
            if (!value || !label) {
              throw new Error("Metric items must contain a value and label before measuring.");
            }
            const box = item.getBoundingClientRect();
            return {
              width: box.width,
              valueWithin:
                value.getBoundingClientRect().left >= box.left - 1 &&
                value.getBoundingClientRect().right <= box.right + 1,
              labelWithin:
                label.getBoundingClientRect().left >= box.left - 1 &&
                label.getBoundingClientRect().right <= box.right + 1,
            };
          }),
        })),
      }));
      expect(geometry.rootScrollWidth).toBeLessThanOrEqual(geometry.rootWidth + 1);
      for (const grid of geometry.grids) {
        expect(grid.width).toBeLessThanOrEqual(width + 1);
        expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 1);
        expect(
          grid.cells.every((cell) => cell.width >= 100 && cell.valueWithin && cell.labelWithin),
        ).toBe(true);
      }
    });
  }
});
