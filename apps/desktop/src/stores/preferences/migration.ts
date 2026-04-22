/**
 * One-time legacy-preferences migration helper.
 *
 * Reads the pre-2.2 `tracepilot.prefs` localStorage blob and folds its fields
 * into a fresh `TracePilotConfig`. The returned config is the caller's to save
 * (and then remove the legacy localStorage key once the save succeeds).
 */

import type { ModelPriceEntry, TracePilotConfig } from "@tracepilot/types";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { DEFAULT_WHOLESALE_PRICES } from "@/stores/preferences/pricing";
import { logWarn } from "@/utils/logger";

export function migrateFromLocalStorage(config: TracePilotConfig): TracePilotConfig {
  const raw = localStorage.getItem(STORAGE_KEYS.legacyPrefs);
  if (!raw) return config;

  try {
    const old = JSON.parse(raw);

    // UI section
    if (old.theme === "dark" || old.theme === "light") config.ui.theme = old.theme;
    if (typeof old.hideEmptySessions === "boolean")
      config.ui.hideEmptySessions = old.hideEmptySessions;
    if (typeof old.autoRefreshEnabled === "boolean")
      config.ui.autoRefreshEnabled = old.autoRefreshEnabled;
    if (typeof old.autoRefreshIntervalSeconds === "number")
      config.ui.autoRefreshIntervalSeconds = old.autoRefreshIntervalSeconds;
    if (typeof old.checkForUpdates === "boolean") config.ui.checkForUpdates = old.checkForUpdates;
    if (Array.isArray(old.favouriteModels)) config.ui.favouriteModels = old.favouriteModels;
    if (Array.isArray(old.recentRepoPaths)) config.ui.recentRepoPaths = old.recentRepoPaths;

    // General
    if (typeof old.cliCommand === "string") config.general.cliCommand = old.cliCommand;

    // Pricing
    if (typeof old.costPerPremiumRequest === "number")
      config.pricing.costPerPremiumRequest = old.costPerPremiumRequest;
    if (Array.isArray(old.modelWholesalePrices)) {
      // Merge with defaults: preserve user customizations, backfill new fields
      const saved = old.modelWholesalePrices as ModelPriceEntry[];
      config.pricing.models = DEFAULT_WHOLESALE_PRICES.map((def) => {
        const existing = saved.find((s) => s.model === def.model);
        return existing
          ? {
              ...def,
              ...existing,
              premiumRequests: existing.premiumRequests ?? def.premiumRequests,
            }
          : def;
      });
      // Include any user-added models not in defaults
      for (const s of saved) {
        if (!DEFAULT_WHOLESALE_PRICES.find((d) => d.model === s.model)) {
          config.pricing.models.push({ ...s, premiumRequests: s.premiumRequests ?? 1 });
        }
      }
    }

    // Tool rendering
    if (old.toolRendering && typeof old.toolRendering === "object") {
      config.toolRendering.enabled =
        typeof old.toolRendering.enabled === "boolean" ? old.toolRendering.enabled : true;
      config.toolRendering.toolOverrides = old.toolRendering.toolOverrides ?? {};
    }

    // Features
    if (old.featureFlags && typeof old.featureFlags === "object") {
      for (const key of Object.keys(config.features)) {
        const k = key as keyof typeof config.features;
        if (typeof old.featureFlags[key] === "boolean") {
          (config.features as Record<string, boolean>)[k] = old.featureFlags[key] as boolean;
        }
      }
    }

    // Migrate ephemeral fields
    if (old.lastViewedSession)
      localStorage.setItem(STORAGE_KEYS.lastSession, old.lastViewedSession);
    if (old.lastSeenVersion)
      localStorage.setItem(STORAGE_KEYS.lastSeenVersion, old.lastSeenVersion);
  } catch (e) {
    // Corrupt localStorage — leave key in place; it'll be retried next launch
    logWarn("[preferences] Failed to migrate legacy preferences", e);
  }

  return config;
}
