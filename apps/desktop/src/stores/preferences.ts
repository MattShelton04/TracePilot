import { defineStore } from "pinia";
import { ref, watch, computed } from "vue";

export type ThemeOption = "dark" | "light" | "system";

/** Per-model wholesale pricing ($ per 1M tokens) */
export interface ModelWholesalePrice {
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}

/** Default wholesale prices for common models ($ per 1M tokens) */
export const DEFAULT_WHOLESALE_PRICES: ModelWholesalePrice[] = [
  { model: 'claude-opus-4.6', inputPerM: 5.00, cachedInputPerM: 0.50, outputPerM: 25.00 },
  { model: 'claude-opus-4.5', inputPerM: 5.00, cachedInputPerM: 0.50, outputPerM: 25.00 },
  { model: 'claude-sonnet-4.6', inputPerM: 3.00, cachedInputPerM: 0.30, outputPerM: 15.00 },
  { model: 'claude-sonnet-4.5', inputPerM: 3.00, cachedInputPerM: 0.30, outputPerM: 15.00 },
  { model: 'claude-sonnet-4', inputPerM: 3.00, cachedInputPerM: 0.30, outputPerM: 15.00 },
  { model: 'claude-haiku-4.5', inputPerM: 1.00, cachedInputPerM: 0.10, outputPerM: 5.00 },
  { model: 'gpt-5.4', inputPerM: 20.00, cachedInputPerM: 2.00, outputPerM: 60.00 },
  { model: 'gpt-5.2-codex', inputPerM: 1.75, cachedInputPerM: 0.175, outputPerM: 14.00 },
  { model: 'gpt-5.1-codex', inputPerM: 1.75, cachedInputPerM: 0.175, outputPerM: 14.00 },
  { model: 'gpt-5.1', inputPerM: 10.00, cachedInputPerM: 1.00, outputPerM: 40.00 },
  { model: 'gpt-4.1', inputPerM: 8.00, cachedInputPerM: 0.80, outputPerM: 24.00 },
  { model: 'gemini-3-pro-preview', inputPerM: 10.00, cachedInputPerM: 1.00, outputPerM: 30.00 },
];

function applyTheme(theme: ThemeOption) {
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export const usePreferencesStore = defineStore("preferences", () => {
  const theme = ref<ThemeOption>("dark");
  const lastViewedSession = ref<string | null>(null);
  const costPerPremiumRequest = ref(0.04);
  const modelWholesalePrices = ref<ModelWholesalePrice[]>([...DEFAULT_WHOLESALE_PRICES]);
  const hideEmptySessions = ref(true);
  const cliCommand = ref('copilot');
  let mediaQuery: MediaQueryList | null = null;
  let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;

  // Persist to localStorage
  function load() {
    try {
      const saved = localStorage.getItem("tracepilot-prefs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.theme) theme.value = parsed.theme;
        if (parsed.lastViewedSession) lastViewedSession.value = parsed.lastViewedSession;
        if (typeof parsed.costPerPremiumRequest === 'number') costPerPremiumRequest.value = parsed.costPerPremiumRequest;
        if (Array.isArray(parsed.modelWholesalePrices)) modelWholesalePrices.value = parsed.modelWholesalePrices;
        if (typeof parsed.hideEmptySessions === 'boolean') hideEmptySessions.value = parsed.hideEmptySessions;
        if (typeof parsed.cliCommand === 'string') cliCommand.value = parsed.cliCommand;
      }
    } catch { /* ignore */ }
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
      })
    );
  }

  function setupSystemThemeListener() {
    // Clean up previous listener
    if (mediaQuery && mediaHandler) {
      mediaQuery.removeEventListener("change", mediaHandler);
      mediaHandler = null;
    }

    if (theme.value === "system") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaHandler = () => applyTheme("system");
      mediaQuery.addEventListener("change", mediaHandler);
    }
  }

  load();

  // Watch theme changes: update DOM and manage system listener
  watch(theme, (newTheme) => {
    applyTheme(newTheme);
    setupSystemThemeListener();
  }, { immediate: true });

  watch([theme, lastViewedSession, costPerPremiumRequest, modelWholesalePrices, hideEmptySessions, cliCommand], save, { deep: true });

  /** Look up wholesale price for a model name (fuzzy match on prefix). */
  function getWholesalePrice(modelName: string): ModelWholesalePrice | undefined {
    const lower = modelName.toLowerCase();
    // Sort candidates by descending model name length so the most specific match wins
    const sorted = [...modelWholesalePrices.value].sort((a, b) => b.model.length - a.model.length);
    return sorted.find(p => lower.includes(p.model.toLowerCase()))
      ?? sorted.find(p => lower.startsWith(p.model.toLowerCase().split('-').slice(0, 2).join('-')));
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
    return (nonCachedInput / 1_000_000) * price.inputPerM
      + (cacheReadTokens / 1_000_000) * price.cachedInputPerM
      + (outputTokens / 1_000_000) * price.outputPerM;
  }

  function addWholesalePrice(price: ModelWholesalePrice) {
    modelWholesalePrices.value.push(price);
  }

  function removeWholesalePrice(model: string) {
    modelWholesalePrices.value = modelWholesalePrices.value.filter(p => p.model !== model);
  }

  function resetWholesalePrices() {
    modelWholesalePrices.value = [...DEFAULT_WHOLESALE_PRICES];
  }

  return {
    theme,
    lastViewedSession,
    costPerPremiumRequest,
    modelWholesalePrices,
    hideEmptySessions,
    cliCommand,
    applyTheme:() => applyTheme(theme.value),
    getWholesalePrice,
    computeWholesaleCost,
    addWholesalePrice,
    removeWholesalePrice,
    resetWholesalePrices,
  };
});
