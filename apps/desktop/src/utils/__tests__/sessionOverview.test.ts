import { describe, expect, it } from "vitest";
import {
  activityBinCount,
  activityWindow,
  binTurnStarts,
  clusterMarkers,
  countIncidents,
  groupByFolder,
  relativeToRoot,
  splitSessionTime,
} from "../sessionOverview";

describe("activityWindow", () => {
  it("widens the recorded span to every turn start", () => {
    expect(activityWindow(1_000_000, 2_000_000, [900_000, null, 2_500_000])).toEqual({
      start: 900_000,
      end: 2_500_000,
    });
  });

  it("gives a single instant a minute of width", () => {
    expect(activityWindow(5_000, 5_000, [])).toEqual({ start: 5_000, end: 65_000 });
  });

  it("is null with no times at all", () => {
    expect(activityWindow(null, null, [null])).toBeNull();
  });
});

describe("binTurnStarts", () => {
  const window = { start: 0, end: 100 };

  it("counts each start into its bin and keeps the end in the last bin", () => {
    expect(binTurnStarts([0, 10, 24, 50, 100, null], window, 4)).toEqual([3, 0, 1, 1]);
  });

  it("clamps starts outside the window to the edge bins", () => {
    expect(binTurnStarts([-5, 120], window, 2)).toEqual([1, 1]);
  });

  it.each([
    [2, 16],
    [60, 40],
    [900, 48],
  ])("uses a sensible bin count for %d turns", (turns, bins) => {
    expect(activityBinCount(turns)).toBe(bins);
  });
});

describe("clusterMarkers", () => {
  const window = { start: 0, end: 1_000 };

  it("folds close markers together and keeps the most severe kind", () => {
    const clusters = clusterMarkers(
      [
        { kind: "compaction", at: 500, label: "c" },
        { kind: "resume", at: 100, label: "r" },
        { kind: "error", at: 510, label: "e" },
        { kind: "snapshot", at: 900, label: "s" },
      ],
      window,
    );
    expect(clusters.map((c) => [c.pct, c.kind, c.markers.length])).toEqual([
      [10, "resume", 1],
      [50, "error", 2],
      [90, "snapshot", 1],
    ]);
  });
});

describe("relativeToRoot", () => {
  it("strips a matching root, ignoring case and separator style", () => {
    expect(relativeToRoot("c:/git/TracePilot/docs/a.md", ["C:\\git\\TracePilot"])).toBe(
      "docs/a.md",
    );
  });

  it("leaves paths outside every root alone", () => {
    expect(relativeToRoot("/tmp/x.rs", ["/home/me/repo", null])).toBe("/tmp/x.rs");
  });
});

describe("groupByFolder", () => {
  it("groups two folders deep, then one, then the root, largest first", () => {
    const groups = groupByFolder(
      [
        "/repo/packages/types/a.ts",
        "/repo/packages/types/b.ts",
        "/repo/docs/x.md",
        "/repo/CHANGELOG.md",
        "/repo/packages/types/a.ts",
      ],
      ["/repo"],
    );
    expect(groups.map((g) => [g.folder, g.files.length])).toEqual([
      ["packages/types/", 2],
      ["(root)", 1],
      ["docs/", 1],
    ]);
  });

  it("keeps absolute paths outside every root in one group", () => {
    const groups = groupByFolder(
      ["C:\\Users\\me\\.claude\\notes.md", "/home/me/x.md", "C:\\repo\\src\\main.ts"],
      ["C:\\repo"],
    );
    expect(groups.map((g) => [g.folder, g.files.length])).toEqual([
      ["(elsewhere)", 2],
      ["src/", 1],
    ]);
  });
});

describe("splitSessionTime", () => {
  it("divides the span between the model, tools and everything else", () => {
    const split = splitSessionTime(1_000, 300, 200);
    expect(split).toMatchObject({ model: 0.3, tools: 0.2, overlapped: false });
    expect(split?.other).toBeCloseTo(0.5);
  });

  it("caps overlapping parallel time at the span", () => {
    expect(splitSessionTime(1_000, 900, 400)).toMatchObject({
      model: 0.9,
      other: 0,
      overlapped: true,
    });
  });

  it("is null without model time", () => {
    expect(splitSessionTime(1_000, null, 200)).toBeNull();
  });
});

describe("countIncidents", () => {
  it("splits rate limits out of errors", () => {
    expect(
      countIncidents([
        { eventType: "error", summary: "Rate limit hit", detailJson: { errorType: "rate_limit" } },
        { eventType: "error", summary: "boom" },
        { eventType: "warning", summary: "w" },
        { eventType: "compaction", summary: "c" },
        { eventType: "compaction", summary: "c" },
        { eventType: "truncation", summary: "t" },
      ]),
    ).toEqual({ errors: 1, rateLimits: 1, warnings: 1, compactions: 2, truncations: 1, total: 6 });
  });
});
