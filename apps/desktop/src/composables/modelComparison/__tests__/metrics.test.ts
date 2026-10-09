import { describe, expect, it, vi } from "vitest";
import {
  bestCostIndex,
  bestIdx,
  buildCompareMetrics,
  buildModelRows,
  crossSourcePair,
  formatNorm,
  formatRowCost,
  normalizeRows,
  rowCostSource,
} from "../metrics";
import { buildRowComparator, sortArrow, sortRows } from "../sorting";
import type { ModelDistributionEntry, ModelRow } from "../types";

const PALETTE = ["#aaa", "#bbb", "#ccc"] as const;

function row(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    model: "m",
    color: "#000",
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    percentage: 0,
    premiumRequests: 0,
    requestCount: 0,
    cacheHitRate: 0,
    cost: 0,
    copilotCost: 0,
    costUsd: null,
    costUsdPartial: false,
    source: "copilot",
    billedInAiCredits: true,
    usdEquivalent: null,
    ...overrides,
    id: overrides.id ?? overrides.model ?? "m",
    label: overrides.label ?? overrides.model ?? "m",
    family: overrides.family ?? overrides.model ?? "m",
    aiCredits: overrides.aiCredits ?? 0,
    aiCreditSource: overrides.aiCreditSource ?? "observed",
  };
}

describe("bestIdx", () => {
  it("returns -1 for empty input", () => {
    expect(bestIdx([])).toBe(-1);
    expect(bestIdx([], false)).toBe(-1);
  });

  it("picks the maximum index when higher=true", () => {
    expect(bestIdx([1, 5, 3, 4])).toBe(1);
  });

  it("picks the minimum index when higher=false", () => {
    expect(bestIdx([4, 5, 1, 3], false)).toBe(2);
  });

  it("resolves ties to the first occurrence", () => {
    expect(bestIdx([5, 5, 5])).toBe(0);
    expect(bestIdx([1, 1, 1], false)).toBe(0);
  });
});

describe("bestCostIndex", () => {
  it("returns -1 when every cost is null", () => {
    expect(bestCostIndex([row({ cost: null }), row({ cost: null })])).toBe(-1);
  });

  it("treats null costs as worst (Infinity)", () => {
    expect(bestCostIndex([row({ cost: null }), row({ cost: 5 }), row({ cost: 2 })])).toBe(2);
  });

  it("picks the cheapest row", () => {
    expect(bestCostIndex([row({ cost: 10 }), row({ cost: 4 }), row({ cost: 7 })])).toBe(1);
  });
});

