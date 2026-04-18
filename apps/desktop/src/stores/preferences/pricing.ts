/**
 * Pricing + tool-rendering preferences slice.
 *
 * Owns wholesale-price table, cost-per-premium-request, and per-tool rich-render
 * overrides. All math helpers are pure so they can be reasoned about / tested
 * in isolation.
 */

import type {
  ModelPriceEntry,
  RichRenderableToolName,
  ToolRenderingPreferences,
} from "@tracepilot/types";
import {
  DEFAULT_COST_PER_PREMIUM_REQUEST,
  DEFAULT_TOOL_RENDERING_PREFS,
  getDefaultWholesalePrices,
} from "@tracepilot/types";
import { ref } from "vue";

// Re-export for backwards compat — consumers that imported ModelWholesalePrice
// now use the shared ModelPriceEntry type from @tracepilot/types.
export type ModelWholesalePrice = ModelPriceEntry;

/** Default wholesale prices for common models ($ per 1M tokens).
 *  Derived from the shared MODEL_REGISTRY in @tracepilot/types. */
export const DEFAULT_WHOLESALE_PRICES: ModelPriceEntry[] = getDefaultWholesalePrices();

export function createPricingSlice() {
  const costPerPremiumRequest = ref(DEFAULT_COST_PER_PREMIUM_REQUEST);
  const modelWholesalePrices = ref<ModelPriceEntry[]>([...DEFAULT_WHOLESALE_PRICES]);
  const toolRendering = ref<ToolRenderingPreferences>({
    enabled: DEFAULT_TOOL_RENDERING_PREFS.enabled,
    toolOverrides: { ...DEFAULT_TOOL_RENDERING_PREFS.toolOverrides },
  });

  /** Look up wholesale price for a model name (fuzzy match on prefix). */
  function getWholesalePrice(modelName: string): ModelPriceEntry | undefined {
    const lower = modelName.toLowerCase();
    const sorted = [...modelWholesalePrices.value].sort((a, b) => b.model.length - a.model.length);
    return (
      sorted.find((p) => lower.includes(p.model.toLowerCase())) ??
      sorted.find((p) => lower.startsWith(p.model.toLowerCase().split("-").slice(0, 2).join("-")))
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
    modelWholesalePrices.value = modelWholesalePrices.value.filter((p) => p.model !== model);
  }

  function resetWholesalePrices() {
    modelWholesalePrices.value = [...DEFAULT_WHOLESALE_PRICES];
  }

  /** Check if rich rendering is enabled for a specific tool. */
  function isRichRenderingEnabled(toolName: string): boolean {
    if (!toolRendering.value.enabled) return false;
    const override = toolRendering.value.toolOverrides[toolName as RichRenderableToolName];
    return override ?? true;
  }

  /** Set the per-tool rendering override. */
  function setToolRenderingOverride(toolName: RichRenderableToolName, enabled: boolean) {
    toolRendering.value.toolOverrides[toolName] = enabled;
  }

  /** Look up premium request multiplier for a model. */
  function getPremiumRequests(modelId: string): number {
    const price = getWholesalePrice(modelId);
    return price?.premiumRequests ?? 1;
  }

  /** Reset tool rendering preferences to defaults. */
  function resetToolRendering() {
    toolRendering.value = {
      enabled: DEFAULT_TOOL_RENDERING_PREFS.enabled,
      toolOverrides: { ...DEFAULT_TOOL_RENDERING_PREFS.toolOverrides },
    };
  }

  return {
    costPerPremiumRequest,
    modelWholesalePrices,
    toolRendering,
    getWholesalePrice,
    computeWholesaleCost,
    addWholesalePrice,
    removeWholesalePrice,
    resetWholesalePrices,
    isRichRenderingEnabled,
    setToolRenderingOverride,
    getPremiumRequests,
    resetToolRendering,
  };
}

export type PricingSlice = ReturnType<typeof createPricingSlice>;
