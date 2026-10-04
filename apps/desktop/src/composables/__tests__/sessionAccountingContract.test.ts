import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AiCreditUsage, ShutdownMetrics } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { createPricingSlice } from "@/stores/preferences/pricing";
import { shutdownTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import { shutdownAiCreditUsage } from "../useSessionMetrics";

interface AccountingExpectation {
  tokens: number | null;
  credits: Pick<AiCreditUsage, "credits" | "source">;
}

interface ContractCase {
  name: string;
  wire: ShutdownMetrics;
  expected: AccountingExpectation & {
    models: Record<string, AccountingExpectation>;
    segments: AccountingExpectation[];
  };
}

// Rust's disk-to-summary serialization test checks this exact wire projection
// against the raw events in the same fixture; no frontend-only idealized DTOs.
const fixturePath = resolve(
  process.cwd(),
  "../../crates/tracepilot-core/tests/fixtures/contracts/session-accounting.json",
);
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as ContractCase[];
const pricing = createPricingSlice();

function accounting(
  metrics: Pick<ShutdownMetrics, "totalNanoAiu" | "modelMetrics">,
): AccountingExpectation {
  const { credits, source } = shutdownAiCreditUsage(metrics, pricing);
  return { tokens: shutdownTokenBreakdown(metrics).total, credits: { credits, source } };
}

describe("serialized shutdown accounting contract", () => {
  it.each(cases)("$name", ({ wire, expected }) => {
    const models = Object.fromEntries(
      Object.entries(wire.modelMetrics ?? {}).map(([name, metric]) => [
        name,
        accounting({ totalNanoAiu: metric.totalNanoAiu, modelMetrics: { [name]: metric } }),
      ]),
    );
    expect({
      ...accounting(wire),
      models,
      segments: (wire.sessionSegments ?? []).map(accounting),
    }).toEqual(expected);
  });
});