describe("models priced per source", () => {
  const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, premiumRequests: 0 };
  const build = (distribution: ModelDistributionEntry[], price: number | null = 2) =>
    buildModelRows({
      distribution,
      computeWholesaleCost: () => price,
      costPerPremiumRequest: 0.04,
      palette: PALETTE,
    });

  it("prices a Claude Code model in USD, never in AI Credits", () => {
    const [priced, unpriced] = build([
      { model: "claude-opus-5-5", source: "claudeCode", costUsd: 1.5, ...usage },
      { model: "claude-next", source: "claudeCode", costUsd: null, ...usage },
    ]);
    expect(priced).toMatchObject({ aiCredits: null, billedInAiCredits: false, cost: 1.5 });
    expect(formatRowCost(priced)).toBe("$1.50 est.");
    expect(rowCostSource(priced)).toBe("USD estimate");
    // An unpriced model says so rather than claiming an estimate.
    expect(formatRowCost(unpriced)).toBe("—");
    expect(rowCostSource(unpriced)).toBe("Unpriced");
  });

  it("labels an unpriced Copilot model as unpriced, not estimated", () => {
    const [row] = build([{ model: "mystery", ...usage }], null);
    expect(row.aiCreditSource).toBe("unavailable");
    expect(rowCostSource(row)).toBe("Unpriced");
  });

  it("lines up a model used by two sources under one name", () => {
    const rows = build([
      { model: "claude-opus-4.6", source: "copilot", ...usage },
      { model: "claude-opus-4-6", source: "claudeCode", costUsd: 1, ...usage },
      { model: "claude-haiku-4-5-20251001", source: "claudeCode", costUsd: 1, ...usage },
      { model: "gpt-5", ...usage },
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "claude-opus-4.6 · Copilot",
      "claude-opus-4.6 · Claude Code",
      "claude-haiku-4.5",
      "gpt-5",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "copilot:claude-opus-4.6",
      "claudeCode:claude-opus-4-6",
      "claudeCode:claude-haiku-4-5-20251001",
      "copilot:gpt-5",
    ]);
    // The comparison opens on the same model across sources.
    expect(crossSourcePair(rows)).toEqual([
      "copilot:claude-opus-4.6",
      "claudeCode:claude-opus-4-6",
    ]);
    expect(crossSourcePair(rows.slice(2))).toBeNull();
  });

  it("keeps two ids of one family in one source apart", () => {
    const rows = build([
      { model: "claude-opus-4-6", source: "claudeCode", ...usage },
      { model: "claude-opus-4-6-20260101", source: "claudeCode", ...usage },
    ]);
    expect(rows.map((row) => row.label)).toEqual(["claude-opus-4-6", "claude-opus-4-6-20260101"]);
  });

  it("compares cost across sources without a delta", () => {
    const [copilot, claude, claudeToo] = build([
      { model: "claude-opus-4.6", source: "copilot", ...usage },
      { model: "claude-opus-5-5", source: "claudeCode", costUsd: 1, ...usage },
      { model: "claude-haiku-4-5", source: "claudeCode", costUsd: 2, ...usage },
    ]);
    const fmt = (value: number | null, isCost = false) => formatNorm(value, isCost, "raw");
    const crossSource = buildCompareMetrics(copilot, claude, fmt);
    // Premium-request cost is Copilot's alone: no $0 that reads as cheaper.
    expect(crossSource.find((m) => m.label === "Legacy Premium Cost")).toMatchObject({
      valueB: "—",
      delta: "—",
      better: "neutral",
    });
    expect(crossSource.find((m) => m.label === "Cost")).toMatchObject({
      valueB: "$1.00 est.",
      delta: "Different units",
      better: "neutral",
    });
    const sameSource = buildCompareMetrics(claude, claudeToo, fmt);
    expect(sameSource.find((m) => m.label === "Estimated Cost")).toMatchObject({
      valueA: "$1.00",
      valueB: "$2.00",
      better: "a",
    });
  });
});

describe("buildModelRows", () => {
  const distribution: ModelDistributionEntry[] = [
    {
      model: "gpt-4",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
      premiumRequests: 2,
    },
    {
      model: "gpt-5",
      inputTokens: 3000,
      outputTokens: 500,
      cacheReadTokens: 300,
      premiumRequests: 5,
    },
  ];

  it("derives tokens/percentage/cacheHitRate per row", () => {
    const rows = buildModelRows({
      distribution,
      computeWholesaleCost: () => 1.23,
      costPerPremiumRequest: 0.04,
      palette: PALETTE,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].tokens).toBe(1500);
    // grand total = 1500 + 3500 = 5000 → gpt-4 share = 30%
    expect(rows[0].percentage).toBeCloseTo(30);
    // 200/1000 = 20%
    expect(rows[0].cacheHitRate).toBeCloseTo(20);
    // copilotCost = 2 * 0.04
    expect(rows[0].copilotCost).toBeCloseTo(0.08);
    expect(rows[0].cost).toBe(1.23);
    // Colours follow token rank: the 3,500-token row is first.
    expect(rows[0].color).toBe(PALETTE[1]);
    expect(rows[1].color).toBe(PALETTE[0]);
  });

  it("forwards cacheWriteTokens (defaulting to 0) into computeWholesaleCost", () => {
    const compute = vi.fn().mockReturnValue(0);
    buildModelRows({
      distribution,
      computeWholesaleCost: compute,
      computeUsageBasedCost: () => 0,
      costPerPremiumRequest: 0.04,
      palette: PALETTE,
    });
    expect(compute).toHaveBeenNthCalledWith(1, "gpt-4", 1000, 200, 500, 50);
    expect(compute).toHaveBeenNthCalledWith(2, "gpt-5", 3000, 300, 500, 0);
  });

  it("returns empty array and zero percentage when distribution is empty", () => {
    const rows = buildModelRows({
      distribution: [],
      computeWholesaleCost: () => 0,
      costPerPremiumRequest: 0.04,
      palette: PALETTE,
    });
    expect(rows).toEqual([]);
  });

  it("falls back to 0 percentage when grand total is zero", () => {
    const rows = buildModelRows({
      distribution: [
        {
          model: "empty",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          premiumRequests: 1,
        },
      ],
      computeWholesaleCost: () => 0,
      costPerPremiumRequest: 0.04,
      palette: PALETTE,
    });
    expect(rows[0].percentage).toBe(0);
    expect(rows[0].cacheHitRate).toBe(0);
  });
});

