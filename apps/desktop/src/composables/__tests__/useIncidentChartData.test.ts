import { createChartLayout } from "@tracepilot/ui";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import type { ActivityPoint, IncidentPoint } from "../useIncidentChartData";
import { useIncidentChartData } from "../useIncidentChartData";

const layout = createChartLayout(55, 490, 20, 175);

function makeIncidents(count: number): IncidentPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, "0")}`,
    errors: (i + 1) * 2,
    rateLimits: i + 1,
    compactions: i,
    truncations: i > 0 ? 1 : 0,
  }));
}

function makeActivity(count: number): ActivityPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, "0")}`,
    count: (i + 1) * 3,
  }));
}

describe("useIncidentChartData", () => {
  describe("chartData", () => {
    it("returns null when incidents is null", () => {
      const { chartData } = useIncidentChartData({
        incidents: ref(null),
        activity: ref(null),
        normalize: ref(false),
        layout,
      });
      expect(chartData.value).toBeNull();
    });

    it("returns null when incidents is empty", () => {
      const { chartData } = useIncidentChartData({
        incidents: ref([]),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      expect(chartData.value).toBeNull();
    });

    it("computes bars for valid data", () => {
      const { chartData } = useIncidentChartData({
        incidents: ref(makeIncidents(5)),
        activity: ref(makeActivity(5)),
        normalize: ref(false),
        layout,
      });
      const result = chartData.value;
      expect(result).not.toBeNull();
      expect(result?.bars).toHaveLength(5);
      expect(result?.yLabels.length).toBeGreaterThan(0);
      expect(result?.xLabels.length).toBeGreaterThan(0);
      expect(result?.barW).toBeGreaterThanOrEqual(4);
      expect(result?.barW).toBeLessThanOrEqual(18);
    });

    it("stacks bars from bottom: truncations, compactions, errors, rate limits", () => {
      const { chartData } = useIncidentChartData({
        incidents: ref(makeIncidents(3)),
        activity: ref(makeActivity(3)),
        normalize: ref(false),
        layout,
      });
      const bar = chartData.value?.bars[2]; // third bar has all incident types
      // truncRect is at the bottom (highest y), rlRect is at the top (lowest y)
      expect(bar.truncRect.y).toBeGreaterThanOrEqual(bar.compRect.y);
      expect(bar.compRect.y).toBeGreaterThanOrEqual(bar.otherRect.y);
      expect(bar.otherRect.y).toBeGreaterThanOrEqual(bar.rlRect.y);
    });

    it("computes otherErrors = errors - rateLimits", () => {
      const { chartData } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-01", errors: 10, rateLimits: 3, compactions: 0, truncations: 0 },
        ]),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      expect(chartData.value?.bars[0].rawOtherErrors).toBe(7);
    });

    it("clamps otherErrors to zero when rateLimits > errors", () => {
      const { chartData } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-01", errors: 2, rateLimits: 5, compactions: 0, truncations: 0 },
        ]),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      expect(chartData.value?.bars[0].rawOtherErrors).toBe(0);
    });

    it("normalizes by session count when normalize is true", () => {
      const incidents = [
        { date: "2025-01-01", errors: 10, rateLimits: 4, compactions: 2, truncations: 1 },
      ];
      const activity = [{ date: "2025-01-01", count: 5 }];

      const { chartData } = useIncidentChartData({
        incidents: ref(incidents),
        activity: ref(activity),
        normalize: ref(true),
        layout,
      });
      const bar = chartData.value?.bars[0];
      expect(bar.rateLimits).toBeCloseTo(4 / 5);
      expect(bar.otherErrors).toBeCloseTo(6 / 5);
      expect(bar.compactions).toBeCloseTo(2 / 5);
      expect(bar.truncations).toBeCloseTo(1 / 5);
      // Raw values should be unaffected
      expect(bar.rawRateLimits).toBe(4);
      expect(bar.rawOtherErrors).toBe(6);
    });

    it("uses 1 as denominator when activity has no entry for a date", () => {
      const incidents = [
        { date: "2025-01-01", errors: 8, rateLimits: 2, compactions: 1, truncations: 0 },
      ];
      const { chartData } = useIncidentChartData({
        incidents: ref(incidents),
        activity: ref([]),
        normalize: ref(true),
        layout,
      });
      const bar = chartData.value?.bars[0];
      // With no activity, denominator is 1, so values are unchanged
      expect(bar.rateLimits).toBe(2);
      expect(bar.otherErrors).toBe(6);
    });

    it("handles all-zero incident values", () => {
      const incidents = [
        { date: "2025-01-01", errors: 0, rateLimits: 0, compactions: 0, truncations: 0 },
        { date: "2025-01-02", errors: 0, rateLimits: 0, compactions: 0, truncations: 0 },
      ];
      const { chartData } = useIncidentChartData({
        incidents: ref(incidents),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      expect(chartData.value).not.toBeNull();
      // maxVal should be the floor of 0.5
      expect(chartData.value?.maxVal).toBe(0.5);
      // All bar heights should be zero
      expect(chartData.value?.bars[0].total).toBe(0);
    });
  });

  describe("gridLines", () => {
    it("returns empty array when chartData is null", () => {
      const { gridLines } = useIncidentChartData({
        incidents: ref(null),
        activity: ref(null),
        normalize: ref(false),
        layout,
      });
      expect(gridLines.value).toEqual([]);
    });

    it("returns Y positions from yLabels", () => {
      const { gridLines, chartData } = useIncidentChartData({
        incidents: ref(makeIncidents(3)),
        activity: ref(makeActivity(3)),
        normalize: ref(false),
        layout,
      });
      expect(gridLines.value).toHaveLength(chartData.value?.yLabels.length);
    });
  });

  describe("formatTooltip", () => {
    it("formats raw tooltip with pluralized labels", () => {
      const { chartData, formatTooltip } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-15", errors: 5, rateLimits: 2, compactions: 3, truncations: 1 },
        ]),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      const text = formatTooltip(chartData.value?.bars[0]);
      expect(text).toContain("2 rate limits");
      expect(text).toContain("3 errors");
      expect(text).toContain("3 compactions");
      expect(text).toContain("1 truncation");
      // singular truncation (no trailing 's')
      expect(text).not.toContain("truncations");
    });

    it("formats singular labels correctly", () => {
      const { chartData, formatTooltip } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-15", errors: 1, rateLimits: 1, compactions: 1, truncations: 1 },
        ]),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      const text = formatTooltip(chartData.value?.bars[0]);
      expect(text).toContain("1 rate limit");
      expect(text).not.toMatch(/1 rate limits/);
      expect(text).toContain("1 compaction");
      expect(text).not.toMatch(/1 compactions/);
      expect(text).toContain("1 truncation");
      expect(text).not.toMatch(/1 truncations/);
    });

    it("formats normalized tooltip with per-session units", () => {
      const normalize = ref(true);
      const { chartData, formatTooltip } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-15", errors: 10, rateLimits: 4, compactions: 2, truncations: 1 },
        ]),
        activity: ref([{ date: "2025-01-15", count: 5 }]),
        normalize,
        layout,
      });
      const text = formatTooltip(chartData.value?.bars[0]);
      expect(text).toContain("rate limits/session");
      expect(text).toContain("errors/session");
      expect(text).toContain("compactions/session");
      expect(text).toContain("truncations/session");
    });

    it('shows "no incidents" for zero-incident bar', () => {
      const { chartData, formatTooltip } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-15", errors: 0, rateLimits: 0, compactions: 0, truncations: 0 },
        ]),
        activity: ref([]),
        normalize: ref(false),
        layout,
      });
      const text = formatTooltip(chartData.value?.bars[0]);
      expect(text).toContain("no incidents");
    });

    it('shows "no incidents" in normalized mode for zero-incident bar', () => {
      const { chartData, formatTooltip } = useIncidentChartData({
        incidents: ref([
          { date: "2025-01-15", errors: 0, rateLimits: 0, compactions: 0, truncations: 0 },
        ]),
        activity: ref([{ date: "2025-01-15", count: 10 }]),
        normalize: ref(true),
        layout,
      });
      const text = formatTooltip(chartData.value?.bars[0]);
      expect(text).toContain("no incidents");
    });
  });
});
