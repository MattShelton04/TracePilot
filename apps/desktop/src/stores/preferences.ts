import type { RichRenderableToolName, ToolRenderingPreferences } from '@tracepilot/types';
import { DEFAULT_TOOL_RENDERING_PREFS } from '@tracepilot/types';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type ThemeOption = 'dark' | 'light';

/** Per-model wholesale pricing ($ per 1M tokens) */
export interface ModelWholesalePrice {
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  /** Premium request multiplier (e.g. 1x, 3x, 0.33x). 0 = free tier. */
  premiumRequests: number;
}

/** Default wholesale prices for common models ($ per 1M tokens) */
export const DEFAULT_WHOLESALE_PRICES: ModelWholesalePrice[] = [
  {
    model: "claude-sonnet-4.6",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    model: "claude-sonnet-4.5",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    model: "claude-haiku-4.5",
    inputPerM: 1.0,
    cachedInputPerM: 0.1,
    outputPerM: 5.0,
    premiumRequests: 0.33,
  },
  {
    model: "claude-opus-4.6",
    inputPerM: 5.0,
    cachedInputPerM: 0.5,
    outputPerM: 25.0,
    premiumRequests: 3,
  },
  {
    model: "claude-opus-4.6-fast",
    inputPerM: 5.0,
    cachedInputPerM: 0.5,
    outputPerM: 25.0,
    premiumRequests: 30,
  },
  {
    model: "claude-opus-4.5",
    inputPerM: 5.0,
    cachedInputPerM: 0.5,
    outputPerM: 25.0,
    premiumRequests: 3,
  },
  {
    model: "claude-sonnet-4",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    model: "gemini-3-pro-preview",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 16.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.4",
    inputPerM: 2.5,
    cachedInputPerM: 0.25,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.3-codex",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.2-codex",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.2",
    inputPerM: 2.5,
    cachedInputPerM: 0.25,
    outputPerM: 15.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.1-codex-max",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.1-codex",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.1",
    inputPerM: 10.0,
    cachedInputPerM: 1.0,
    outputPerM: 40.0,
    premiumRequests: 1,
  },
  {
    model: "gpt-5.4-mini",
    inputPerM: 0.4,
    cachedInputPerM: 0.04,
    outputPerM: 1.6,
    premiumRequests: 0.33,
  },
  {
    model: "gpt-5.1-codex-mini",
    inputPerM: 0.4,
    cachedInputPerM: 0.04,
    outputPerM: 1.6,
    premiumRequests: 0.33,
  },
  {
    model: "gpt-5-mini",
    inputPerM: 0.4,
    cachedInputPerM: 0.04,
    outputPerM: 1.6,
    premiumRequests: 0,
  },
  {
    model: "gpt-4.1",
    inputPerM: 8.0,
    cachedInputPerM: 0.8,
    outputPerM: 24.0,
    premiumRequests: 0,
  },
];

function applyTheme(theme: ThemeOption) {
  document.documentElement.setAttribute("data-theme", theme);
}