describe("normalizeRows", () => {
  const rows: ModelRow[] = [
    row({
      model: "a",
      tokens: 1_000_000,
      inputTokens: 600_000,
      outputTokens: 400_000,
      cacheReadTokens: 100_000,
      premiumRequests: 10,
      cost: 5,
      copilotCost: 0.4,
    }),
    row({
      model: "b",
      tokens: 3_000_000,
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 200_000,
      premiumRequests: 30,
      cost: 15,
      copilotCost: 1.2,
    }),
  ];

  it("returns a shallow copy in raw mode", () => {
    const out = normalizeRows(rows, "raw");
    expect(out).not.toBe(rows);
    expect(out).toEqual(rows);
  });

  it("share mode rebases each volumetric field to a percentage of the group total", () => {
    const out = normalizeRows(rows, "share");
    expect(out[0].tokens).toBeCloseTo(25);
    expect(out[1].tokens).toBeCloseTo(75);
    expect(out[0].cost).toBeCloseTo(25);
    expect(out[1].cost).toBeCloseTo(75);
    expect(out[0].copilotCost + out[1].copilotCost).toBeCloseTo(100);
  });

  it("per-10m-tokens scales volumetric fields by tokens / 10M (null cost preserved)", () => {
    const out = normalizeRows(
      [row({ tokens: 5_000_000, cost: null, copilotCost: 1 })],
      "per-10m-tokens",
    );
    // divisor = 0.5 → tokens stretches to 10M
    expect(out[0].tokens).toBeCloseTo(10_000_000);
    expect(out[0].cost).toBeNull();
    expect(out[0].copilotCost).toBeCloseTo(2);
  });

  it("share mode safely handles zero totals", () => {
    const empties: ModelRow[] = [row({ model: "x" }), row({ model: "y" })];
    const out = normalizeRows(empties, "share");
    expect(out[0].tokens).toBe(0);
    expect(out[0].cost).toBe(0);
  });
});

describe("formatNorm", () => {
  it("returns em-dash for null", () => {
    expect(formatNorm(null, false, "raw")).toBe("—");
  });

  it("formats share mode as percentage regardless of isCost", () => {
    expect(formatNorm(42.555, false, "share")).toBe("42.6%");
    expect(formatNorm(42.555, true, "share")).toBe("42.6%");
  });

  it("per-10m-tokens prints integers without decimals and small floats with one decimal", () => {
    expect(formatNorm(10, false, "per-10m-tokens")).toBe("10");
    expect(formatNorm(10.5, false, "per-10m-tokens")).toBe("10.5");
  });
});

describe("buildModelRows colours and cost", () => {
  it("assigns palette colours by token rank and a tail colour past the palette", () => {
    const rows = buildModelRows({
      distribution: [
        {
          model: "small",
          inputTokens: 10,
          outputTokens: 0,
          cacheReadTokens: 0,
          premiumRequests: 0,
        },
        {
          model: "big",
          inputTokens: 1000,
          outputTokens: 0,
          cacheReadTokens: 0,
          premiumRequests: 0,
        },
        { model: "mid", inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, premiumRequests: 0 },
        { model: "tiny", inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, premiumRequests: 0 },
      ],
      computeWholesaleCost: () => null,
      costPerPremiumRequest: 0,
      palette: PALETTE,
      tailColor: "tail",
    });
    const color = (model: string) => rows.find((r) => r.model === model)?.color;
    expect(color("big")).toBe(PALETTE[0]);
    expect(color("mid")).toBe(PALETTE[1]);
    expect(color("small")).toBe(PALETTE[2]);
    expect(color("tiny")).toBe("tail");
  });

  it("prices AI Credits and provider USD on one USD-equivalent scale", () => {
    const rows = buildModelRows({
      distribution: [
        {
          model: "gpt",
          inputTokens: 10,
          outputTokens: 0,
          cacheReadTokens: 0,
          premiumRequests: 0,
          totalNanoAiu: 250_000_000_000,
          requestCount: 4,
        },
        {
          model: "claude-opus-4-6",
          source: "claudeCode",
          costUsd: 1.5,
          inputTokens: 10,
          outputTokens: 0,
          cacheReadTokens: 0,
          premiumRequests: 0,
        },
      ],
      computeWholesaleCost: () => null,
      costPerPremiumRequest: 0,
      palette: PALETTE,
    });
    expect(rows[0].requestCount).toBe(4);
    expect(rows[0].usdEquivalent).toBeCloseTo((rows[0].aiCredits ?? 0) * 0.01);
    expect(rows[1].usdEquivalent).toBe(1.5);
    expect(rows[1].requestCount).toBe(0);
  });
});

