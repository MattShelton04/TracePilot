import { describe, expect, it } from "vitest";
import {
  type ChartCoord,
  computeBarWidth,
  computeGridLines,
  createChartLayout,
  generateXLabels,
  generateYLabels,
  labelStride,
  mapToLineCoords,
  toAreaPoints,
  toPolylinePoints,
} from "../utils/chartGeometry";

// ── createChartLayout ────────────────────────────────────────────────

describe("createChartLayout", () => {
  it("stores edge coordinates and derives width/height", () => {
    const layout = createChartLayout(50, 680, 30, 200);
    expect(layout).toEqual({
      left: 50,
      right: 680,
      top: 30,
      bottom: 200,
      width: 630,
      height: 170,
    });
  });

  it("handles zero-size layout", () => {
    const layout = createChartLayout(0, 0, 0, 0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});

// ── computeGridLines ─────────────────────────────────────────────────

describe("computeGridLines", () => {
  const layout = createChartLayout(50, 680, 30, 200);

  it("generates grid-line Y positions using count as divisions", () => {
    const lines = computeGridLines(layout, 4);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBeCloseTo(30); // top
    expect(lines[1]).toBeCloseTo(30 + 170 / 4);
    expect(lines[2]).toBeCloseTo(30 + (2 * 170) / 4);
    expect(lines[3]).toBeCloseTo(30 + (3 * 170) / 4);
  });

  it("supports separate count and divisions (e.g. 5 lines across 4 divisions)", () => {
    const lines = computeGridLines(layout, 5, 4);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBeCloseTo(30); // top edge
    expect(lines[4]).toBeCloseTo(200); // bottom edge
  });

  it("returns empty array for count = 0", () => {
    expect(computeGridLines(layout, 0)).toEqual([]);
  });
});

// ── labelStride ──────────────────────────────────────────────────────

describe("labelStride", () => {
  it("returns 1 for small counts", () => {
    expect(labelStride(5)).toBe(1);
    expect(labelStride(10)).toBe(1);
  });

  it("increases stride for larger counts", () => {
    expect(labelStride(20)).toBe(2);
    expect(labelStride(30)).toBe(3);
  });

  it("respects custom maxLabels", () => {
    expect(labelStride(20, 5)).toBe(4);
    expect(labelStride(100, 20)).toBe(5);
  });

  it("never returns less than 1", () => {
    expect(labelStride(0)).toBe(1);
    expect(labelStride(1)).toBe(1);
  });
});

// ── generateYLabels ──────────────────────────────────────────────────

describe("generateYLabels", () => {
  const layout = createChartLayout(55, 490, 20, 175);

  it("generates evenly-spaced labels from 0 to max", () => {
    const labels = generateYLabels(1000, layout, 5, String);
    expect(labels).toHaveLength(5);
    expect(labels[0].value).toBe("0");
    expect(labels[4].value).toBe("1000");
    // Bottom label at chart bottom, top label at chart top
    expect(labels[0].y).toBeCloseTo(175);
    expect(labels[4].y).toBeCloseTo(20);
  });

  it("applies the formatter to each tick value", () => {
    const labels = generateYLabels(100, layout, 3, (v) => `${v}%`);
    expect(labels.map((l) => l.value)).toEqual(["0%", "50%", "100%"]);
  });

  it("handles ticks = 1 without division by zero", () => {
    const labels = generateYLabels(100, layout, 1, String);
    expect(labels).toHaveLength(1);
    expect(labels[0].value).toBe("0");
    expect(labels[0].y).toBe(layout.bottom);
  });

  it("handles 4 ticks (3 divisions) like cost chart", () => {
    const labels = generateYLabels(0.03, layout, 4, (v) => v.toFixed(2));
    expect(labels).toHaveLength(4);
    expect(labels[0].value).toBe("0.00");
    expect(labels[3].value).toBe("0.03");
  });
});

// ── generateXLabels ──────────────────────────────────────────────────

describe("generateXLabels", () => {
  it("generates labels with stride filtering", () => {
    const data = Array.from({ length: 20 }, (_, i) => ({ date: `2024-01-${i + 1}`, x: i * 10 }));
    const labels = generateXLabels(
      data,
      (d) => d.x,
      (d) => d.date,
    );
    // stride = ceil(20 / 10) = 2, so 10 labels
    expect(labels).toHaveLength(10);
    expect(labels[0].label).toBe("2024-01-1");
    expect(labels[0].x).toBe(0);
  });

  it("shows all labels when count <= maxLabels", () => {
    const data = [
      { date: "Jan", x: 0 },
      { date: "Feb", x: 10 },
      { date: "Mar", x: 20 },
    ];
    const labels = generateXLabels(
      data,
      (d) => d.x,
      (d) => d.date,
    );
    expect(labels).toHaveLength(3);
  });

  it("respects custom maxLabels", () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ val: i, pos: i * 5 }));
    const labels = generateXLabels(
      data,
      (d) => d.pos,
      () => "x",
      5,
    );
    // stride = ceil(30/5) = 6, so 5 labels
    expect(labels).toHaveLength(5);
  });

  it("returns empty array for empty data", () => {
    expect(
      generateXLabels(
        [],
        () => 0,
        () => "",
      ),
    ).toEqual([]);
  });
});

