import { describe, expect, it } from "vitest";
import { buildRowComparator, sortArrow, sortRows } from "../sorting";
import type { ModelRow } from "../types";

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

  it("sorts the cost column by API-equivalent USD, so units interleave by spend", () => {
    const usd = (model: string, costUsd: number | null) =>
      row({ model, aiCredits: null, billedInAiCredits: false, costUsd, usdEquivalent: costUsd });
    const aic = (model: string, aiCredits: number) =>
      row({ model, aiCredits, usdEquivalent: aiCredits * 0.01 });
    const mixed: ModelRow[] = [
      usd("usd-cheap", 0.5),
      aic("aic-big", 900),
      usd("usd-unpriced", null),
      usd("usd-dear", 30),
      aic("aic-small", 2),
    ];
    expect(sortRows(mixed, "aiCredits", "desc").map((r) => r.model)).toEqual([
      "usd-dear",
      "aic-big",
      "usd-cheap",
      "aic-small",
      "usd-unpriced",
    ]);
    expect(sortRows(mixed, "aiCredits", "asc").map((r) => r.model)).toEqual([
      "aic-small",
      "usd-cheap",
      "aic-big",
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
