import { describe, expect, it } from "vitest";
import { columnCentre, resample, sampleAt } from "../chartMorph";

describe("chart morph sampling", () => {
  it("places columns by their centre", () => {
    expect(columnCentre(0, 4)).toBe(12.5);
    expect(columnCentre(3, 4)).toBe(87.5);
  });

  it("interpolates between points and holds the ends", () => {
    const points = [
      [10, 0],
      [30, 20],
      [70, 60],
    ] as const;
    expect(sampleAt(points, 20)).toBe(10);
    expect(sampleAt(points, 50)).toBe(40);
    expect(sampleAt(points, 0)).toBe(0);
    expect(sampleAt(points, 100)).toBe(60);
    expect(sampleAt([], 50)).toBe(0);
  });

  it("reads an old series at a new column count", () => {
    expect(resample([10, 20, 30], 3)).toEqual([10, 20, 30]);
    // Five columns sit at 10%, 30% … 90%; two new ones at 25% and 75%.
    expect(resample([0, 25, 50, 75, 100], 2)).toEqual([18.75, 81.25]);
  });
});
