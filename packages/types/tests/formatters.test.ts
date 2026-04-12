import { describe, expect, it } from "vitest";
import { formatLiveDuration } from "../src/utils/formatters.js";

describe("formatLiveDuration", () => {
  it("should return empty string for null or undefined", () => {
    expect(formatLiveDuration(null)).toBe("");
    expect(formatLiveDuration(undefined)).toBe("");
  });

  it("should return empty string for non-finite values", () => {
    expect(formatLiveDuration(NaN)).toBe("");
    expect(formatLiveDuration(Infinity)).toBe("");
    expect(formatLiveDuration(-Infinity)).toBe("");
  });

  it("should return empty string for negative values", () => {
    expect(formatLiveDuration(-100)).toBe("");
    expect(formatLiveDuration(-1000)).toBe("");
  });

  it("should format values under 1000ms as 0ms after flooring", () => {
    expect(formatLiveDuration(0)).toBe("0ms");
    expect(formatLiveDuration(500)).toBe("0ms");
    expect(formatLiveDuration(999)).toBe("0ms");
  });

  it("should floor to nearest whole second", () => {
    expect(formatLiveDuration(1000)).toBe("1s");
    expect(formatLiveDuration(1500)).toBe("1s");
    expect(formatLiveDuration(1999)).toBe("1s");
    expect(formatLiveDuration(2000)).toBe("2s");
  });

  it("should handle larger durations properly based on formatDuration logic", () => {
    // 60000ms = 1m
    expect(formatLiveDuration(60000)).toBe("1m 0s");
    expect(formatLiveDuration(65432)).toBe("1m 5s"); // floored to 65000

    // 3600000ms = 1h
    expect(formatLiveDuration(3600000)).toBe("1h 0m");
    expect(formatLiveDuration(3665432)).toBe("1h 1m"); // floored to 3665000 = 1h 1m 5s but formatDuration returns "1h 1m" for hours > 0
  });
});
