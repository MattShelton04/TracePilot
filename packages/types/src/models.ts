/**
 * Canonical model registry — single source of truth for all AI model metadata.
 *
 * Every frontend component that needs a model list, tier classification, or
 * pricing default should import from here instead of maintaining its own copy.
 *
 * The Rust backend (`crates/tracepilot-orchestrator/src/launcher.rs`)
 * maintains a parallel `available_models()` list for defence-in-depth model
 * validation.  When adding or removing models, update both locations.
 */

import type { ModelPriceEntry } from "./config.js";

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

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Full model registry — authoritative list of all supported AI models with
 * tier classification and pricing data.
 *
 * Keep in sync with `crates/tracepilot-orchestrator/src/launcher.rs →
 * available_models()`.
 */
export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  // ── Premium ──
  {
    id: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    tier: "premium",
    inputPerM: 5.0,
    cachedInputPerM: 0.5,
    outputPerM: 25.0,
    premiumRequests: 3,
  },
  {
    id: "claude-opus-4.6-fast",
    name: "Claude Opus 4.6 Fast",
    tier: "premium",
    inputPerM: 5.0,
    cachedInputPerM: 0.5,
    outputPerM: 25.0,
    premiumRequests: 30,
  },
  {
    id: "claude-opus-4.5",
    name: "Claude Opus 4.5",
    tier: "premium",
    inputPerM: 5.0,
    cachedInputPerM: 0.5,
    outputPerM: 25.0,
    premiumRequests: 3,
  },
  // ── Standard ──
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    tier: "standard",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    id: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    tier: "standard",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    tier: "standard",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    tier: "standard",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 16.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    tier: "standard",
    inputPerM: 2.5,
    cachedInputPerM: 0.25,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    tier: "standard",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    tier: "standard",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    tier: "standard",
    inputPerM: 2.5,
    cachedInputPerM: 0.25,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    tier: "standard",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    tier: "standard",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    tier: "standard",
    inputPerM: 10.0,
    cachedInputPerM: 1.0,
    outputPerM: 40.0,
    premiumRequests: 1,
  },
  // ── Fast / Cheap ──
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    tier: "fast",
    inputPerM: 1.0,
    cachedInputPerM: 0.1,
    outputPerM: 5.0,
    premiumRequests: 0.33,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    tier: "fast",
    inputPerM: 0.4,
    cachedInputPerM: 0.04,
    outputPerM: 1.6,
    premiumRequests: 0.33,
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    tier: "fast",
    inputPerM: 0.4,
    cachedInputPerM: 0.04,
    outputPerM: 1.6,
    premiumRequests: 0.33,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    tier: "fast",
    inputPerM: 0.4,
    cachedInputPerM: 0.04,
    outputPerM: 1.6,
    premiumRequests: 0,
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    tier: "fast",
    inputPerM: 8.0,
    cachedInputPerM: 0.8,
    outputPerM: 24.0,
    premiumRequests: 0,
  },
];

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
  return MODEL_REGISTRY.map(({ id, inputPerM, cachedInputPerM, outputPerM, premiumRequests }) => ({
    model: id,
    inputPerM,
    cachedInputPerM,
    outputPerM,
    premiumRequests,
  }));
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
