import data from "./claude-code-pricing-data.json" with { type: "json" };
import {
  calculateTokenCost,
  type PricingRegistryEntry,
  type TokenCostBreakdown,
  type TokenUsageForCost,
} from "./pricing.js";
import type { CostBasis } from "./session.js";

/** Claude Code API-equivalent rates, kept outside Copilot's registry,
 * persisted defaults and pricing controls. */
export const CLAUDE_CODE_PRICING: readonly PricingRegistryEntry[] = data.anthropicUsage.map(
  ({ model, ...rates }) => ({
    model,
    aliases: [model.replace(/\.(\d+)/, "-$1")],
    billingProvider: "provider-wholesale",
    pricingKind: "usage-token-rate",
    rates,
    currency: "USD",
    unit: "per-1m-tokens",
    sourceLabel: `${data.source.label} (verified ${data.source.verifiedAt})`,
    sourceUrl: data.source.url,
    status: "official",
  }),
);

/** A recorded write needs its TTL; missing data must not borrow a 5m rate. */
export function calculateClaudeCodeTokenCost(
  model: string,
  usage: TokenUsageForCost,
): TokenCostBreakdown {
  const cost = calculateTokenCost(model, usage, { registry: CLAUDE_CODE_PRICING });
  if (usage.inputTokens == null || usage.outputTokens == null) {
    return {
      ...cost,
      status: "missing-rate",
      totalCost: null,
      aiCredits: null,
      warnings: ["Complete input and output usage was not recorded."],
    };
  }
  if ((usage.cacheWriteTokens ?? 0) > 0 && usage.cacheWriteByTtl == null) {
    return {
      ...cost,
      status: "missing-rate",
      totalCost: null,
      aiCredits: null,
      warnings: ["Cache-write TTL was not recorded."],
    };
  }
  return { ...cost, aiCredits: null };
}

/** Labels for source-aware USD presentation (U2), never an AI Credit label. */
export function claudeCodeCostBasisLabel(basis: CostBasis): string {
  return {
    billed: "Billed",
    providerEstimate: "Claude Code estimate",
    tracepilotEstimate: "TracePilot estimate",
  }[basis];
}
