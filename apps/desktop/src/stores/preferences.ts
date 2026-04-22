/**
 * Preferences Pinia store.
 *
 * Composition shell that wires four pure slice factories in
 * `stores/preferences/` (ui, pricing, alerts, featureFlags) together with the
 * config.toml-backed hydration / migration / debounced persistence layer.
 *
 * PRESERVED FROM WAVE 2.2:
 *   - Versioned/legacy-key migration from `localStorage`
 *   - Write-through theme cache (instant theme on next launch, no flash)
 *   - All state backed by config.toml via `@tracepilot/client`
 *
 * The exported symbols (`usePreferencesStore`, `ThemeOption`, `BASE_FONT_SIZE_PX`,
 * `ModelWholesalePrice`, `DEFAULT_WHOLESALE_PRICES`) match the legacy surface.
 */

import { checkConfigExists, getConfig, saveConfig } from "@tracepilot/client";
import type { TracePilotConfig } from "@tracepilot/types";
import {
  createDefaultConfig,
  DEFAULT_CONTENT_MAX_WIDTH,
  DEFAULT_FEATURES,
  DEFAULT_UI_SCALE,
} from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { createAlertsSlice } from "@/stores/preferences/alerts";
import { createFeatureFlagsSlice } from "@/stores/preferences/featureFlags";
import { migrateFromLocalStorage } from "@/stores/preferences/migration";
import { createPricingSlice, DEFAULT_WHOLESALE_PRICES } from "@/stores/preferences/pricing";
import {
  applyContentMaxWidth,
  applyTheme,
  applyUiScale,
  createUiSlice,
  type ThemeOption,
} from "@/stores/preferences/ui";
import { logWarn } from "@/utils/logger";

export type { ModelWholesalePrice } from "@/stores/preferences/pricing";
export { DEFAULT_WHOLESALE_PRICES } from "@/stores/preferences/pricing";
// ── Public re-exports (back-compat) ─────────────────────────────
export type { ThemeOption } from "@/stores/preferences/ui";
export { BASE_FONT_SIZE_PX } from "@/stores/preferences/ui";

