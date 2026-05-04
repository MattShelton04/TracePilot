import type { ModelPriceEntry } from "./config.js";
import { GITHUB_USAGE_BILLING_EFFECTIVE_FROM, PRICING_REGISTRY } from "./pricing-registry.js";
import type { ModelMetricDetail, ShutdownMetrics } from "./session.js";

export const AI_CREDIT_USD = 0.01;
export const NANO_AIU_PER_AI_CREDIT = 1_000_000_000;
export {
  GITHUB_ANNUAL_LEGACY_MULTIPLIERS,
  GITHUB_COPILOT_USAGE_PRICING,
  GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
  PRICING_REGISTRY,
  PRICING_REGISTRY_VERSION,
  PROVIDER_WHOLESALE_PRICING,
} from "./pricing-registry.js";

export type PricingProvider = "github-copilot" | "provider-wholesale" | "user";
export type PricingKind = "legacy-premium-request" | "usage-token-rate" | "observed-nano-aiu";
export type PricingStatus = "official" | "estimated" | "user-override" | "deprecated";
export type PricingUnit = "per-1m-tokens" | "premium-request" | "nano-aiu";
export type PricingRateMode = "session-time" | "latest";

export interface TokenRateSet {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  cacheWritePerM?: number;
  reasoningPerM?: number;
}

export interface PricingRegistryEntry {
  model: string;
  displayName?: string;
  aliases?: string[];
  billingProvider: PricingProvider;
  pricingKind: PricingKind;
  rates?: TokenRateSet;
  premiumRequests?: number;
  currency: "USD";
  unit: PricingUnit;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceLabel: string;
  sourceUrl?: string;
  status: PricingStatus;
}

