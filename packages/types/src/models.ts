/**
 * Canonical model registry — single source of truth for all AI model metadata.
 *
 * Every frontend component that needs a model list, tier classification, or
 * pricing default should import from here instead of maintaining its own copy.
 *
 * Backed by `packages/types/data/model-registry.json`, which is also embedded
 * (via `include_str!`) into the Rust orchestrator crate so both layers
 * deserialize identical data — see `crates/tracepilot-orchestrator/src/models.rs`.
 */

import registryData from "../data/model-registry.json" with { type: "json" };
import type { ModelPriceEntry } from "./config.js";
import pricingData from "./pricing-data.json" with { type: "json" };

// ─── Tier ────────────────────────────────────────────────────────────

export type ModelTier = "premium" | "standard" | "fast";

// ─── Registry Entry ──────────────────────────────────────────────────

export interface ModelDefinition {
  /** Unique model identifier, e.g. "claude-opus-4.6". */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Model tier classification. */
  tier: ModelTier;
  /** Wholesale input cost per 1 M tokens (USD). */
  inputPerM: number;
  /** Wholesale input cost per 1 M cached tokens (USD). */
  cachedInputPerM: number;
  /** Wholesale output cost per 1 M tokens (USD). */
  outputPerM: number;
  /** Premium-request multiplier (e.g. 1×, 3×, 0.33×). 0 = free tier. */
  premiumRequests: number;
}

interface UsagePricingData {
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  cacheWritePerM?: number;
  outputPerM: number;
}

interface PricingDataFile {
  sources: {
    githubCopilotUsage: {
      label: string;
      url?: string;
      verifiedAt: string;
    };
    tracePilotLegacyProviderEstimate: {
      label: string;
      verifiedAt: string;
    };
    tracePilotCurrentPremiumRequests: {
      label: string;
      verifiedAt: string;
    };
  };
  aliases: Record<string, string[]>;
  githubCopilotUsage: UsagePricingData[];
  annualLegacyMultipliers: { model: string; currentPremiumRequests?: number }[];
  currentPremiumRequestDefaults: { model: string; currentPremiumRequests: number }[];
}

const PRICING_DATA = pricingData as PricingDataFile;
const OFFICIAL_TOKEN_RATES_BY_MODEL = new Map(
  PRICING_DATA.githubCopilotUsage.map((entry) => [entry.model, entry]),
);
const CURRENT_PREMIUM_REQUESTS_BY_MODEL = new Map(
  [
    ...PRICING_DATA.annualLegacyMultipliers.filter((entry) => entry.currentPremiumRequests != null),
    ...PRICING_DATA.currentPremiumRequestDefaults,
  ].map((entry) => [entry.model, entry.currentPremiumRequests as number]),
);

function pricingSourceLabel(source: { label: string; verifiedAt: string }): string {
  return `${source.label} (verified ${source.verifiedAt})`;
}

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Full model registry — authoritative list of all supported AI models with
 * tier classification and pricing data. Loaded from the shared JSON file at
 * `packages/types/data/model-registry.json`, which is also consumed by the
 * Rust orchestrator (`crates/tracepilot-orchestrator/src/models.rs`).
 */
const MODEL_REGISTRY_BASE: readonly ModelDefinition[] = registryData as ModelDefinition[];

export const MODEL_REGISTRY: readonly ModelDefinition[] = MODEL_REGISTRY_BASE.map((model) => ({
  ...model,
  premiumRequests: CURRENT_PREMIUM_REQUESTS_BY_MODEL.get(model.id) ?? model.premiumRequests,
}));

// ─── Derived helpers ─────────────────────────────────────────────────

/** All model IDs. */
export function getAllModelIds(): string[] {
  return MODEL_REGISTRY.map((m) => m.id);
}

/** Models filtered by tier. */
export function getModelsByTier(tier: ModelTier): readonly ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => m.tier === tier);
}

/** Get a model definition by ID (case-insensitive). */
export function getModelById(id: string): ModelDefinition | undefined {
  const lower = id.toLowerCase();
  return MODEL_REGISTRY.find((m) => m.id.toLowerCase() === lower);
}

/** Determine the tier of a model ID. Falls back to 'standard'. */
export function getModelTier(modelId: string): ModelTier {
  return getModelById(modelId)?.tier ?? "standard";
}

/** Human-readable tier label. */
export function getTierLabel(tier: ModelTier): string {
  switch (tier) {
    case "premium":
      return "Premium";
    case "fast":
      return "Fast / Cheap";
    default:
      return "Standard";
  }
}

/** Derive default wholesale prices from the registry. */
export function getDefaultWholesalePrices(): ModelPriceEntry[] {
  return MODEL_REGISTRY.map(({ id, inputPerM, cachedInputPerM, outputPerM, premiumRequests }) => {
    const officialRates = OFFICIAL_TOKEN_RATES_BY_MODEL.get(id);
    if (officialRates) {
      return {
        model: id,
        aliases: PRICING_DATA.aliases[id],
        inputPerM: officialRates.inputPerM,
        cachedInputPerM: officialRates.cachedInputPerM,
        cacheWritePerM: officialRates.cacheWritePerM,
        outputPerM: officialRates.outputPerM,
        premiumRequests,
        source: "provider-wholesale",
        sourceLabel: `${pricingSourceLabel(
          PRICING_DATA.sources.githubCopilotUsage,
        )}; local default mirrors GitHub's published token rates`,
        sourceUrl: PRICING_DATA.sources.githubCopilotUsage.url,
        status: "official",
      };
    }
    return {
      model: id,
      aliases: PRICING_DATA.aliases[id],
      inputPerM,
      cachedInputPerM,
      cacheWritePerM: 0,
      outputPerM,
      premiumRequests,
      source: "provider-wholesale",
      sourceLabel: `${pricingSourceLabel(
        PRICING_DATA.sources.tracePilotLegacyProviderEstimate,
      )}; model not listed on GitHub pricing page`,
      status: "estimated",
    };
  });
}

// ─── Well-known defaults ─────────────────────────────────────────────

/** Default model used when none is explicitly selected. */
export const DEFAULT_MODEL_ID = "claude-sonnet-4.6";

/** Default favourite models shown in the UI. */
export const DEFAULT_FAVOURITE_MODELS: readonly string[] = [
  "claude-opus-4.6",
  "gpt-5.4",
  "gpt-5.3-codex",
];

/** Default premium model used for "upgrade all" operations. */
export const DEFAULT_PREMIUM_MODEL_ID = "claude-opus-4.6";
