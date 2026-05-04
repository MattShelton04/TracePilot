/**
 * Pricing + tool-rendering preferences slice.
 *
 * Owns wholesale-price table, cost-per-premium-request, and per-tool rich-render
 * overrides. All math helpers are pure so they can be reasoned about / tested
 * in isolation.
 */

import type {
  ModelPriceEntry,
  PricingComparisonBreakdown,
  PricingRegistryEntry,
  RichRenderableToolName,
  ShutdownMetrics,
  TokenCostBreakdown,
  ToolRenderingPreferences,
} from "@tracepilot/types";
import {
  calculateObservedAiuCost,
  calculatePricingComparison,
  calculateTokenCost,
  DEFAULT_COST_PER_PREMIUM_REQUEST,
  DEFAULT_TOOL_RENDERING_PREFS,
  getDefaultWholesalePrices,
  modelPriceEntriesToPricingRegistry,
  modelPriceEntryToPricingEntry,
  resolvePricingEntry,
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

  function userPricingRegistry(): PricingRegistryEntry[] {
    return modelPriceEntriesToPricingRegistry(modelWholesalePrices.value);
  }

  /** Look up local wholesale/provider price for a model name. */
  function getWholesalePrice(modelName: string): ModelPriceEntry | undefined {
    const match = resolvePricingEntry(modelName, {
      billingProvider: "provider-wholesale",
      pricingKind: "usage-token-rate",
      rateMode: "latest",
      userOverrides: userPricingRegistry(),
    });
    if (!match) return undefined;
    return modelWholesalePrices.value.find((price) => price.model === match.model);
  }

  /** Compute wholesale cost for a model given token usage. */
  function computeWholesaleCost(
    modelName: string,
    inputTokens: number,
    cacheReadTokens: number,
    outputTokens: number,
    cacheWriteTokens = 0,
  ): number | null {
    const breakdown = computeWholesaleCostBreakdown(
      modelName,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      cacheWriteTokens,
    );
    return breakdown.totalCost;
  }

  function computeWholesaleCostBreakdown(
    modelName: string,
    inputTokens: number,
    cacheReadTokens: number,
    outputTokens: number,
    cacheWriteTokens = 0,
  ): TokenCostBreakdown {
    return calculateTokenCost(
      modelName,
      { inputTokens, cacheReadTokens, outputTokens, cacheWriteTokens },
      {
        billingProvider: "provider-wholesale",
        pricingKind: "usage-token-rate",
        rateMode: "latest",
        userOverrides: userPricingRegistry(),
      },
    );
  }

  function computeUsageBasedCostBreakdown(
    modelName: string,
    inputTokens: number,
    cacheReadTokens: number,
    outputTokens: number,
    cacheWriteTokens = 0,
    at?: string | Date | null,
  ): TokenCostBreakdown {
    return calculateTokenCost(
      modelName,
      { inputTokens, cacheReadTokens, outputTokens, cacheWriteTokens },
      {
        billingProvider: "github-copilot",
        pricingKind: "usage-token-rate",
        at,
      },
    );
  }

  function computeUsageBasedCost(
    modelName: string,
    inputTokens: number,
    cacheReadTokens: number,
    outputTokens: number,
    cacheWriteTokens = 0,
    at?: string | Date | null,
  ): number | null {
    return computeUsageBasedCostBreakdown(
      modelName,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      cacheWriteTokens,
      at,
    ).totalCost;
  }

  function computeCostComparison(
    metrics: ShutdownMetrics,
    at?: string | Date | null,
  ): PricingComparisonBreakdown {
    return calculatePricingComparison(
      metrics,
      costPerPremiumRequest.value,
      userPricingRegistry(),
      at,
    );
  }

  function getObservedAiuCost(totalNanoAiu: number | null | undefined): number | null {
    return calculateObservedAiuCost(totalNanoAiu);
  }

  function getPricingMetadata(
    modelName: string,
    billingProvider: PricingRegistryEntry["billingProvider"] = "provider-wholesale",
  ): PricingRegistryEntry | undefined {
    const localPrice = modelWholesalePrices.value.find((price) => price.model === modelName);
    if (localPrice?.source || localPrice?.status || localPrice?.sourceLabel) {
      return modelPriceEntryToPricingEntry(localPrice, {
        billingProvider,
        status: localPrice.status ?? "user-override",
        sourceLabel: localPrice.sourceLabel ?? "Local settings override",
      });
    }
    return resolvePricingEntry(modelName, {
      billingProvider,
      pricingKind: "usage-token-rate",
      rateMode: "latest",
    });
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
    computeWholesaleCostBreakdown,
    computeUsageBasedCost,
    computeUsageBasedCostBreakdown,
    computeCostComparison,
    getObservedAiuCost,
    getPricingMetadata,
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
