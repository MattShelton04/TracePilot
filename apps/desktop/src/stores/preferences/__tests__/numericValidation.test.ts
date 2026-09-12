import { describe, expect, it } from "vitest";
import { createPricingSlice } from "../pricing";
import { parseWholesaleRate } from "../pricingValidation";
import { MAX_CONTENT_MAX_WIDTH, normalizeContentMaxWidth } from "../ui";

describe("numeric preference boundaries", () => {
  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    " ",
    undefined,
    null,
  ])("rejects invalid pricing value %j", (value) => expect(parseWholesaleRate(value)).toBeNull());
  it("keeps zero and decimal rates valid", () => {
    expect(parseWholesaleRate(0)).toBe(0);
    expect(parseWholesaleRate("0.00001")).toBe(0.00001);
  });
  it("guards both pricing mutations before invalid data reaches autosave", () => {
    const slice = createPricingSlice();
    const price = {
      model: "audit-rate",
      inputPerM: 1,
      cachedInputPerM: 0,
      outputPerM: 2,
      premiumRequests: 1,
    };
    const count = slice.modelWholesalePrices.value.length;
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(slice.addWholesalePrice({ ...price, inputPerM: value })).toBe(false);
    }
    expect(slice.modelWholesalePrices.value).toHaveLength(count);
    expect(slice.addWholesalePrice(price)).toBe(true);
    const stored = slice.modelWholesalePrices.value.at(-1)!;
    expect(slice.updateWholesaleRate(stored, "inputPerM", -1)).toBe(false);
    expect(slice.updateWholesaleRate(stored, "inputPerM", "")).toBe(false);
    expect(stored.inputPerM).toBe(1);
    expect(slice.updateWholesaleRate(stored, "inputPerM", 0)).toBe(true);
    expect(stored.inputPerM).toBe(0);
  });
  it("normalizes content width to the shared runtime and backend range", () => {
    expect(normalizeContentMaxWidth(0)).toBe(0);
    expect(normalizeContentMaxWidth(1)).toBe(400);
    expect(normalizeContentMaxWidth(-1)).toBe(400);
    expect(normalizeContentMaxWidth(1600.6)).toBe(1601);
    expect(normalizeContentMaxWidth(Number.NaN)).toBe(1600);
    expect(normalizeContentMaxWidth(Number.POSITIVE_INFINITY)).toBe(1600);
    expect(normalizeContentMaxWidth(MAX_CONTENT_MAX_WIDTH + 1)).toBe(MAX_CONTENT_MAX_WIDTH);
  });
});