describe("buildCompareMetrics", () => {
  it("returns AIC-first rows with delta/direction/better fields populated", () => {
    const a = row({ model: "a", tokens: 1000, percentage: 40, cost: 1, copilotCost: 0.2 });
    const b = row({ model: "b", tokens: 2000, percentage: 60, cost: 2, copilotCost: 0.4 });
    const metrics = buildCompareMetrics(a, b, (v) => (v == null ? "—" : String(v)));
    expect(metrics).toHaveLength(8);
    expect(metrics.map((m) => m.label)).toEqual([
      "Total Tokens",
      "Input Tokens",
      "Output Tokens",
      "Cache Read",
      "Token Share",
      "AI Credits",
      "Cache Hit Rate",
      "Legacy Premium Cost",
    ]);
    for (const m of metrics) {
      expect(typeof m.delta).toBe("string");
      expect(["up", "down", "neutral"]).toContain(m.direction);
      expect(["a", "b", "neutral"]).toContain(m.better);
    }
  });

  it("returns empty array when either side is missing", () => {
    expect(buildCompareMetrics(undefined, row(), () => "")).toEqual([]);
    expect(buildCompareMetrics(row(), undefined, () => "")).toEqual([]);
  });
});

describe("sortRows / buildRowComparator", () => {
  const rows: ModelRow[] = [
    row({ model: "alpha", tokens: 100, cost: 5 }),
    row({ model: "beta", tokens: 300, cost: null }),
    row({ model: "gamma", tokens: 200, cost: 2 }),
  ];

  it("sorts by model lexicographically", () => {
    expect(sortRows(rows, "model", "asc").map((r) => r.model)).toEqual(["alpha", "beta", "gamma"]);
    expect(sortRows(rows, "model", "desc").map((r) => r.model)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("sorts numeric columns by direction", () => {
    expect(sortRows(rows, "tokens", "asc").map((r) => r.tokens)).toEqual([100, 200, 300]);
    expect(sortRows(rows, "tokens", "desc").map((r) => r.tokens)).toEqual([300, 200, 100]);
  });

  it("pushes null costs to the end regardless of direction", () => {
    expect(sortRows(rows, "cost", "asc").map((r) => r.model)).toEqual(["gamma", "alpha", "beta"]);
    expect(sortRows(rows, "cost", "desc").map((r) => r.model)).toEqual(["alpha", "gamma", "beta"]);
  });

  it("sorts the cost column within each unit, AI Credits first", () => {
    const mixed: ModelRow[] = [
      row({ model: "usd-cheap", aiCredits: null, billedInAiCredits: false, costUsd: 1 }),
      row({ model: "aic-big", aiCredits: 9 }),
      row({ model: "usd-unpriced", aiCredits: null, billedInAiCredits: false, costUsd: null }),
      row({ model: "usd-dear", aiCredits: null, billedInAiCredits: false, costUsd: 30 }),
      row({ model: "aic-small", aiCredits: 2 }),
    ];
    expect(sortRows(mixed, "aiCredits", "desc").map((r) => r.model)).toEqual([
      "aic-big",
      "aic-small",
      "usd-dear",
      "usd-cheap",
      "usd-unpriced",
    ]);
    expect(sortRows(mixed, "aiCredits", "asc").map((r) => r.model)).toEqual([
      "aic-small",
      "aic-big",
      "usd-cheap",
      "usd-dear",
      "usd-unpriced",
    ]);
  });

  it("does not mutate input", () => {
    const before = rows.map((r) => r.model);
    sortRows(rows, "tokens", "asc");
    expect(rows.map((r) => r.model)).toEqual(before);
  });

  it("buildRowComparator exposes the raw comparator function", () => {
    const cmp = buildRowComparator("tokens", "asc");
    expect(cmp(rows[0], rows[1])).toBeLessThan(0);
  });
});

describe("sortArrow", () => {
  it("returns ⇅ when the column is not the active key", () => {
    expect(sortArrow("tokens", "asc", "model")).toBe("⇅");
  });

  it("returns ↑/↓ for the active key", () => {
    expect(sortArrow("tokens", "asc", "tokens")).toBe("↑");
    expect(sortArrow("tokens", "desc", "tokens")).toBe("↓");
  });
});