// ── mapToLineCoords ──────────────────────────────────────────────────

describe("mapToLineCoords", () => {
  const layout = createChartLayout(50, 680, 30, 200);

  it("maps data points to SVG coordinates", () => {
    const data = [
      { date: "2024-01-01", tokens: 0 },
      { date: "2024-01-02", tokens: 500 },
      { date: "2024-01-03", tokens: 1000 },
    ];
    const coords = mapToLineCoords(data, layout, (d) => d.tokens, 1000);
    expect(coords).toHaveLength(3);
    // First point: left edge, bottom (value = 0)
    expect(coords[0].x).toBeCloseTo(50);
    expect(coords[0].y).toBeCloseTo(200);
    // Last point: right edge, top (value = max)
    expect(coords[2].x).toBeCloseTo(680);
    expect(coords[2].y).toBeCloseTo(30);
    // Preserves original data
    expect(coords[0].date).toBe("2024-01-01");
    expect(coords[0].tokens).toBe(0);
  });

  it("auto-computes max from data when not provided", () => {
    const data = [{ v: 10 }, { v: 20 }, { v: 30 }];
    const coords = mapToLineCoords(data, layout, (d) => d.v);
    // v=30 should be at top
    expect(coords[2].y).toBeCloseTo(layout.top);
    // v=0 would be at bottom, v=10 is 1/3 up
    expect(coords[0].y).toBeCloseTo(layout.bottom - (10 / 30) * layout.height);
  });

  it("returns empty array for empty data", () => {
    expect(mapToLineCoords([], layout, () => 0)).toEqual([]);
  });

  it("handles single data point", () => {
    const coords = mapToLineCoords([{ v: 5 }], layout, (d) => d.v, 10);
    expect(coords).toHaveLength(1);
    expect(coords[0].x).toBeCloseTo(layout.left);
  });

  it("uses floor of 1 for auto-max to avoid division issues with all-zero data", () => {
    const data = [{ v: 0 }, { v: 0 }];
    const coords = mapToLineCoords(data, layout, (d) => d.v);
    // With max=1, all zeros should be at the bottom
    expect(coords[0].y).toBeCloseTo(layout.bottom);
    expect(coords[1].y).toBeCloseTo(layout.bottom);
  });
});

// ── toPolylinePoints ─────────────────────────────────────────────────

describe("toPolylinePoints", () => {
  it("converts coordinates to a points string", () => {
    const coords: ChartCoord[] = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ];
    expect(toPolylinePoints(coords)).toBe("10,20 30,40 50,60");
  });

  it("handles single coordinate", () => {
    expect(toPolylinePoints([{ x: 5, y: 10 }])).toBe("5,10");
  });

  it("handles empty array", () => {
    expect(toPolylinePoints([])).toBe("");
  });
});

// ── toAreaPoints ─────────────────────────────────────────────────────

describe("toAreaPoints", () => {
  const layout = createChartLayout(50, 680, 30, 200);

  it("closes the polygon at bottom-right and bottom-left", () => {
    const coords: ChartCoord[] = [
      { x: 50, y: 100 },
      { x: 365, y: 50 },
      { x: 680, y: 150 },
    ];
    const result = toAreaPoints(coords, layout);
    expect(result).toBe("50,100 365,50 680,150 680,200 50,200");
  });

  it("returns empty string for empty coords", () => {
    expect(toAreaPoints([], layout)).toBe("");
  });
});

// ── computeBarWidth ──────────────────────────────────────────────────

describe("computeBarWidth", () => {
  it("computes bar width from chart width and count", () => {
    // 435 / 10 = 43.5, 43.5 - 2 = 41.5, clamped to max 20
    expect(computeBarWidth(435, 10)).toBe(20);
  });

  it("respects minimum width", () => {
    // Very many bars: 435 / 200 = 2.175, 2.175 - 2 = 0.175, clamped to min 4
    expect(computeBarWidth(435, 200)).toBe(4);
  });

  it("uses custom min/max/gap", () => {
    // 100 / 5 = 20, 20 - 4 = 16, clamped between 8 and 16
    expect(computeBarWidth(100, 5, 8, 16, 4)).toBe(16);
  });

  it("returns min for count <= 0", () => {
    expect(computeBarWidth(435, 0)).toBe(4);
    expect(computeBarWidth(435, -1)).toBe(4);
  });
});
