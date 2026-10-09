import { describe, expect, it } from "vitest";
import {
  buildMixSeries,
  buildShareShift,
  decadeDomain,
  logScale,
  logTicks,
  modelProfile,
  niceLinearTicks,
  niceLogDomain,
  OTHERS_KEY,
  placeLabels,
  profilePopulation,
  rankProfiles,
  spreadLabels,
} from "../charts";
import type { ModelRow } from "../types";

function row(overrides: Partial<ModelRow> & { id: string }): ModelRow {
  return {
    model: overrides.id.split(":").pop() ?? overrides.id,
    label: overrides.id,
    family: overrides.id,
    source: "copilot",
    billedInAiCredits: true,
    color: "#000",
    tokens: 1000,
    inputTokens: 900,
    outputTokens: 100,
    cacheReadTokens: 450,
    cacheWriteTokens: 0,
    percentage: 10,
    premiumRequests: 0,
    requestCount: 10,
    cacheHitRate: 50,
    aiCredits: 100,
    aiCreditSource: "observed",
    cost: null,
    copilotCost: 0,
    costUsd: null,
    costUsdPartial: false,
    usdEquivalent: 1,
    ...overrides,
  };
}

describe("scales and ticks", () => {
  it("maps a log domain either way round", () => {
    const up = logScale([1, 100], [0, 100]);
    expect(up(10)).toBeCloseTo(50);
    const flipped = logScale([1, 0.01], [100, 0]);
    expect(flipped(0.1)).toBeCloseTo(50);
    // Non-positive values sit just outside the domain instead of at -Infinity.
    expect(Number.isFinite(up(0))).toBe(true);
  });

  it("snaps log domains to whole decades or 1-2-5 steps", () => {
    expect(decadeDomain([3e4, 4.2e9])).toEqual([1e4, 1e10]);
    expect(decadeDomain([5, 6], 2)).toEqual([1, 100]);
    expect(niceLogDomain([0.096, 1.94])).toEqual([0.05, 2]);
  });

  it("picks the densest log ticks that fit", () => {
    expect(logTicks([0.05, 2])).toEqual([0.05, 0.1, 0.2, 0.5, 1, 2]);
    expect(logTicks([1e3, 1e10], 5).length).toBeLessThanOrEqual(5);
  });

  it("rounds linear axes up to a nice step", () => {
    expect(niceLinearTicks(1.62)).toEqual({ max: 2, ticks: [0, 0.5, 1, 1.5, 2] });
  });
});

