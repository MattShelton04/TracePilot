/**
 * Canonical registry of feature-flag keys.
 *
 * Derived at runtime from `DEFAULT_FEATURES` in `@tracepilot/types`, which is
 * itself kept in lock-step with `FeaturesConfig::default()` in
 * `crates/tracepilot-tauri-bindings/src/config.rs`.
 *
 * Because `FEATURE_FLAGS` is `Object.keys(DEFAULT_FEATURES)`, the array and the
 * union cannot drift from the backend-shaped feature record. Consumers should
 * prefer `FeatureFlag` over raw strings anywhere a flag key flows through
 * router meta, navigation metadata, or preferences helpers.
 *
 * See Phase 1B.2 in `docs/tech-debt-plan-revised-2026-04.md`.
 */

import { DEFAULT_FEATURES } from "@tracepilot/types";

/** Frozen list of known feature-flag keys. */
export const FEATURE_FLAGS = Object.freeze(
  Object.keys(DEFAULT_FEATURES) as (keyof typeof DEFAULT_FEATURES)[],
) as readonly (keyof typeof DEFAULT_FEATURES)[];

/** Narrowed union of valid feature-flag keys. */
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/**
 * Runtime guard — narrows an arbitrary value to a known feature-flag key.
 */
export function isFeatureFlag(value: unknown): value is FeatureFlag {
  return typeof value === "string" && (FEATURE_FLAGS as readonly string[]).includes(value);
}
