import { describe, expect, it } from "vitest";
import { createPricingSlice, DEFAULT_WHOLESALE_PRICES } from "../pricing";

describe("createPricingSlice", () => {
  it("seeds modelWholesalePrices with a copy of DEFAULT_WHOLESALE_PRICES", () => {
    const slice = createPricingSlice();
    expect(slice.modelWholesalePrices.value.length).toBe(DEFAULT_WHOLESALE_PRICES.length);
    // Mutating the slice must not mutate the shared defaults array.
    slice.modelWholesalePrices.value.push({
      model: "synthetic-test-model",
      inputPerM: 1,
      cachedInputPerM: 0.1,
      outputPerM: 2,
      premiumRequests: 1,
    });
    expect(
      DEFAULT_WHOLESALE_PRICES.find((p) => p.model === "synthetic-test-model"),
    ).toBeUndefined();
  });

  it("getWholesalePrice matches by longest-first substring", () => {
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

  it("computeWholesaleCost subtracts cache reads from input tokens", () => {
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = [
      { model: "test", inputPerM: 10, cachedInputPerM: 1, outputPerM: 20, premiumRequests: 1 },
    ];
    // 1M input, 500k cached, 1M output → 500k*10 + 500k*1 + 1M*20 = 5 + 0.5 + 20 = 25.5
    const cost = slice.computeWholesaleCost("test", 1_000_000, 500_000, 1_000_000);
    expect(cost).toBeCloseTo(25.5);
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

  it("isRichRenderingEnabled short-circuits when the master toggle is off", () => {
    const slice = createPricingSlice();
    slice.toolRendering.value.enabled = false;
    expect(slice.isRichRenderingEnabled("anything")).toBe(false);
    slice.toolRendering.value.enabled = true;
    // Unknown tool → default-on
    expect(slice.isRichRenderingEnabled("anything")).toBe(true);
  });
});