export const usePreferencesStore = defineStore("preferences", () => {
  const ui = createUiSlice();
  const pricing = createPricingSlice();
  const alerts = createAlertsSlice();
  const flags = createFeatureFlagsSlice();

  // Hydration gate — prevents reactive watches from persisting default values
  // to disk before the real config has been loaded from the backend.
  let hydrated = false;

  // Last-known full backend config so preference changes can be merged back
  // without clobbering paths/version fields.
  let backendConfig: TracePilotConfig | null = null;

  // ── Apply config → reactive refs ───────────────────────────
  function applyConfig(config: TracePilotConfig) {
    ui.theme.value = (config.ui.theme === "light" ? "light" : "dark") as ThemeOption;
    ui.sessionStateDir.value = config.paths.sessionStateDir;
    ui.hideEmptySessions.value = config.ui.hideEmptySessions;
    ui.autoRefreshEnabled.value = config.ui.autoRefreshEnabled;
    ui.autoRefreshIntervalSeconds.value = config.ui.autoRefreshIntervalSeconds;
    ui.checkForUpdates.value = config.ui.checkForUpdates;
    ui.favouriteModels.value = [...config.ui.favouriteModels];
    ui.recentRepoPaths.value = [...config.ui.recentRepoPaths];

    // Defensive nullish coalescing (??) is used for backwards compatibility
    // with existing configs that may not have these newer fields yet.
    const rawWidth = config.ui.contentMaxWidth ?? DEFAULT_CONTENT_MAX_WIDTH;
    // Clamp to 400px min, or allow 0 for "No limit"
    ui.contentMaxWidth.value = rawWidth === 0 ? 0 : Math.max(400, rawWidth);

    const rawScale = config.ui.uiScale ?? DEFAULT_UI_SCALE;
    // Normalize to 0.8x to 1.3x range to ensure UI usability
    ui.uiScale.value = Math.max(0.8, Math.min(1.3, rawScale));

    ui.cliCommand.value = config.general.cliCommand;
    pricing.costPerPremiumRequest.value = config.pricing.costPerPremiumRequest;
    pricing.modelWholesalePrices.value =
      config.pricing.models.length > 0 ? [...config.pricing.models] : [...DEFAULT_WHOLESALE_PRICES];
    pricing.toolRendering.value = {
      enabled: config.toolRendering.enabled,
      toolOverrides: { ...config.toolRendering.toolOverrides },
    };
    flags.featureFlags.value = { ...DEFAULT_FEATURES, ...config.features };
    ui.logLevel.value = config.logging?.level ?? "info";

    // Alert settings
    if (config.alerts) {
      alerts.alertsEnabled.value = config.alerts.enabled ?? false;
      alerts.alertsScope.value = config.alerts.scope === "all" ? "all" : "monitored";
      alerts.alertsNativeNotifications.value = config.alerts.nativeNotifications ?? true;
      alerts.alertsTaskbarFlash.value = config.alerts.taskbarFlash ?? true;
      alerts.alertsSoundEnabled.value = config.alerts.soundEnabled ?? false;
      alerts.alertsOnSessionEnd.value = config.alerts.onSessionEnd ?? true;
      alerts.alertsOnAskUser.value = config.alerts.onAskUser ?? true;
      alerts.alertsOnSessionError.value = config.alerts.onSessionError ?? false;
      alerts.alertsCooldownSeconds.value = config.alerts.cooldownSeconds ?? 20;
    }
  }

  // ── Build config from reactive state ───────────────────────
  function buildConfig(): TracePilotConfig {
    const base = backendConfig ?? createDefaultConfig();
    return {
      ...base,
      paths: { ...base.paths, sessionStateDir: ui.sessionStateDir.value },
      general: { ...base.general, cliCommand: ui.cliCommand.value },
      ui: {
        theme: ui.theme.value,
        hideEmptySessions: ui.hideEmptySessions.value,
        autoRefreshEnabled: ui.autoRefreshEnabled.value,
        autoRefreshIntervalSeconds: ui.autoRefreshIntervalSeconds.value,
        checkForUpdates: ui.checkForUpdates.value,
        favouriteModels: [...ui.favouriteModels.value],
        recentRepoPaths: [...ui.recentRepoPaths.value],
        contentMaxWidth: ui.contentMaxWidth.value,
        uiScale: ui.uiScale.value,
      },
      pricing: {
        costPerPremiumRequest: pricing.costPerPremiumRequest.value,
        models: [...pricing.modelWholesalePrices.value],
      },
      toolRendering: {
        enabled: pricing.toolRendering.value.enabled,
        toolOverrides: { ...pricing.toolRendering.value.toolOverrides },
      },
      features: { ...flags.featureFlags.value } as TracePilotConfig["features"],
      logging: { level: ui.logLevel.value },
      tasks: base.tasks,
      alerts: {
        enabled: alerts.alertsEnabled.value,
        scope: alerts.alertsScope.value,
        nativeNotifications: alerts.alertsNativeNotifications.value,
        taskbarFlash: alerts.alertsTaskbarFlash.value,
        soundEnabled: alerts.alertsSoundEnabled.value,
        onSessionEnd: alerts.alertsOnSessionEnd.value,
        onAskUser: alerts.alertsOnAskUser.value,
        onSessionError: alerts.alertsOnSessionError.value,
        cooldownSeconds: alerts.alertsCooldownSeconds.value,
      },
    };
  }

  // ── Debounced persist to backend ───────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveGuard = useAsyncGuard();

  function scheduleSave() {
    if (!hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    const token = saveGuard.start();
    saveTimer = setTimeout(async () => {
      try {
        // Re-read latest config from backend to avoid overwriting changes
        // made by other components (e.g. SettingsDataStorage paths/autoIndex)
        const freshConfig = await getConfig();
        if (!saveGuard.isValid(token)) return;
        backendConfig = freshConfig;
        const config = buildConfig();
        await saveConfig(config);
        if (!saveGuard.isValid(token)) return;
        backendConfig = config;
      } catch (e) {
        if (!saveGuard.isValid(token)) return;
        logWarn("[preferences] Failed to persist config:", e);
      }
    }, 300);
  }

  // ── Hydrate from backend on store creation ─────────────────
  let hydrateResolve: () => void;
  const hydratePromise = new Promise<void>((resolve) => {
    hydrateResolve = resolve;
  });

  async function hydrate() {
    try {
      // If no config file exists (e.g. after factory reset), don't hydrate.
      // This prevents the watcher from recreating config.toml before the
      // setup wizard has a chance to run.
      const configExists = await checkConfigExists();
      if (!configExists) {
        hydrateResolve();
        return;
      }

      let config = await getConfig();
      const hadLegacyPrefs = !!localStorage.getItem(STORAGE_KEYS.legacyPrefs);
      // One-time migration from localStorage
      if (hadLegacyPrefs) {
        config = migrateFromLocalStorage(config);
        await saveConfig(config);
        // Only clear legacy key after save succeeds
        localStorage.removeItem(STORAGE_KEYS.legacyPrefs);
      }
      backendConfig = config;
      applyConfig(config);
    } catch (e) {
      // Outside Tauri (dev mode) — keep defaults
      logWarn("[preferences] Failed to hydrate config (may be outside Tauri environment)", e);
    }
    hydrated = true;
    hydrateResolve();
  }

  // Fire-and-forget hydration; the watch gate prevents premature saves
  hydrate();

  // ── Persist ephemeral state to localStorage ────────────────
  watch(ui.lastViewedSession, (v) => {
    if (v) localStorage.setItem(STORAGE_KEYS.lastSession, v);
    else localStorage.removeItem(STORAGE_KEYS.lastSession);
  });
  watch(ui.lastSeenVersion, (v) => {
    if (v) localStorage.setItem(STORAGE_KEYS.lastSeenVersion, v);
    else localStorage.removeItem(STORAGE_KEYS.lastSeenVersion);
  });

  // Watch theme changes: update DOM + write-through cache
  watch(ui.theme, (newTheme) => applyTheme(newTheme), { immediate: true });

  // Watch content max-width: update CSS variable
  watch(ui.contentMaxWidth, (v) => applyContentMaxWidth(v), { immediate: true });

  // Watch UI scale: update root font-size
  watch(ui.uiScale, (v) => applyUiScale(v), { immediate: true });

  // Watch all config-backed refs → debounced save to backend
  watch(
    [
      ui.theme,
      ui.sessionStateDir,
      pricing.costPerPremiumRequest,
      pricing.modelWholesalePrices,
      ui.hideEmptySessions,
      ui.cliCommand,
      ui.autoRefreshEnabled,
      ui.autoRefreshIntervalSeconds,
      ui.checkForUpdates,
      pricing.toolRendering,
      flags.featureFlags,
      ui.favouriteModels,
      ui.recentRepoPaths,
      ui.contentMaxWidth,
      ui.uiScale,
      ui.logLevel,
      alerts.alertsEnabled,
      alerts.alertsScope,
      alerts.alertsNativeNotifications,
      alerts.alertsTaskbarFlash,
      alerts.alertsSoundEnabled,
      alerts.alertsOnSessionEnd,
      alerts.alertsOnAskUser,
      alerts.alertsOnSessionError,
      alerts.alertsCooldownSeconds,
    ],
    scheduleSave,
    { deep: true },
  );

  return {
    ...ui,
    ...pricing,
    ...alerts,
    ...flags,
    applyTheme: () => applyTheme(ui.theme.value),
    /** Resolves when config has been loaded from backend. Await before reading config-backed values at startup. */
    whenReady: hydratePromise,
    /** Re-run hydration after the setup wizard creates config.toml.
     *  This arms the auto-save watcher so subsequent preference changes persist. */
    hydrate,
  };
});
