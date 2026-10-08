import type { ShutdownMetrics } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { formatSessionCost, sessionCostEstimate, sourceTokenUsd } from "@/utils/sourceCost";

const snapshotCost = { amount: 0.42, unit: "usd" as const, basis: "providerEstimate" as const };

function claude(metrics: Partial<ShutdownMetrics>, coverage: Partial<ShutdownMetrics["coverage"]>) {
  return sessionCostEstimate("claudeCode", {
    ...metrics,
    coverage: { partial: true, snapshotLine: null, recordedCalls: 0, tailCalls: 0, ...coverage },
  });
}

describe("sessionCostEstimate", () => {
  it("labels a snapshot-only total as Claude Code's own estimate, not partial", () => {
    const cost = claude(
      { costAmount: 0.42, costUnit: "usd", costBasis: "providerEstimate" },
      { snapshotLine: 90, recordedCalls: 4, snapshotCost },
    );
    expect(cost).toMatchObject({
      amount: 0.42,
      basisLabel: "Claude Code estimate",
      partial: false,
    });
    expect(cost.coverage).toBe("From the session's last cost snapshot.");
    expect(formatSessionCost(cost)).toBe("$0.42");
  });

  it("labels a snapshot plus priced tail as a partial TracePilot estimate", () => {
    const cost = claude(
      { costAmount: 0.5, costUnit: "usd", costBasis: "tracepilotEstimate" },
      { snapshotLine: 9, recordedCalls: 2, tailCalls: 1, snapshotCost },
    );
    expect(cost).toMatchObject({ basisLabel: "TracePilot estimate", partial: true });
    expect(cost.coverage).toBe("Last cost snapshot plus 1 later call at API rates.");
  });

  it("keeps the snapshot as a lower bound when the tail cannot be priced", () => {
    const cost = claude({}, { snapshotLine: 9, recordedCalls: 3, tailCalls: 2, snapshotCost });
    expect(cost).toMatchObject({ amount: null, snapshotAmount: 0.42, basisLabel: "Unavailable" });
    expect(cost.coverage).toBe("2 calls after the last cost snapshot could not be priced.");
    expect(formatSessionCost(cost)).toBe("≥ $0.42");
  });

  it("describes recorded calls without a snapshot, priced or not", () => {
    const priced = claude(
      { costAmount: 0.0003, costUnit: "usd", costBasis: "tracepilotEstimate" },
      { recordedCalls: 1, tailCalls: 1 },
    );
    expect(priced.coverage).toBe("1 recorded call at API rates; no cost snapshot.");
    expect(priced.partial).toBe(true);
    expect(formatSessionCost(priced)).toBe("< $0.01");
    const unpriced = claude({}, { recordedCalls: 1, tailCalls: 1 });
    expect(unpriced.coverage).toBe("No cost snapshot, and the recorded calls could not be priced.");
    expect(formatSessionCost(unpriced)).toBe("—");
  });

  it("never reads an AI Credit figure as USD", () => {
    const cost = sessionCostEstimate("claudeCode", {
      costAmount: 3,
      costUnit: "aic",
      costBasis: "billed",
    });
    expect(cost.amount).toBeNull();
    expect(formatSessionCost(cost)).toBe("—");
  });
});

describe("sourceTokenUsd", () => {
  it("prices Claude Code usage at its API rates and nothing for Copilot", () => {
    const usage = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 0 };
    expect(sourceTokenUsd("claudeCode", "claude-opus-4-6", usage)).toBeGreaterThan(0);
    expect(sourceTokenUsd("claudeCode", "not-a-model", usage)).toBeNull();
    expect(sourceTokenUsd("copilot", "claude-opus-4-6", usage)).toBeNull();
  });
});
