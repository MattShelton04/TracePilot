import { describe, expect, it } from "vitest";
import { computeRulerTicks, formatRulerOffset } from "@/composables/useWaterfallLayout";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const labels = (span: number) => computeRulerTicks(span).map((t) => t.label);

describe("computeRulerTicks", () => {
  it("returns no ticks for an empty or invalid span", () => {
    expect(computeRulerTicks(0)).toEqual([]);
    expect(computeRulerTicks(-5)).toEqual([]);
    expect(computeRulerTicks(Number.NaN)).toEqual([]);
    expect(computeRulerTicks(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("labels a short turn from 0s in whole steps", () => {
    expect(labels(12_000)).toEqual(["0s", "2s", "4s", "6s", "8s", "10s", "12s"]);
    expect(labels(900)).toEqual(["0s", "200ms", "400ms", "600ms", "800ms"]);
  });

  it.each([
    [30 * MINUTE, ["0s", "5m", "10m", "15m", "20m", "25m", "30m"]],
    [2 * HOUR, ["0s", "30m", "1h", "1h 30m", "2h"]],
    [2 * HOUR + 40 * MINUTE, ["0s", "30m", "1h", "1h 30m", "2h", "2h 30m"]],
    [5 * HOUR, ["0s", "1h", "2h", "3h", "4h", "5h"]],
    [11 * HOUR, ["0s", "2h", "4h", "6h", "8h", "10h"]],
  ])("keeps a %d ms turn to a readable set of labels", (span, expected) => {
    expect(labels(span)).toEqual(expected);
  });

  it("never draws more than seven ticks, however long the turn", () => {
    for (let span = 100; span < 30 * 24 * HOUR; span = Math.ceil(span * 1.37)) {
      const ticks = computeRulerTicks(span);
      expect(
        ticks.length,
        `${span} ms: ${ticks.map((t) => t.label).join(", ")}`,
      ).toBeLessThanOrEqual(7);
      expect(ticks.length).toBeGreaterThanOrEqual(1);
      expect(ticks.at(-1)?.leftPct).toBeLessThanOrEqual(100);
    }
  });

  it("places ticks proportionally along the span", () => {
    const ticks = computeRulerTicks(2 * HOUR);
    expect(ticks.map((t) => t.leftPct)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("formatRulerOffset", () => {
  it.each([
    [0, "0s"],
    [500, "500ms"],
    [1_500, "1.5s"],
    [45_000, "45s"],
    [90_000, "1m 30s"],
    [10 * MINUTE, "10m"],
    [HOUR, "1h"],
    [HOUR + 30 * MINUTE, "1h 30m"],
    [26 * HOUR, "26h"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatRulerOffset(ms)).toBe(expected);
  });
});
