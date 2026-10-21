import { describe, expect, it, vi } from "vitest";
import {
  formatAiCredits,
  formatAiCreditsUsd,
  formatBytes,
  formatDuration,
  formatLiveDuration,
  formatNumber,
  formatTime,
} from "../src/utils/formatters.js";

// A value that rounds up to a whole next unit reads in that unit, never
// "1000K", "1024 KB" or "60s".
describe("unit boundaries", () => {
  it("formatNumber carries 1000 of a unit into the next", () => {
    expect(formatNumber(999_949)).toBe("999.9K");
    expect(formatNumber(999_960)).toBe("1M");
    expect(formatNumber(-999_960)).toBe("-1M");
    expect(formatNumber(999_960_000)).toBe("1B");
    expect(formatNumber(999_999_000_000)).toBe("1000B"); // no unit above B
  });

  it("formatDuration carries a rounded-up second or minute", () => {
    expect(formatDuration(999.99)).toBe("999.99ms");
    expect(formatDuration(999.996)).toBe("1s");
    expect(formatDuration(59_949)).toBe("59.9s");
    expect(formatDuration(59_960)).toBe("1m 0s");
    // Minutes and hours floor, so they never round up into the next unit.
    expect(formatDuration(3_599_999)).toBe("59m 59s");
  });

  it("formatBytes carries 1024 of a unit into the next", () => {
    expect(formatBytes(1_048_500)).toBe("1023.9 KB");
    expect(formatBytes(1_048_575)).toBe("1 MB");
    expect(formatBytes(1023.6)).toBe("1 KB");
    expect(formatBytes(1_073_741_000)).toBe("1 GB");
  });
});

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

describe("formatTime", () => {
  it("matches Date.toLocaleTimeString across boundary dates and invalid or missing input", () => {
    const dates = [
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T23:59:59.999Z",
      "2026-10-04T01:59:59+10:00",
      "2026-10-04T03:00:00+11:00",
      "2026-04-05T02:59:59+11:00",
      "2026-04-05T02:00:00+10:00",
    ];

    for (const date of dates) {
      expect(formatTime(date)).toBe(new Date(date).toLocaleTimeString([], TIME_OPTIONS));
    }
    expect(formatTime("not-a-date")).toBe(
      new Date("not-a-date").toLocaleTimeString([], TIME_OPTIONS),
    );
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime("")).toBe("");
  });

  it("constructs once per synchronous batch and refreshes after the next microtask", async () => {
    await Promise.resolve();
    const realDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeFormatSpy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function DateTimeFormatSpy(locales, options) {
        return new realDateTimeFormat(locales, options);
      });
    try {
      formatTime("2026-01-01T00:00:00.000Z");
      formatTime("2026-01-01T00:00:01.000Z");
      formatTime("2026-01-01T00:00:02.000Z");
      expect(dateTimeFormatSpy).toHaveBeenCalledTimes(1);

      await new Promise<void>((resolve) => queueMicrotask(resolve));
      formatTime("2026-01-01T00:00:03.000Z");
      expect(dateTimeFormatSpy).toHaveBeenCalledTimes(2);
    } finally {
      dateTimeFormatSpy.mockRestore();
    }
  });
});

describe("formatAiCredits", () => {
  it("preserves useful precision and labels the unit", () => {
    expect(formatAiCredits(0.1254)).toBe("0.125 AIC");
    expect(formatAiCredits(0.0004)).toBe("0.0004 AIC");
    expect(formatAiCredits(12.345)).toBe("12.35 AIC");
    expect(formatAiCredits(123.456)).toBe("123.5 AIC");
    expect(formatAiCredits(1_234.56)).toBe("1,235 AIC");
    expect(formatAiCredits(123_456.78)).toBe("123,457 AIC");
    expect(formatAiCredits(null)).toBe("—");
  });
});

describe("formatAiCreditsUsd", () => {
  it("reads AI Credits in USD at $0.01 each, never a sub-cent cost as $0.00", () => {
    expect(formatAiCreditsUsd(111_123_141.341)).toBe("$1,111,231.41");
    expect(formatAiCreditsUsd(160)).toBe("$1.60");
    expect(formatAiCreditsUsd(0.5)).toBe("$0.01");
    expect(formatAiCreditsUsd(0.4)).toBe("< $0.01");
    expect(formatAiCreditsUsd(0)).toBe("$0.00");
    expect(formatAiCreditsUsd(null)).toBe("—");
    expect(formatAiCreditsUsd(undefined)).toBe("—");
    expect(formatAiCreditsUsd(Number.NaN)).toBe("—");
  });
});

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
