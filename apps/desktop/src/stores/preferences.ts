import { getConfig, saveConfig } from '@tracepilot/client';
import type {
  ModelPriceEntry,
  RichRenderableToolName,
  ToolRenderingPreferences,
  TracePilotConfig,
} from '@tracepilot/types';
import { DEFAULT_TOOL_RENDERING_PREFS } from '@tracepilot/types';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type ThemeOption = 'dark' | 'light';

// Re-export for backwards compat — consumers that imported ModelWholesalePrice
// now use the shared ModelPriceEntry type from @tracepilot/types.
export type ModelWholesalePrice = ModelPriceEntry;

/** Default wholesale prices for common models ($ per 1M tokens) */
export const DEFAULT_WHOLESALE_PRICES: ModelPriceEntry[] = [
  { model: "claude-sonnet-4.6", inputPerM: 3.0, cachedInputPerM: 0.3, outputPerM: 15.0, premiumRequests: 1 },
  { model: "claude-sonnet-4.5", inputPerM: 3.0, cachedInputPerM: 0.3, outputPerM: 15.0, premiumRequests: 1 },
  { model: "claude-haiku-4.5", inputPerM: 1.0, cachedInputPerM: 0.1, outputPerM: 5.0, premiumRequests: 0.33 },
  { model: "claude-opus-4.6", inputPerM: 5.0, cachedInputPerM: 0.5, outputPerM: 25.0, premiumRequests: 3 },
  { model: "claude-opus-4.6-fast", inputPerM: 5.0, cachedInputPerM: 0.5, outputPerM: 25.0, premiumRequests: 30 },
  { model: "claude-opus-4.5", inputPerM: 5.0, cachedInputPerM: 0.5, outputPerM: 25.0, premiumRequests: 3 },
  { model: "claude-sonnet-4", inputPerM: 3.0, cachedInputPerM: 0.3, outputPerM: 15.0, premiumRequests: 1 },
  { model: "gemini-3-pro-preview", inputPerM: 3.0, cachedInputPerM: 0.3, outputPerM: 16.0, premiumRequests: 1 },
  { model: "gpt-5.4", inputPerM: 2.5, cachedInputPerM: 0.25, outputPerM: 15.0, premiumRequests: 1 },
  { model: "gpt-5.3-codex", inputPerM: 1.75, cachedInputPerM: 0.175, outputPerM: 14.0, premiumRequests: 1 },
  { model: "gpt-5.2-codex", inputPerM: 1.75, cachedInputPerM: 0.175, outputPerM: 14.0, premiumRequests: 1 },
  { model: "gpt-5.2", inputPerM: 2.5, cachedInputPerM: 0.25, outputPerM: 15.0, premiumRequests: 1 },
  { model: "gpt-5.1-codex-max", inputPerM: 1.75, cachedInputPerM: 0.175, outputPerM: 14.0, premiumRequests: 1 },
  { model: "gpt-5.1-codex", inputPerM: 1.75, cachedInputPerM: 0.175, outputPerM: 14.0, premiumRequests: 1 },
  { model: "gpt-5.1", inputPerM: 10.0, cachedInputPerM: 1.0, outputPerM: 40.0, premiumRequests: 1 },
  { model: "gpt-5.4-mini", inputPerM: 0.4, cachedInputPerM: 0.04, outputPerM: 1.6, premiumRequests: 0.33 },
  { model: "gpt-5.1-codex-mini", inputPerM: 0.4, cachedInputPerM: 0.04, outputPerM: 1.6, premiumRequests: 0.33 },
  { model: "gpt-5-mini", inputPerM: 0.4, cachedInputPerM: 0.04, outputPerM: 1.6, premiumRequests: 0 },
  { model: "gpt-4.1", inputPerM: 8.0, cachedInputPerM: 0.8, outputPerM: 24.0, premiumRequests: 0 },
];

function applyTheme(theme: ThemeOption) {
  document.documentElement.setAttribute("data-theme", theme);
  // Write-through cache for instant theme on next launch (no flash)
  localStorage.setItem("tracepilot-theme", theme);
}

