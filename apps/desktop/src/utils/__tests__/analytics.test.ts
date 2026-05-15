import { describe, expect, it } from "vitest";
import { type HeatmapEntry, localizeHeatmap } from "../analytics";

describe("localizeHeatmap", () => {
  it("returns a 7×24 zero grid for empty input", () => {
    const grid = localizeHeatmap([], 0);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid.flat().every((v) => v === 0)).toBe(true);
  });

  it("leaves entries unchanged at UTC offset 0", () => {
    const entries: HeatmapEntry[] = [
      { day: 2, hour: 9, count: 3 },
      { day: 5, hour: 23, count: 1 },
    ];
    const grid = localizeHeatmap(entries, 0);
    expect(grid[2][9]).toBe(3);
    expect(grid[5][23]).toBe(1);
  });

  it("handles positive offset (Sydney, +10:00) wrapping across midnight", () => {
    // UTC hour 16 on Monday (day=1) → 02:00 Tuesday (day=2) in Sydney.
    const grid = localizeHeatmap([{ day: 1, hour: 16, count: 7 }], 600);
    expect(grid[2][2]).toBe(7);
    expect(grid[1][16]).toBe(0);

    // UTC hour 5 on Sunday (day=0) → 15:00 same Sunday.
    const grid2 = localizeHeatmap([{ day: 0, hour: 5, count: 4 }], 600);
    expect(grid2[0][15]).toBe(4);
  });

  it("handles negative offset (Los Angeles, -08:00) wrapping back a day", () => {
    // UTC hour 3 on Wednesday (day=3) → 19:00 Tuesday (day=2) in LA standard time.
    const grid = localizeHeatmap([{ day: 3, hour: 3, count: 5 }], -480);
    expect(grid[2][19]).toBe(5);
    expect(grid[3][3]).toBe(0);

    // Sunday → previous Saturday (wrap to day 6).
    const grid2 = localizeHeatmap([{ day: 0, hour: 2, count: 9 }], -480);
    expect(grid2[6][18]).toBe(9);
  });

  it("respects the DST transition on 2024-03-10 (EST → EDT)", () => {
    // 2024-03-10 06:00 UTC = 02:00 EST (before "spring forward"),
    //                       or 02:00 EDT after — but the wall-clock 02:00 is
    //                       skipped, so the post-DST mapping reflects the
    //                       new offset (-240) and lands at 02:00 local.
    const sundayHourUtc: HeatmapEntry = { day: 0, hour: 6, count: 2 };

    const preDst = localizeHeatmap([sundayHourUtc], -300); // EST
    expect(preDst[0][1]).toBe(2); // 06:00 UTC − 5h = 01:00 local

    const postDst = localizeHeatmap([sundayHourUtc], -240); // EDT
    expect(postDst[0][2]).toBe(2); // 06:00 UTC − 4h = 02:00 local
    // The two offsets yield different local hours — DST is honored.
    expect(preDst[0][2]).toBe(0);
    expect(postDst[0][1]).toBe(0);
  });

  it("accumulates counts at the same local slot", () => {
    const grid = localizeHeatmap(
      [
        { day: 1, hour: 16, count: 2 },
        { day: 1, hour: 16, count: 5 },
      ],
      600,
    );
    expect(grid[2][2]).toBe(7);
  });

  it("ignores out-of-range entries", () => {
    const grid = localizeHeatmap(
      [
        { day: -1, hour: 5, count: 9 },
        { day: 7, hour: 5, count: 9 },
        { day: 0, hour: 24, count: 9 },
        { day: 0, hour: -1, count: 9 },
      ],
      0,
    );
    expect(grid.flat().every((v) => v === 0)).toBe(true);
  });
});
