import { describe, expect, it } from "vitest";
import { buildActiveTimeCoordinates } from "@/components/context/contextChartScale";

describe("buildActiveTimeCoordinates", () => {
  it("balances known shutdown gaps against the session's active interval", () => {
    const coordinates = buildActiveTimeCoordinates(
      [
        "2026-07-17T00:00:00Z",
        "2026-07-17T00:00:10Z",
        "2026-07-18T00:00:10Z",
        "2026-07-18T00:00:20Z",
      ],
      { breakBeforeIndexes: new Set([2]) },
    );

    expect(coordinates[1] - coordinates[0]).toBe(10_000);
    expect(coordinates[2] - coordinates[1]).toBe(30_000);
    expect(coordinates[3] - coordinates[2]).toBe(10_000);
  });

  it("soft-caps unmarked extreme outliers", () => {
    const coordinates = buildActiveTimeCoordinates([
      "2026-07-17T00:00:00Z",
      "2026-07-17T00:00:10Z",
      "2026-07-18T00:00:10Z",
      "2026-07-18T00:00:20Z",
    ]);

    expect(coordinates[2] - coordinates[1]).toBe(40_000);
  });

  it("does not expand a short shutdown boundary", () => {
    const coordinates = buildActiveTimeCoordinates(
      ["2026-07-17T00:00:00Z", "2026-07-17T00:00:10Z", "2026-07-17T00:00:20Z"],
      { breakBeforeIndexes: new Set([2]) },
    );

    expect(coordinates).toEqual([0, 10_000, 20_000]);
  });

  it("returns stable coordinates when timestamps are missing", () => {
    expect(buildActiveTimeCoordinates([null, null, null])).toEqual([0, 60_000, 120_000]);
  });

  it("keeps simultaneous before and after compaction points aligned", () => {
    expect(
      buildActiveTimeCoordinates([
        "2026-07-17T00:00:00Z",
        "2026-07-17T00:00:10Z",
        "2026-07-17T00:00:10Z",
      ]),
    ).toEqual([0, 10_000, 10_000]);
  });
});
