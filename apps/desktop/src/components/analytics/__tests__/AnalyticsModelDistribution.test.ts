import type { AnalyticsData } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { buildDashboardSummary } from "@/utils/analyticsSummary";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsModelMix from "../AnalyticsModelMix.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

function mountMix(modelDistribution: Entry[], allSources?: boolean) {
  const summary = buildDashboardSummary(
    { ...FIXTURE_ANALYTICS, modelDistribution },
    { computeUsageBasedCost: () => null, computeWholesaleCost: () => null },
  );
  return mount(AnalyticsModelMix, { props: { models: summary.models, allSources } });
}

function names(modelDistribution: Entry[]) {
  const wrapper = mountMix(modelDistribution);
  return wrapper.findAll(".ad-row .ad-row__name > span:last-child").map((el) => el.text());
}

describe("analytics model mix names", () => {
  it("names models the way the Models page does across sources", () => {
    expect(
      names([
        entry({ model: "claude-haiku-4.5", source: "copilot" }),
        entry({ model: "claude-haiku-4-5-20251001", source: "claudeCode" }),
        entry({ model: "claude-opus-5-5", source: "claudeCode" }),
        entry({ model: "gpt-5" }),
      ]),
    ).toEqual([
      "claude-haiku-4.5 · Copilot",
      "claude-haiku-4.5 · Claude Code",
      "claude-opus-5.5",
      "gpt-5",
    ]);
  });

  it("keeps Copilot-only model names unchanged", () => {
    expect(
      names([entry({ model: "claude-haiku-4.5", source: "copilot" }), entry({ model: "gpt-5" })]),
    ).toEqual(["claude-haiku-4.5", "gpt-5"]);
  });

  it("ranks models by tokens and folds the long tail into one row", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      entry({ model: `model-${i}`, inputTokens: (i + 1) * 100, outputTokens: 0 }),
    );
    const shown = names(many);
    expect(shown.slice(0, 2)).toEqual(["model-7", "model-6"]);
    expect(shown.at(-1)).toBe("2 more");
  });
});

describe("analytics model mix markers", () => {
  /** Each shown model row's marker: its source logo or a colour swatch. */
  function markers(modelDistribution: Entry[], allSources?: boolean) {
    return mountMix(modelDistribution, allSources)
      .findAll(".ad-row .ad-row__name")
      .filter((row) => !row.text().endsWith("more"))
      .map((row) =>
        row.find(".ad-source").exists() ? "logo" : row.find(".ad-sw").exists() ? "swatch" : "none",
      );
  }
  const copilotOnly = [entry({ model: "gpt-5" }), entry({ model: "claude-haiku-4.5" })];

  it("shows source logos with no provider filter, even when one source is present", () => {
    expect(markers(copilotOnly, true)).toEqual(["logo", "logo"]);
  });

  it("keeps colour swatches when one provider is selected", () => {
    expect(markers(copilotOnly, false)).toEqual(["swatch", "swatch"]);
  });

  it("shows logos for models from more than one source", () => {
    const mixed = [
      entry({ model: "gpt-5" }),
      entry({ model: "claude-opus-5-5", source: "claudeCode" }),
    ];
    expect(markers(mixed)).toEqual(["logo", "logo"]);
  });
});