export const usePreferencesStore = defineStore("preferences", () => {
  // ── Reactive state ──────────────────────────────────────────

  // Initialize theme from write-through cache to match main.ts (prevents flash)
  const cachedTheme = localStorage.getItem("tracepilot-theme");
  const theme = ref<ThemeOption>(cachedTheme === "light" ? "light" : "dark");
  const hideEmptySessions = ref(true);
  const cliCommand = ref("copilot");
  const autoRefreshEnabled = ref(false);
  const autoRefreshIntervalSeconds = ref(5);
  const checkForUpdates = ref(false);
  const favouriteModels = ref<string[]>(["claude-opus-4.6", "gpt-5.4", "gpt-5.3-codex"]);
  const recentRepoPaths = ref<string[]>([]);
  const costPerPremiumRequest = ref(0.04);
  const modelWholesalePrices = ref<ModelPriceEntry[]>([...DEFAULT_WHOLESALE_PRICES]);
  const toolRendering = ref<ToolRenderingPreferences>({
    enabled: DEFAULT_TOOL_RENDERING_PREFS.enabled,
    toolOverrides: { ...DEFAULT_TOOL_RENDERING_PREFS.toolOverrides },
  });
  const featureFlags = ref<Record<string, boolean>>({
    exportView: false,
    healthScoring: false,
    sessionReplay: false,
  });

  // Ephemeral state — stays in localStorage only
  const lastViewedSession = ref<string | null>(
    localStorage.getItem("tracepilot-last-session"),
  );
  const lastSeenVersion = ref<string | null>(
    localStorage.getItem("tracepilot-last-seen-version"),
  );

  // ── Hydration gate ──────────────────────────────────────────
  // Prevents reactive watches from persisting default values to disk
  // before the real config has been loaded from the backend.
  let hydrated = false;

  // ── Backend reference ───────────────────────────────────────
  // We store the last-known full config so we can merge preference
  // changes back without clobbering paths/version fields.
  let backendConfig: TracePilotConfig | null = null;

  // ── localStorage migration ──────────────────────────────────
  // On first load after upgrade, pull old prefs into config.toml
  // and remove the legacy key.
  function migrateFromLocalStorage(config: TracePilotConfig): TracePilotConfig {
    const raw = localStorage.getItem("tracepilot-prefs");
    if (!raw) return config;

    try {
      const old = JSON.parse(raw);

      // UI section
      if (old.theme === "dark" || old.theme === "light") config.ui.theme = old.theme;
      if (typeof old.hideEmptySessions === "boolean") config.ui.hideEmptySessions = old.hideEmptySessions;
      if (typeof old.autoRefreshEnabled === "boolean") config.ui.autoRefreshEnabled = old.autoRefreshEnabled;
      if (typeof old.autoRefreshIntervalSeconds === "number") config.ui.autoRefreshIntervalSeconds = old.autoRefreshIntervalSeconds;
      if (typeof old.checkForUpdates === "boolean") config.ui.checkForUpdates = old.checkForUpdates;
      if (Array.isArray(old.favouriteModels)) config.ui.favouriteModels = old.favouriteModels;
      if (Array.isArray(old.recentRepoPaths)) config.ui.recentRepoPaths = old.recentRepoPaths;

      // General
      if (typeof old.cliCommand === "string") config.general.cliCommand = old.cliCommand;

      // Pricing
      if (typeof old.costPerPremiumRequest === "number") config.pricing.costPerPremiumRequest = old.costPerPremiumRequest;
      if (Array.isArray(old.modelWholesalePrices)) {
        // Merge with defaults: preserve user customizations, backfill new fields
        const saved = old.modelWholesalePrices as ModelPriceEntry[];
        config.pricing.models = DEFAULT_WHOLESALE_PRICES.map((def) => {
          const existing = saved.find((s) => s.model === def.model);
          return existing ? { ...def, ...existing, premiumRequests: existing.premiumRequests ?? def.premiumRequests } : def;
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
        config.toolRendering.enabled = typeof old.toolRendering.enabled === "boolean" ? old.toolRendering.enabled : true;
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
      if (old.lastViewedSession) localStorage.setItem("tracepilot-last-session", old.lastViewedSession);
      if (old.lastSeenVersion) localStorage.setItem("tracepilot-last-seen-version", old.lastSeenVersion);
    } catch {
      // Corrupt localStorage — leave key in place; it'll be retried next launch
    }

    return config;
  }

  // ── Apply config → reactive refs ───────────────────────────
  function applyConfig(config: TracePilotConfig) {
    theme.value = (config.ui.theme === "light" ? "light" : "dark") as ThemeOption;
    hideEmptySessions.value = config.ui.hideEmptySessions;
    autoRefreshEnabled.value = config.ui.autoRefreshEnabled;
    autoRefreshIntervalSeconds.value = config.ui.autoRefreshIntervalSeconds;
    checkForUpdates.value = config.ui.checkForUpdates;
    favouriteModels.value = [...config.ui.favouriteModels];
    recentRepoPaths.value = [...config.ui.recentRepoPaths];
    cliCommand.value = config.general.cliCommand;
    costPerPremiumRequest.value = config.pricing.costPerPremiumRequest;
    modelWholesalePrices.value = config.pricing.models.length > 0
      ? [...config.pricing.models]
      : [...DEFAULT_WHOLESALE_PRICES];
    toolRendering.value = {
      enabled: config.toolRendering.enabled,
      toolOverrides: { ...config.toolRendering.toolOverrides },
    };
    featureFlags.value = {
      exportView: config.features.exportView,
      healthScoring: config.features.healthScoring,
      sessionReplay: config.features.sessionReplay,
    };
  }

  // ── Build config from reactive state ───────────────────────
  function buildConfig(): TracePilotConfig {
    const base = backendConfig ?? {
      version: 2,
      paths: { sessionStateDir: "", indexDbPath: "" },
      general: { autoIndexOnLaunch: true, cliCommand: "copilot" },
      ui: { theme: "dark", hideEmptySessions: true, autoRefreshEnabled: false, autoRefreshIntervalSeconds: 5, checkForUpdates: false, favouriteModels: [], recentRepoPaths: [] },
      pricing: { costPerPremiumRequest: 0.04, models: [] },
      toolRendering: { enabled: true, toolOverrides: {} },
      features: { exportView: false, healthScoring: false, sessionReplay: false },
    };
    return {
      ...base,
      general: { ...base.general, cliCommand: cliCommand.value },
      ui: {
        theme: theme.value,
        hideEmptySessions: hideEmptySessions.value,
        autoRefreshEnabled: autoRefreshEnabled.value,
        autoRefreshIntervalSeconds: autoRefreshIntervalSeconds.value,
        checkForUpdates: checkForUpdates.value,
        favouriteModels: [...favouriteModels.value],
        recentRepoPaths: [...recentRepoPaths.value],
      },
      pricing: {
        costPerPremiumRequest: costPerPremiumRequest.value,
        models: [...modelWholesalePrices.value],
      },
      toolRendering: {
        enabled: toolRendering.value.enabled,
        toolOverrides: { ...toolRendering.value.toolOverrides },
      },
      features: { ...featureFlags.value } as TracePilotConfig['features'],
    };
  }

  // ── Debounced persist to backend ───────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave() {
    if (!hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        // Re-read latest config from backend to avoid overwriting changes
        // made by other components (e.g. SettingsDataStorage paths/autoIndex)
        const freshConfig = await getConfig();
        backendConfig = freshConfig;
        const config = buildConfig();
        await saveConfig(config);
        backendConfig = config;
      } catch (e) {
        console.warn("[preferences] Failed to persist config:", e);
      }
    }, 300);
  }

  // ── Hydrate from backend on store creation ─────────────────
  let hydrateResolve: () => void;
  const hydratePromise = new Promise<void>((resolve) => { hydrateResolve = resolve; });

  async function hydrate() {
    try {
      let config = await getConfig();
      const hadLegacyPrefs = !!localStorage.getItem("tracepilot-prefs");
      // One-time migration from localStorage
      if (hadLegacyPrefs) {
        config = migrateFromLocalStorage(config);
        await saveConfig(config);
        // Only clear legacy key after save succeeds
        localStorage.removeItem("tracepilot-prefs");
      }
      backendConfig = config;
      applyConfig(config);
    } catch {
      // Outside Tauri (dev mode) — keep defaults
    }
    hydrated = true;
    hydrateResolve();
  }

  // Fire-and-forget hydration; the watch gate prevents premature saves
  hydrate();

  // ── Persist ephemeral state to localStorage ────────────────
  watch(lastViewedSession, (v) => {
    if (v) localStorage.setItem("tracepilot-last-session", v);
    else localStorage.removeItem("tracepilot-last-session");
  });
  watch(lastSeenVersion, (v) => {
    if (v) localStorage.setItem("tracepilot-last-seen-version", v);
    else localStorage.removeItem("tracepilot-last-seen-version");
  });

  // Watch theme changes: update DOM + write-through cache
  watch(theme, (newTheme) => { applyTheme(newTheme); }, { immediate: true });

  // Watch all config-backed refs → debounced save to backend
  watch(
    [
      theme,
      costPerPremiumRequest,
      modelWholesalePrices,
      hideEmptySessions,
      cliCommand,
      autoRefreshEnabled,
      autoRefreshIntervalSeconds,
      checkForUpdates,
      toolRendering,
      featureFlags,
      favouriteModels,
      recentRepoPaths,
    ],
    scheduleSave,
    { deep: true },
  );

  // ── Public API ─────────────────────────────────────────────

  /** Look up wholesale price for a model name (fuzzy match on prefix). */
  function getWholesalePrice(modelName: string): ModelPriceEntry | undefined {
    const lower = modelName.toLowerCase();
    const sorted = [...modelWholesalePrices.value].sort(
      (a, b) => b.model.length - a.model.length,
    );
    return (
      sorted.find((p) => lower.includes(p.model.toLowerCase())) ??
      sorted.find((p) =>
        lower.startsWith(p.model.toLowerCase().split("-").slice(0, 2).join("-")),
      )
    );
  }

  /** Compute wholesale cost for a model given token usage. */
  function computeWholesaleCost(
    modelName: string,
    inputTokens: number,
    cacheReadTokens: number,
    outputTokens: number,
  ): number | null {
    const price = getWholesalePrice(modelName);
    if (!price) return null;
    const nonCachedInput = Math.max(inputTokens - cacheReadTokens, 0);
    return (
      (nonCachedInput / 1_000_000) * price.inputPerM +
      (cacheReadTokens / 1_000_000) * price.cachedInputPerM +
      (outputTokens / 1_000_000) * price.outputPerM
    );
  }

  function addWholesalePrice(price: ModelPriceEntry) {
    modelWholesalePrices.value.push(price);
  }

  function removeWholesalePrice(model: string) {
    modelWholesalePrices.value = modelWholesalePrices.value.filter(
      (p) => p.model !== model,
    );
  }

  function resetWholesalePrices() {
    modelWholesalePrices.value = [...DEFAULT_WHOLESALE_PRICES];
  }

  /** Check if rich rendering is enabled for a specific tool. */
  function isRichRenderingEnabled(toolName: string): boolean {
    if (!toolRendering.value.enabled) return false;
    const override =
      toolRendering.value.toolOverrides[toolName as RichRenderableToolName];
    return override ?? true;
  }

  /** Set the per-tool rendering override. */
  function setToolRenderingOverride(
    toolName: RichRenderableToolName,
    enabled: boolean,
  ) {
    toolRendering.value.toolOverrides[toolName] = enabled;
  }

  /** Look up premium request multiplier for a model. */
  function getPremiumRequests(modelId: string): number {
    const price = getWholesalePrice(modelId);
    return price?.premiumRequests ?? 1;
  }

  /** Add a repo path to recents (max 10, deduped, most recent first). */
  function addRecentRepoPath(path: string) {
    const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
    recentRepoPaths.value = [
      normalized,
      ...recentRepoPaths.value.filter((p) => p !== normalized),
    ].slice(0, 10);
  }

  /** Reset tool rendering preferences to defaults. */
  function resetToolRendering() {
    toolRendering.value = {
      enabled: DEFAULT_TOOL_RENDERING_PREFS.enabled,
      toolOverrides: { ...DEFAULT_TOOL_RENDERING_PREFS.toolOverrides },
    };
  }

  /** Check if a feature flag is enabled. */
  function isFeatureEnabled(flag: string): boolean {
    return featureFlags.value[flag] ?? false;
  }

  /** Toggle a feature flag on or off. */
  function toggleFeature(flag: string): void {
    featureFlags.value[flag] = !featureFlags.value[flag];
  }

  return {
    theme,
    lastViewedSession,
    costPerPremiumRequest,
    modelWholesalePrices,
    hideEmptySessions,
    cliCommand,
    autoRefreshEnabled,
    autoRefreshIntervalSeconds,
    checkForUpdates,
    lastSeenVersion,
    toolRendering,
    featureFlags,
    favouriteModels,
    recentRepoPaths,
    applyTheme: () => applyTheme(theme.value),
    /** Resolves when config has been loaded from backend. Await before reading config-backed values at startup. */
    whenReady: hydratePromise,
    getWholesalePrice,
    getPremiumRequests,
    computeWholesaleCost,
    addWholesalePrice,
    removeWholesalePrice,
    resetWholesalePrices,
    addRecentRepoPath,
    isRichRenderingEnabled,
    setToolRenderingOverride,
    resetToolRendering,
    isFeatureEnabled,
    toggleFeature,
  };
});