export interface TokenUsageForCost {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface PricingLookupOptions {
  billingProvider?: PricingProvider;
  pricingKind?: PricingKind;
  at?: string | Date | null;
  rateMode?: PricingRateMode;
  userOverrides?: readonly PricingRegistryEntry[];
}

export type CostBreakdownStatus = "priced" | "unknown-model" | "missing-rate";

export interface TokenCostBreakdown {
  status: CostBreakdownStatus;
  model: string;
  matchedModel?: string;
  entry?: PricingRegistryEntry;
  inputCost: number;
  cachedInputCost: number;
  cacheWriteCost: number;
  outputCost: number;
  reasoningCost: number;
  totalCost: number | null;
  aiCredits: number | null;
  warnings: string[];
}

export interface PricingComparisonBreakdown {
  legacyCopilotCost: number;
  usageBasedCopilot: TokenCostBreakdown;
  wholesaleProvider: TokenCostBreakdown;
  june2026PreviewDelta: number | null;
}

export function normalizeModelName(modelName: string): string {
  return modelName
    .trim()
    .replace(/^models\//i, "")
    .replace(/[_\s]+/g, "-")
    .replace(/--+/g, "-")
    .toLowerCase();
}

function parseEffectiveDate(value?: string | Date | null): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function isEffective(entry: PricingRegistryEntry, at: string | Date | null | undefined): boolean {
  const atTime = parseEffectiveDate(at);
  if (atTime == null) return true;
  const from = parseEffectiveDate(entry.effectiveFrom);
  const to = parseEffectiveDate(entry.effectiveTo);
  return (from == null || atTime >= from) && (to == null || atTime < to);
}

function entryAliases(entry: PricingRegistryEntry): string[] {
  return [entry.model, ...(entry.aliases ?? [])].map(normalizeModelName);
}

function modelMatches(entry: PricingRegistryEntry, normalizedModel: string): boolean {
  return entryAliases(entry).some(
    (alias) => normalizedModel === alias || normalizedModel.startsWith(`${alias}-`),
  );
}

function compareEffectiveFrom(a: PricingRegistryEntry, b: PricingRegistryEntry): number {
  return (parseEffectiveDate(b.effectiveFrom) ?? 0) - (parseEffectiveDate(a.effectiveFrom) ?? 0);
}

function longestAliasLength(entry: PricingRegistryEntry): number {
  return Math.max(...entryAliases(entry).map((alias) => alias.length));
}

export function modelPriceEntryToPricingEntry(
  entry: ModelPriceEntry,
  overrides?: Partial<PricingRegistryEntry>,
): PricingRegistryEntry {
  return {
    model: entry.model,
    aliases: entry.aliases,
    billingProvider: entry.source ?? "user",
    pricingKind: entry.pricingKind ?? "usage-token-rate",
    rates: {
      inputPerM: entry.inputPerM,
      cachedInputPerM: entry.cachedInputPerM,
      outputPerM: entry.outputPerM,
      cacheWritePerM: entry.cacheWritePerM ?? 0,
      reasoningPerM: entry.reasoningPerM,
    },
    premiumRequests: entry.premiumRequests,
    currency: "USD",
    unit: "per-1m-tokens",
    effectiveFrom: entry.effectiveFrom,
    effectiveTo: entry.effectiveTo,
    sourceLabel: entry.sourceLabel ?? "Local user override",
    sourceUrl: entry.sourceUrl,
    status: entry.status ?? "user-override",
    ...overrides,
  };
}

export function modelPriceEntriesToPricingRegistry(
  entries: readonly ModelPriceEntry[],
): PricingRegistryEntry[] {
  return entries.map((entry) =>
    modelPriceEntryToPricingEntry(entry, {
      billingProvider: "provider-wholesale",
      status: "user-override",
      sourceLabel: entry.sourceLabel ?? "Local settings override",
    }),
  );
}

export function resolvePricingEntry(
  modelName: string,
  options: PricingLookupOptions = {},
): PricingRegistryEntry | undefined {
  const normalizedModel = normalizeModelName(modelName);
  const billingProvider = options.billingProvider ?? "provider-wholesale";
  const pricingKind = options.pricingKind ?? "usage-token-rate";
  const rateMode = options.rateMode ?? "session-time";
  // Local direct-API/provider overrides intentionally default to latest-rate
  // lookups in the desktop store because the persisted settings table is a
  // mutable override list, not a historical pricing ledger.
  const registry = [...(options.userOverrides ?? []), ...PRICING_REGISTRY];
  const matches = registry
    .filter(
      (entry) =>
        entry.billingProvider === billingProvider &&
        entry.pricingKind === pricingKind &&
        modelMatches(entry, normalizedModel),
    )
    .sort((a, b) => {
      if (a.status === "user-override" && b.status !== "user-override") return -1;
      if (a.status !== "user-override" && b.status === "user-override") return 1;
      return longestAliasLength(b) - longestAliasLength(a) || compareEffectiveFrom(a, b);
    });

  if (rateMode === "latest") return matches[0];
  return matches.find((entry) => isEffective(entry, options.at));
}

export function calculateTokenCost(
  modelName: string,
  usage: TokenUsageForCost,
  options: PricingLookupOptions = {},
): TokenCostBreakdown {
  const entry = resolvePricingEntry(modelName, options);
  if (!entry) {
    return {
      status: "unknown-model",
      model: modelName,
      inputCost: 0,
      cachedInputCost: 0,
      cacheWriteCost: 0,
      outputCost: 0,
      reasoningCost: 0,
      totalCost: null,
      aiCredits: null,
      warnings: ["No matching price entry for model."],
    };
  }

  if (!entry.rates) {
    return {
      status: "missing-rate",
      model: modelName,
      matchedModel: entry.model,
      entry,
      inputCost: 0,
      cachedInputCost: 0,
      cacheWriteCost: 0,
      outputCost: 0,
      reasoningCost: 0,
      totalCost: null,
      aiCredits: null,
      warnings: ["Matched price entry does not include token rates."],
    };
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const reasoningTokens = usage.reasoningTokens ?? 0;
  const nonCachedInputTokens = Math.max(inputTokens - cacheReadTokens, 0);
  const inputCost = (nonCachedInputTokens / 1_000_000) * entry.rates.inputPerM;
  const cachedInputCost = (cacheReadTokens / 1_000_000) * entry.rates.cachedInputPerM;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (entry.rates.cacheWritePerM ?? 0);
  const reasoningCost = (reasoningTokens / 1_000_000) * (entry.rates.reasoningPerM ?? 0);
  const outputCost = (outputTokens / 1_000_000) * entry.rates.outputPerM;
  const totalCost = inputCost + cachedInputCost + cacheWriteCost + outputCost + reasoningCost;

  return {
    status: "priced",
    model: modelName,
    matchedModel: entry.model,
    entry,
    inputCost,
    cachedInputCost,
    cacheWriteCost,
    outputCost,
    reasoningCost,
    totalCost,
    aiCredits: totalCost / AI_CREDIT_USD,
    warnings:
      cacheWriteTokens > 0 && entry.rates.cacheWritePerM == null
        ? ["Cache-write tokens were present but this price entry has no cache-write rate."]
        : [],
  };
}

export function sumTokenCosts(costs: readonly TokenCostBreakdown[]): TokenCostBreakdown {
  const warnings = costs.flatMap((cost) => cost.warnings);
  const firstUnknown = costs.find((cost) => cost.status !== "priced");
  const pricedCosts = costs.filter((cost) => cost.status === "priced");
  const totalCost = pricedCosts.reduce((sum, cost) => sum + (cost.totalCost ?? 0), 0);
  return {
    status: firstUnknown ? firstUnknown.status : "priced",
    model: "total",
    inputCost: pricedCosts.reduce((sum, cost) => sum + cost.inputCost, 0),
    cachedInputCost: pricedCosts.reduce((sum, cost) => sum + cost.cachedInputCost, 0),
    cacheWriteCost: pricedCosts.reduce((sum, cost) => sum + cost.cacheWriteCost, 0),
    outputCost: pricedCosts.reduce((sum, cost) => sum + cost.outputCost, 0),
    reasoningCost: pricedCosts.reduce((sum, cost) => sum + cost.reasoningCost, 0),
    totalCost: costs.length === pricedCosts.length ? totalCost : null,
    aiCredits: costs.length === pricedCosts.length ? totalCost / AI_CREDIT_USD : null,
    warnings,
  };
}

export function calculateMetricsTokenCost(
  modelMetrics: Record<string, ModelMetricDetail> | null | undefined,
  options: PricingLookupOptions = {},
): TokenCostBreakdown {
  if (!modelMetrics) return sumTokenCosts([]);
  return sumTokenCosts(
    Object.entries(modelMetrics).map(([model, metric]) =>
      calculateTokenCost(model, metric.usage ?? {}, options),
    ),
  );
}

export function calculateObservedAiuCost(totalNanoAiu: number | null | undefined): number | null {
  if (totalNanoAiu == null) return null;
  return (totalNanoAiu / NANO_AIU_PER_AI_CREDIT) * AI_CREDIT_USD;
}

export function calculatePricingComparison(
  metrics: ShutdownMetrics,
  costPerPremiumRequest: number,
  userOverrides: readonly PricingRegistryEntry[] = [],
  at?: string | Date | null,
): PricingComparisonBreakdown {
  const legacyCopilotCost = (metrics.totalPremiumRequests ?? 0) * costPerPremiumRequest;
  const usageBasedCopilot = calculateMetricsTokenCost(metrics.modelMetrics, {
    billingProvider: "github-copilot",
    pricingKind: "usage-token-rate",
    at: at ?? GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
  });
  const wholesaleProvider = calculateMetricsTokenCost(metrics.modelMetrics, {
    billingProvider: "provider-wholesale",
    pricingKind: "usage-token-rate",
    at,
    userOverrides,
  });
  const june2026PreviewDelta =
    usageBasedCopilot.totalCost == null ? null : usageBasedCopilot.totalCost - legacyCopilotCost;
  return {
    legacyCopilotCost,
    usageBasedCopilot,
    wholesaleProvider,
    june2026PreviewDelta,
  };
}