export const usePreferencesStore = defineStore("preferences", () => {
  const theme = ref<ThemeOption>("dark");
  const lastViewedSession = ref<string | null>(null);
  const costPerPremiumRequest = ref(0.04);
  const modelWholesalePrices = ref<ModelWholesalePrice[]>([
    ...DEFAULT_WHOLESALE_PRICES,
  ]);
  const hideEmptySessions = ref(true);
  const cliCommand = ref("copilot");
  const autoRefreshEnabled = ref(false);
  const autoRefreshIntervalSeconds = ref(5);
  const checkForUpdates = ref(false);
  const lastSeenVersion = ref<string | null>(null);
  const toolRendering = ref<ToolRenderingPreferences>({
    enabled: DEFAULT_TOOL_RENDERING_PREFS.enabled,
    toolOverrides: { ...DEFAULT_TOOL_RENDERING_PREFS.toolOverrides },
  });
  const featureFlags = ref<Record<string, boolean>>({
    exportView: false,
    healthScoring: false,
    sessionReplay: false,
  });
  const favouriteModels = ref<string[]>([
    "claude-opus-4.6",
    "gpt-5.4",
    "gpt-5.3-codex",
  ]);
  const recentRepoPaths = ref<string[]>([]);

  // Persist to localStorage
  function load() {
    try {
      const saved = localStorage.getItem("tracepilot-prefs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          parsed.theme &&
          (parsed.theme === "dark" || parsed.theme === "light")
        ) {
          theme.value = parsed.theme;
        }
        // Migrate legacy "system" theme to "dark"
        if (parsed.lastViewedSession)
          lastViewedSession.value = parsed.lastViewedSession;
        if (typeof parsed.costPerPremiumRequest === "number")
          costPerPremiumRequest.value = parsed.costPerPremiumRequest;
        if (Array.isArray(parsed.modelWholesalePrices)) {
          // Migrate: merge saved prices with defaults to backfill premiumRequests
          const saved = parsed.modelWholesalePrices as ModelWholesalePrice[];
          modelWholesalePrices.value = DEFAULT_WHOLESALE_PRICES.map((def) => {
            const existing = saved.find((s) => s.model === def.model);
            if (existing) {
              return {
                ...def,
                ...existing,
                premiumRequests: existing.premiumRequests ?? def.premiumRequests,
              };
            }
            return def;
          });
          // Also include any user-added models not in defaults
          for (const s of saved) {
            if (!DEFAULT_WHOLESALE_PRICES.find((d) => d.model === s.model)) {
              modelWholesalePrices.value.push({ ...s, premiumRequests: s.premiumRequests ?? 1 });
            }
          }
        }
        if (typeof parsed.hideEmptySessions === "boolean")
          hideEmptySessions.value = parsed.hideEmptySessions;
        if (typeof parsed.cliCommand === "string")
          cliCommand.value = parsed.cliCommand;
        if (typeof parsed.autoRefreshEnabled === "boolean")
          autoRefreshEnabled.value = parsed.autoRefreshEnabled;
        if (typeof parsed.autoRefreshIntervalSeconds === "number")
          autoRefreshIntervalSeconds.value = parsed.autoRefreshIntervalSeconds;
        if (typeof parsed.checkForUpdates === "boolean")
          checkForUpdates.value = parsed.checkForUpdates;
        if (typeof parsed.lastSeenVersion === "string")
          lastSeenVersion.value = parsed.lastSeenVersion;
        if (parsed.toolRendering && typeof parsed.toolRendering === "object") {
          toolRendering.value = {
            enabled:
              typeof parsed.toolRendering.enabled === "boolean"
                ? parsed.toolRendering.enabled
                : true,
            toolOverrides: parsed.toolRendering.toolOverrides ?? {},
          };
        }
        if (parsed.featureFlags && typeof parsed.featureFlags === 'object') {
          const savedFlags = parsed.featureFlags as Record<string, unknown>;
          for (const key of Object.keys(featureFlags.value)) {
            if (typeof savedFlags[key] === 'boolean') {
              featureFlags.value[key] = savedFlags[key] as boolean;
            }
          }
        }
        if (Array.isArray(parsed.favouriteModels))
          favouriteModels.value = parsed.favouriteModels;
        if (Array.isArray(parsed.recentRepoPaths))
          recentRepoPaths.value = parsed.recentRepoPaths;
      }
    } catch {
      /* ignore */
    }
  }

  function save() {
    localStorage.setItem(
      "tracepilot-prefs",
      JSON.stringify({
        theme: theme.value,
        lastViewedSession: lastViewedSession.value,
        costPerPremiumRequest: costPerPremiumRequest.value,
        modelWholesalePrices: modelWholesalePrices.value,
        hideEmptySessions: hideEmptySessions.value,
        cliCommand: cliCommand.value,
        autoRefreshEnabled: autoRefreshEnabled.value,
        autoRefreshIntervalSeconds: autoRefreshIntervalSeconds.value,
        checkForUpdates: checkForUpdates.value,
        lastSeenVersion: lastSeenVersion.value,
        toolRendering: toolRendering.value,
        featureFlags: featureFlags.value,
        favouriteModels: favouriteModels.value,
        recentRepoPaths: recentRepoPaths.value,
      }),
    );
  }

  load();

  // Watch theme changes: update DOM
  watch(
    theme,
    (newTheme) => {
      applyTheme(newTheme);
    },
    { immediate: true },
  );

  watch(
    [
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
    ],
    save,
    { deep: true },
  );

  /** Look up wholesale price for a model name (fuzzy match on prefix). */
  function getWholesalePrice(
    modelName: string,
  ): ModelWholesalePrice | undefined {
    const lower = modelName.toLowerCase();
    // Sort candidates by descending model name length so the most specific match wins
    const sorted = [...modelWholesalePrices.value].sort(
      (a, b) => b.model.length - a.model.length,
    );
    return (
      sorted.find((p) => lower.includes(p.model.toLowerCase())) ??
      sorted.find((p) =>
        lower.startsWith(
          p.model.toLowerCase().split("-").slice(0, 2).join("-"),
        ),
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

  function addWholesalePrice(price: ModelWholesalePrice) {
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
