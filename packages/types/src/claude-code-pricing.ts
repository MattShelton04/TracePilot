import data from "./claude-code-pricing-data.json" with { type: "json" };
import {
  calculateTokenCost,
  type PricingRegistryEntry,
  resolvePricingEntry,
  type TokenCostBreakdown,
  type TokenUsageForCost,
} from "./pricing.js";
import type { CostBasis } from "./session.js";
import type { SessionSource } from "./sources.js";

interface ClaudeRateRow {
  model: string;
  aliases?: string[];
  /** A prompt-length tier (Claude Haiku 5.5): total input including cache. */
  pricingTier?: string;
  minimumInputTokens?: number;
  inputPerM: number;
  cachedInputPerM: number;
  cacheWritePerM: number;
  cacheWrite1hPerM: number;
  outputPerM: number;
}

/** Claude Code API-equivalent rates, kept outside Copilot's registry,
 * persisted defaults and pricing controls. `pnpm pricing:claude` refreshes the
 * data from Anthropic's pricing page. */
export const CLAUDE_CODE_PRICING: readonly PricingRegistryEntry[] = (
  data.anthropicUsage as ClaudeRateRow[]
).map(({ model, aliases, pricingTier, minimumInputTokens, ...rates }) => ({
  model,
  ...(minimumInputTokens != null && {
    pricingTier: pricingTier === "long-context" ? "long-context" : "default",
    minimumInputTokens,
  }),
  aliases: [model.replace(/\.(\d+)/, "-$1"), ...(aliases ?? [])],
  billingProvider: "provider-wholesale",
  pricingKind: "usage-token-rate",
  rates,
  currency: "USD",
  unit: "per-1m-tokens",
  sourceLabel: `${data.source.label} (verified ${data.source.verifiedAt})`,
  sourceUrl: data.source.url,
  status: "official",
}));

/**
 * The registry id of a Claude Code model (`claude-opus-4-5-20251101` →
 * `claude-opus-4.5`), which is also how Copilot names it. `null` for a model
 * the registry does not know.
 */
export function claudeCodeModelFamily(model: string): string | null {
  return resolvePricingEntry(model, { registry: CLAUDE_CODE_PRICING })?.model ?? null;
}

/**
 * How to name a session's model on screen, the way Analytics and Models do:
 * a known Claude Code id by its registry family (`claude-opus-5-5` →
 * `claude-opus-5.5`), anything else as recorded. Display only; stored and
 * filter values keep the recorded id.
 */
export function modelDisplayName(model: string, source: SessionSource | null | undefined): string {
  return source === "claudeCode" ? (claudeCodeModelFamily(model) ?? model) : model;
}

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
