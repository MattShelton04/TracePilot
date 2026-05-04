import { MODEL_REGISTRY } from "./models.js";
import type { PricingRegistryEntry, TokenRateSet } from "./pricing.js";
import pricingData from "./pricing-data.json";

interface PricingSourceData {
  label: string;
  url?: string;
  verifiedAt: string;
  effectiveFrom?: string;
}

interface UsagePricingData extends TokenRateSet {
  model: string;
  displayName: string;
}

interface LegacyMultiplierData {
  model: string;
  displayName: string;
  premiumRequests: number;
}

interface PricingDataFile {
  version: string;
  sources: {
    githubCopilotUsage: PricingSourceData;
    annualLegacyMultipliers: PricingSourceData;
    tracePilotLegacyProviderEstimate: PricingSourceData;
  };
  aliases: Record<string, string[]>;
  githubCopilotUsage: UsagePricingData[];
  annualLegacyMultipliers: LegacyMultiplierData[];
}

const DATA = pricingData as PricingDataFile;
const GITHUB_USAGE_SOURCE = DATA.sources.githubCopilotUsage;
const ANNUAL_MULTIPLIERS_SOURCE = DATA.sources.annualLegacyMultipliers;
const LEGACY_PROVIDER_SOURCE = DATA.sources.tracePilotLegacyProviderEstimate;

export const PRICING_REGISTRY_VERSION = DATA.version;
export const GITHUB_USAGE_BILLING_EFFECTIVE_FROM =
  GITHUB_USAGE_SOURCE.effectiveFrom ?? "2026-06-01";

function sourceLabel(source: PricingSourceData): string {
  return `${source.label} (verified ${source.verifiedAt})`;
}

function githubUsageEntry(row: UsagePricingData): PricingRegistryEntry {
  return {
    model: row.model,
    displayName: row.displayName,
    aliases: DATA.aliases[row.model],
    billingProvider: "github-copilot",
    pricingKind: "usage-token-rate",
    rates: {
      inputPerM: row.inputPerM,
      cachedInputPerM: row.cachedInputPerM,
      cacheWritePerM: row.cacheWritePerM,
      outputPerM: row.outputPerM,
    },
    currency: "USD",
    unit: "per-1m-tokens",
    effectiveFrom: GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
    sourceLabel: sourceLabel(GITHUB_USAGE_SOURCE),
    sourceUrl: GITHUB_USAGE_SOURCE.url,
    status: "official",
  };
}

function providerMirrorEntry(row: UsagePricingData): PricingRegistryEntry {
  return {
    ...githubUsageEntry(row),
    billingProvider: "provider-wholesale",
    effectiveFrom: undefined,
    sourceLabel: `${sourceLabel(GITHUB_USAGE_SOURCE)}; local default mirrors GitHub's published token rates`,
  };
}

function legacyMultiplierEntry(row: LegacyMultiplierData): PricingRegistryEntry {
  return {
    model: row.model,
    displayName: row.displayName,
    aliases: DATA.aliases[row.model],
    billingProvider: "github-copilot",
    pricingKind: "legacy-premium-request",
    premiumRequests: row.premiumRequests,
    currency: "USD",
    unit: "premium-request",
    effectiveFrom: ANNUAL_MULTIPLIERS_SOURCE.effectiveFrom,
    sourceLabel: sourceLabel(ANNUAL_MULTIPLIERS_SOURCE),
    sourceUrl: ANNUAL_MULTIPLIERS_SOURCE.url,
    status: "official",
  };
}

const documentedUsageModels = new Set(DATA.githubCopilotUsage.map((entry) => entry.model));

export const GITHUB_COPILOT_USAGE_PRICING: readonly PricingRegistryEntry[] =
  DATA.githubCopilotUsage.map(githubUsageEntry);

export const GITHUB_ANNUAL_LEGACY_MULTIPLIERS: readonly PricingRegistryEntry[] =
  DATA.annualLegacyMultipliers.map(legacyMultiplierEntry);

export const PROVIDER_WHOLESALE_PRICING: readonly PricingRegistryEntry[] = [
  ...DATA.githubCopilotUsage.map(providerMirrorEntry),
  ...MODEL_REGISTRY.filter((model) => !documentedUsageModels.has(model.id)).map((model) => ({
    model: model.id,
    displayName: model.name,
    aliases: DATA.aliases[model.id],
    billingProvider: "provider-wholesale" as const,
    pricingKind: "usage-token-rate" as const,
    rates: {
      inputPerM: model.inputPerM,
      cachedInputPerM: model.cachedInputPerM,
      outputPerM: model.outputPerM,
      cacheWritePerM: 0,
    },
    premiumRequests: model.premiumRequests,
    currency: "USD" as const,
    unit: "per-1m-tokens" as const,
    sourceLabel: `${sourceLabel(LEGACY_PROVIDER_SOURCE)}; model not listed on GitHub pricing page`,
    status: "estimated" as const,
  })),
];

export const PRICING_REGISTRY: readonly PricingRegistryEntry[] = [
  ...PROVIDER_WHOLESALE_PRICING,
  ...GITHUB_COPILOT_USAGE_PRICING,
  ...GITHUB_ANNUAL_LEGACY_MULTIPLIERS,
];
