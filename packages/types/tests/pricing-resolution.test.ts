import { describe, expect, it, vi } from "vitest";

// A removed context tier must remain usable historically, never as a latest rate.
vi.mock("../src/pricing-registry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/pricing-registry.js")>();
  const base = {
    model: "test-tier-removal",
    billingProvider: "github-copilot",
    pricingKind: "usage-token-rate",
    currency: "USD",
    unit: "per-1m-tokens",
    status: "official",
    sourceLabel: "test fixture",
    rates: { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2 },
  };
  const latest = { ...base, effectiveFrom: "2026-09-27" };
  const historic = {
    ...base,
    minimumInputTokens: 200001,
    effectiveFrom: "2026-06-01",
    effectiveTo: "2026-09-27",
  };
  return {
    ...original,
    LATEST_PRICING_REGISTRY: [...original.LATEST_PRICING_REGISTRY, latest],
    PRICING_REGISTRY: [...original.PRICING_REGISTRY, latest, historic],
  };
});

import { resolvePricingEntry } from "../src/pricing.js";

describe("safe model price resolution", () => {
  it.each([
    "claude-opus-5.5-fast",
    "gpt-6-sol-mini",
    "gpt-5.4-unpublished",
    "gpt-5.1-codex-new",
  ])("does not price unknown variant %s using a parent model", (model) => {
    expect(resolvePricingEntry(model)).toBeUndefined();
    expect(resolvePricingEntry(model, { billingProvider: "github-copilot" })).toBeUndefined();
  });

  it.each([
    "claude-opus-5.5-20260927",
    "claude-opus-5.5-2026-09-27",
  ])("continues to resolve dated snapshot %s", (model) =>
    expect(resolvePricingEntry(model)?.model).toBe("claude-opus-5.5"));

  it("does not price an unlisted legacy variant through its base model", () => {
    expect(
      resolvePricingEntry("gpt-5.4-nano", {
        billingProvider: "github-copilot",
        pricingKind: "legacy-premium-request",
      }),
    ).toBeUndefined();
  });

  it("excludes superseded tiers from explicit and undated latest lookups", () => {
    const options = { billingProvider: "github-copilot" as const, inputTokens: 300000 };
    expect(resolvePricingEntry("test-tier-removal", options)?.minimumInputTokens).toBeUndefined();
    expect(
      resolvePricingEntry("test-tier-removal", { ...options, rateMode: "latest", at: "2026-08-01" })
        ?.effectiveFrom,
    ).toBe("2026-09-27");
    expect(
      resolvePricingEntry("test-tier-removal", { ...options, at: "2026-08-01" })
        ?.minimumInputTokens,
    ).toBe(200001);
    expect(
      resolvePricingEntry("test-tier-removal", { ...options, at: "2026-09-27" })
        ?.minimumInputTokens,
    ).toBeUndefined();
  });
});
