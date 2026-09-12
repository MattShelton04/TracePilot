import type { ModelPriceEntry } from "@tracepilot/types";

export const WHOLESALE_RATE_FIELDS = [
  "inputPerM",
  "cachedInputPerM",
  "cacheWritePerM",
  "outputPerM",
] as const;
export type WholesaleRateField = (typeof WHOLESALE_RATE_FIELDS)[number];

export function isValidWholesaleRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseWholesaleRate(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const rate = Number(value);
  return isValidWholesaleRate(rate) ? rate : null;
}

export function hasValidWholesaleRates(price: ModelPriceEntry): boolean {
  return (
    Boolean(price.model.trim()) &&
    WHOLESALE_RATE_FIELDS.every(
      (field) =>
        (field === "cacheWritePerM" && price[field] === undefined) ||
        isValidWholesaleRate(price[field]),
    )
  );
}
