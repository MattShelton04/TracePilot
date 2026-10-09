import { describe, expect, it } from "vitest";
import { niceTicks } from "../niceTicks";

describe("niceTicks", () => {
  it.each([
    [1, [0, 1]],
    [3, [0, 1, 2, 3]],
    [5, [0, 1, 2, 3, 4, 5]],
    [7, [0, 2, 4, 6, 8]],
    [12, [0, 2, 4, 6, 8, 10, 12]],
    [150, [0, 50, 100, 150]],
  ])("uses whole-number steps for counts up to %d", (max, expected) => {
    expect(niceTicks(max, { integer: true }).ticks).toEqual(expected);
  });

  it.each([
    [10_000, 2_500, 10_000],
    [130_000, 25_000, 150_000],
    [168_000, 50_000, 200_000],
    [200_000, 50_000, 200_000],
  ])("picks 1/2/2.5/5 steps for token maxima (%d)", (max, step, axisMax) => {
    const axis = niceTicks(max, { integer: true });
    expect(axis.step).toBe(step);
    expect(axis.max).toBe(axisMax);
  });

  it("produces clean fractional ticks without float noise", () => {
    expect(niceTicks(0.5).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(niceTicks(1).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0.7).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("always covers the maximum with evenly spaced ticks from zero", () => {
    for (const integer of [false, true]) {
      for (let max = 0.05; max < 5_000_000; max *= 1.37) {
        const { ticks, step, max: axisMax } = niceTicks(max, { integer });
        expect(ticks[0]).toBe(0);
        expect(axisMax).toBeGreaterThanOrEqual(max - 1e-9);
        expect(ticks.length).toBeGreaterThanOrEqual(2);
        expect(ticks.length).toBeLessThanOrEqual(7);
        if (integer) expect(ticks.every(Number.isInteger)).toBe(true);
        for (const [i, tick] of ticks.entries()) expect(tick).toBeCloseTo(i * step, 9);
      }
    }
  });

  it("keeps tiny fractional maxima distinct", () => {
    expect(niceTicks(0.000002).ticks).toEqual([0, 0.0000005, 0.000001, 0.0000015, 0.000002]);
  });

  it("falls back to a unit axis for empty or invalid maxima", () => {
    expect(niceTicks(0, { integer: true }).ticks).toEqual([0, 1]);
    expect(niceTicks(Number.NaN, { integer: true }).max).toBe(1);
  });
});
