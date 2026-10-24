import { afterEach, describe, expect, it } from "vitest";
import { formatSearchMoment } from "../searchMoment";

describe("formatSearchMoment", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("formats Unix seconds as the local date and time", () => {
    process.env.TZ = "Australia/Brisbane";
    // 23:00 UTC on 22 Oct is 09:00 on 23 Oct in Brisbane (UTC+10).
    const moment = Date.UTC(2026, 9, 22, 23, 0, 0) / 1000;
    const text = formatSearchMoment(moment);
    expect(text).toBe(new Date(moment * 1000).toLocaleString());
    expect(text).toContain("23");
    expect(text).toMatch(/\b0?9:00\b/);
  });

  it("returns an empty string for a missing or unusable moment", () => {
    expect(formatSearchMoment(null)).toBe("");
    expect(formatSearchMoment(undefined)).toBe("");
    expect(formatSearchMoment(Number.NaN)).toBe("");
    expect(formatSearchMoment(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatSearchMoment(1e20)).toBe("");
  });
});
