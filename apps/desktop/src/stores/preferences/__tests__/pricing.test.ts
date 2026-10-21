import { describe, expect, it } from "vitest";
import { createPricingSlice } from "../pricing";

describe("createPricingSlice", () => {
  it("getWholesalePrice matches by longest-first prefix", () => {
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = [
      { model: "gpt-4", inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2, premiumRequests: 1 },
      {
        model: "gpt-4-turbo",
        inputPerM: 3,
        cachedInputPerM: 0.3,
        outputPerM: 4,
        premiumRequests: 2,
      },
    ];
    const match = slice.getWholesalePrice("gpt-4-turbo-2024-04-09");
    expect(match?.model).toBe("gpt-4-turbo");
  });

  it("getWholesalePrice matches explicit aliases without arbitrary substring fallback", () => {
    const slice = createPricingSlice();
    expect(slice.getWholesalePrice("Claude Sonnet 4.6")?.model).toBe("claude-sonnet-4.6");
    expect(slice.getWholesalePrice("not-claude-sonnet-4.6-but-contains-it")).toBeUndefined();
  });

  it("computeWholesaleCost subtracts cache reads from input tokens", () => {
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = [
      { model: "test", inputPerM: 10, cachedInputPerM: 1, outputPerM: 20, premiumRequests: 1 },
    ];
    // 1M input, 500k cached, 1M output → 500k*10 + 500k*1 + 1M*20 = 5 + 0.5 + 20 = 25.5
    const cost = slice.computeWholesaleCost("test", 1_000_000, 500_000, 1_000_000);
    expect(cost).toBeCloseTo(25.5);
  });

  it("computeWholesaleCost includes cache write price when configured", () => {
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = [
      {
        model: "test",
        inputPerM: 10,
        cachedInputPerM: 1,
        cacheWritePerM: 2,
        outputPerM: 20,
        premiumRequests: 1,
      },
    ];
    const cost = slice.computeWholesaleCost("test", 1_000_000, 500_000, 1_000_000, 250_000);
    expect(cost).toBeCloseTo(23.5);
  });

  it("computeUsageBasedCost uses official GitHub rates and returns null for unknown models", () => {
    const slice = createPricingSlice();
    expect(
      slice.computeUsageBasedCost(
        "claude-sonnet-4.6",
        1_000_000,
        400_000,
        200_000,
        100_000,
        "2026-06-01",
      ),
    ).toBeCloseTo(4.995);
    expect(slice.computeUsageBasedCost("unknown-model", 1, 0, 1, 0, "2026-06-01")).toBeNull();
  });

  it("computeUsageBasedCost respects effective dates", () => {
    const slice = createPricingSlice();
    expect(slice.computeUsageBasedCost("gpt-5.4", 1_000_000, 0, 0, 0, "2026-05-31")).toBeNull();
    expect(slice.computeUsageBasedCost("gpt-5.4", 1_000_000, 0, 0, 0, "2026-06-01")).toBe(5);
  });

  it("computeUsageBasedCost uses the latest snapshot when no date is supplied", () => {
    const slice = createPricingSlice();
    expect(slice.computeUsageBasedCost("gpt-5.4", 1_000_000, 0, 0)).toBe(5);
  });

  it("default local token-rate estimates mirror GitHub usage rates for documented models", () => {
    const slice = createPricingSlice();
    expect(slice.computeWholesaleCost("gpt-5.4-mini", 1_000_000, 0, 1_000_000)).toBeCloseTo(5.25);
    expect(slice.computeUsageBasedCost("gpt-5.4-mini", 1_000_000, 0, 1_000_000)).toBeCloseTo(5.25);
  });

  it("local wholesale overrides take precedence over bundled defaults", () => {
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = [
      { model: "gpt-5.5", inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2, premiumRequests: 1 },
    ];
    expect(slice.computeWholesaleCost("GPT-5.5", 100_000, 0, 1_000_000)).toBe(2.1);
  });

  it("converts observed nano AIU to USD using AI Credit units", () => {
    const slice = createPricingSlice();
    expect(slice.getObservedAiuCost(1_000_000_000)).toBe(0.01);
  });

  it("computeWholesaleCost returns null when the model is unknown", () => {
    const slice = createPricingSlice();
    expect(slice.computeWholesaleCost("totally-unknown-model-xyz", 100, 0, 100)).toBeNull();
  });

  it("add/remove/reset round-trips the price list", () => {
    const slice = createPricingSlice();
    const originalCount = slice.modelWholesalePrices.value.length;
    slice.addWholesalePrice({
      model: "custom-x",
      inputPerM: 1,
      cachedInputPerM: 0.1,
      outputPerM: 2,
      premiumRequests: 1,
    });
    expect(slice.modelWholesalePrices.value.length).toBe(originalCount + 1);
    slice.removeWholesalePrice("custom-x");
    expect(slice.modelWholesalePrices.value.find((p) => p.model === "custom-x")).toBeUndefined();
    slice.modelWholesalePrices.value = [];
    slice.resetWholesalePrices();
    expect(slice.modelWholesalePrices.value.length).toBe(originalCount);
  });

  it("refuses a second rate for a listed model, which lookups would never use", () => {
    const slice = createPricingSlice();
    const listed = slice.modelWholesalePrices.value.find((p) => !p.minimumInputTokens);
    if (!listed) throw new Error("No default-context rate listed");
    const before = [...slice.modelWholesalePrices.value];
    const cost = slice.computeWholesaleCost(listed.model, 1_000_000, 0, 0);
    const duplicate = {
      inputPerM: 999,
      cachedInputPerM: 0,
      outputPerM: 0,
      premiumRequests: 1,
      status: "user-override" as const,
    };

    expect(slice.addWholesalePrice({ ...duplicate, model: listed.model })).toBe(false);
    // Case, spaces and a `models/` prefix name the same model.
    const spelled = `models/${listed.model.toUpperCase().replace(/-/g, " ")}`;
    expect(slice.addWholesalePrice({ ...duplicate, model: spelled })).toBe(false);
    expect(slice.modelWholesalePrices.value).toEqual(before);
    expect(slice.computeWholesaleCost(listed.model, 1_000_000, 0, 0)).toBe(cost);

    // A removed default can be added back.
    slice.removeWholesalePrice(listed.model);
    expect(slice.addWholesalePrice({ ...duplicate, model: listed.model })).toBe(true);
    expect(slice.computeWholesaleCost(listed.model, 1_000_000, 0, 0)).toBe(999);
  });

  it("isRichRenderingEnabled short-circuits when the master toggle is off", () => {
    const slice = createPricingSlice();
    slice.toolRendering.value.enabled = false;
    expect(slice.isRichRenderingEnabled("anything")).toBe(false);
    slice.toolRendering.value.enabled = true;
    // Unknown tool → default-on
    expect(slice.isRichRenderingEnabled("anything")).toBe(true);
  });
});