describe("profiles", () => {
  it("derives rate, cache hit, context and output share", () => {
    const p = modelProfile(row({ id: "a", tokens: 2_000_000, usdEquivalent: 4, requestCount: 20 }));
    expect(p.rate).toBeCloseTo(2);
    expect(p.cacheHit).toBeCloseTo(0.5);
    expect(p.contextPerRequest).toBe(100_000);
    expect(p.outputShare).toBeCloseTo(0.00005);
    expect(modelProfile(row({ id: "b", usdEquivalent: null })).rate).toBeNull();
  });

  it("ranks the population, cheapest outermost on the cost axis", () => {
    const profiles = [
      row({ id: "cheap", tokens: 1000, usdEquivalent: 1 }),
      row({ id: "pricey", tokens: 3000, usdEquivalent: 30 }),
      row({ id: "free", tokens: 2000, usdEquivalent: null }),
    ].map(modelProfile);
    const ranks = rankProfiles(profiles);
    const [volume, rate] = [0, 1];
    expect(ranks.get("pricey")?.[volume]).toMatchObject({ place: 1, of: 3, position: 1 });
    expect(ranks.get("cheap")?.[rate]).toMatchObject({ place: 1, of: 2, position: 1 });
    expect(ranks.get("free")?.[rate]).toBeNull();
  });

  it("leaves models under 0.1% of tokens out of the ranked population", () => {
    const rows = [
      row({ id: "a", percentage: 60 }),
      row({ id: "b", percentage: 30 }),
      row({ id: "c", percentage: 9.95 }),
      row({ id: "tiny", percentage: 0.05 }),
    ];
    expect(profilePopulation(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("label placement", () => {
  it("keeps labels apart and inside the bounds", () => {
    const marks = [
      { x: 50, y: 50, r: 5, text: "alpha" },
      { x: 52, y: 52, r: 5, text: "beta" },
    ];
    const placed = placeLabels(marks, { x: 0, y: 0, w: 200, h: 100 });
    expect(placed).toHaveLength(2);
    expect(placed[0].y).not.toBe(placed[1].y);
  });

  it("drops a label that fits nowhere", () => {
    const placed = placeLabels([{ x: 5, y: 5, r: 4, text: "a very long label" }], {
      x: 0,
      y: 0,
      w: 20,
      h: 20,
    });
    expect(placed).toHaveLength(0);
  });

  it("spreads stacked labels by a minimum gap", () => {
    expect(spreadLabels([10, 11, 50], 13)).toEqual([10, 23, 50]);
  });
});

describe("buildShareShift", () => {
  it("compares token and spend shares over priced models only", () => {
    const groups = buildShareShift(
      [
        row({ id: "a", tokens: 600, usdEquivalent: 2, color: "#a" }),
        row({ id: "b", tokens: 300, usdEquivalent: 6, color: "#b", billedInAiCredits: false }),
        row({ id: "c", tokens: 100, usdEquivalent: 2, color: "#c" }),
        row({ id: "unpriced", tokens: 5000, usdEquivalent: null }),
      ],
      1,
      "tail",
    );
    expect(groups.map((g) => g.id)).toEqual(["a", "__others"]);
    expect(groups[0]).toMatchObject({ tokenShare: 0.6, spendShare: 0.2 });
    expect(groups[1]).toMatchObject({ label: "2 others", color: "tail", spendShare: 0.8 });
    expect(groups[1].members?.map((m) => m.id)).toEqual(["b", "c"]);
  });
});

describe("buildMixSeries", () => {
  const rows = [
    row({ id: "copilot:a", tokens: 300, usdEquivalent: 3 }),
    row({ id: "copilot:b", tokens: 100, usdEquivalent: 10 }),
  ];
  const day = (date: string, model: string, tokens: number) => ({
    date,
    model,
    inputTokens: tokens,
    outputTokens: 0,
  });

  it("buckets short spans by day and fills empty days", () => {
    const series = buildMixSeries(
      [day("2026-10-01", "a", 100), day("2026-10-03", "a", 200), day("2026-10-03", "b", 100)],
      rows,
      { measure: "tokens", named: ["copilot:a"] },
    );
    expect(series.granularity).toBe("day");
    expect(series.buckets.map((b) => b.start)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(series.buckets[2].values).toEqual({ "copilot:a": 200, [OTHERS_KEY]: 100 });
  });

  it("buckets long spans by Monday-start week", () => {
    const series = buildMixSeries([day("2026-08-05", "a", 1), day("2026-10-08", "a", 1)], rows, {
      measure: "tokens",
      named: ["copilot:a"],
    });
    expect(series.granularity).toBe("week");
    expect(series.buckets[0].start).toBe("2026-08-03");
    expect(series.buckets.at(-1)?.start).toBe("2026-10-05");
  });

  it("spreads each model's spend over its days by tokens", () => {
    const series = buildMixSeries(
      [day("2026-10-01", "a", 100), day("2026-10-02", "a", 200), day("2026-10-02", "b", 100)],
      rows,
      { measure: "spend", named: ["copilot:a", "copilot:b"] },
    );
    expect(series.buckets[0].values["copilot:a"]).toBeCloseTo(1);
    expect(series.buckets[1].values["copilot:a"]).toBeCloseTo(2);
    expect(series.buckets[1].values["copilot:b"]).toBeCloseTo(10);
  });

  it("skips usage for models filtered off the page", () => {
    const series = buildMixSeries([day("2026-10-01", "gone", 50)], rows, {
      measure: "tokens",
      named: [],
    });
    expect(series.buckets[0].total).toBe(0);
  });
});
