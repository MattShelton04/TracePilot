import { setupPinia } from "@tracepilot/test-utils";
import type { AnalyticsData } from "@tracepilot/types";
import { createChartLayout } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsDistributionRow from "../AnalyticsDistributionRow.vue";

beforeEach(() => setupPinia());

type Entry = AnalyticsData["modelDistribution"][number];

function entry(overrides: Partial<Entry> & Pick<Entry, "model">): Entry {
  return {
    tokens: 1_000,
    percentage: 25,
    inputTokens: 500,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    premiumRequests: 0,
    requestCount: 10,
    ...overrides,
  };
}

function legend(modelDistribution: Entry[]) {
  const wrapper = mount(AnalyticsDistributionRow, {
    props: {
      data: { ...FIXTURE_ANALYTICS, modelDistribution },
      chartLayout: createChartLayout(55, 490, 20, 175),
      gridLines: [],
      timeRangeLabel: "all time",
      tooltip: {
        visible: false,
        pinned: false,
        x: 0,
        y: 0,
        content: "",
        chartId: "",
        highlightIndex: -1,
      },
      onChartMouseMove: vi.fn(),
      onChartClick: vi.fn(),
      dismissTooltip: vi.fn(),
    },
    global: { stubs: { RouterLink: true } },
  });
  return wrapper.findAll(".donut-legend-model");
}

describe("analytics model distribution names", () => {
  it("names models the way the Models page does across sources", () => {
    const items = legend([
      entry({ model: "claude-haiku-4.5", source: "copilot" }),
      entry({ model: "claude-haiku-4-5-20251001", source: "claudeCode" }),
      entry({ model: "claude-opus-5-5", source: "claudeCode" }),
      entry({ model: "gpt-5" }),
    ]);
    expect(items.map((item) => item.text())).toEqual([
      "claude-haiku-4.5 · Copilot",
      "claude-haiku-4.5 · Claude Code",
      "claude-opus-5.5",
      "gpt-5",
    ]);
    // The hover keeps the source and the raw id when the legend truncates.
    expect(items[1].attributes("title")).toBe(
      "claude-haiku-4.5 · Claude Code (claude-haiku-4-5-20251001)",
    );
    expect(items[3].attributes("title")).toBe("gpt-5");
  });

  it("keeps Copilot-only model names unchanged", () => {
    const items = legend([
      entry({ model: "claude-haiku-4.5", source: "copilot" }),
      entry({ model: "gpt-5" }),
    ]);
    expect(items.map((item) => item.text())).toEqual(["claude-haiku-4.5", "gpt-5"]);
  });
});
