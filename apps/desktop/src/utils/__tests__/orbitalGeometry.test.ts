import { describe, expect, it } from "vitest";
import {
  angularSpeedFor,
  assignLane,
  computeOrbitalPos,
  computeScaleFactor,
  ellipseCircumference,
  LANES,
  randomStartAngle,
  speedJitter,
  truncateMiddle,
} from "../orbitalGeometry";

describe("orbitalGeometry.assignLane", () => {
  it("returns 0 for small token counts (inner lane)", () => {
    expect(assignLane(0)).toBe(0);
    expect(assignLane(1_000)).toBe(0);
    expect(assignLane(LANES[0].tokenMax)).toBe(0);
  });

  it("returns 1 for mid-range token counts", () => {
    expect(assignLane(LANES[0].tokenMax + 1)).toBe(1);
    expect(assignLane(LANES[1].tokenMax)).toBe(1);
  });

  it("returns the outer lane for massive token counts", () => {
    expect(assignLane(Number.MAX_SAFE_INTEGER)).toBe(LANES.length - 1);
  });
});

describe("orbitalGeometry.computeOrbitalPos", () => {
  it("places angle=0 to the right of centre on an untilted lane", () => {
    const flat = { rx: 100, ry: 50, period: 10, tiltDeg: 0, tokenMax: Infinity } as const;
    const pos = computeOrbitalPos(0, flat, 500, 300, 1);
    expect(pos.x).toBeCloseTo(600);
    expect(pos.y).toBeCloseTo(300);
  });

  it("returns the centre for a zero-radius lane", () => {
    const tiny = { rx: 0, ry: 0, period: 10, tiltDeg: 30, tokenMax: Infinity } as const;
    const pos = computeOrbitalPos(Math.PI / 3, tiny, 100, 200, 1);
    expect(pos.x).toBeCloseTo(100);
    expect(pos.y).toBeCloseTo(200);
  });

  it("scales the radii by the passed scale factor", () => {
    const lane = { rx: 100, ry: 50, period: 10, tiltDeg: 0, tokenMax: Infinity } as const;
    const pos = computeOrbitalPos(0, lane, 0, 0, 2);
    expect(pos.x).toBeCloseTo(200);
    expect(pos.y).toBeCloseTo(0);
  });
});

describe("orbitalGeometry.truncateMiddle", () => {
  it("leaves short strings untouched", () => {
    expect(truncateMiddle("abc", 10)).toBe("abc");
  });

  it("inserts an ellipsis and preserves both ends", () => {
    const out = truncateMiddle("prefix-middle-very-long-suffix", 12);
    expect(out.length).toBe(12);
    expect(out).toContain("…");
    expect(out.startsWith("p")).toBe(true);
    expect(out.endsWith("x")).toBe(true);
  });
});

describe("orbitalGeometry.computeScaleFactor", () => {
  it("caps the scale at 1.35 for very large viewports", () => {
    expect(computeScaleFactor(10_000, 10_000)).toBe(1.35);
  });

  it("scales down when the viewport is smaller than the design size", () => {
    expect(computeScaleFactor(480, 320)).toBeCloseTo(0.5);
  });
});

describe("orbitalGeometry.ellipseCircumference", () => {
  it("uses 2πr where r is the larger of rx/ry times scale", () => {
    const lane = { rx: 100, ry: 50, period: 10, tiltDeg: 0, tokenMax: Infinity } as const;
    expect(ellipseCircumference(lane, 1)).toBeCloseTo(Math.PI * 2 * 100);
    expect(ellipseCircumference(lane, 0.5)).toBeCloseTo(Math.PI * 2 * 50);
  });
});

describe("orbitalGeometry.angularSpeedFor", () => {
  it("computes 2π / period", () => {
    const lane = { rx: 10, ry: 10, period: 4, tiltDeg: 0, tokenMax: Infinity } as const;
    expect(angularSpeedFor(lane)).toBeCloseTo(Math.PI / 2);
  });
});

describe("orbitalGeometry.randomStartAngle / speedJitter", () => {
  it("randomStartAngle stays within [0, 2π)", () => {
    const fixed = randomStartAngle(() => 0.25);
    expect(fixed).toBeCloseTo(Math.PI / 2);
  });

  it("speedJitter stays in the 0.85–1.15 band", () => {
    expect(speedJitter(() => 0)).toBeCloseTo(0.85);
    expect(speedJitter(() => 0.999)).toBeLessThan(1.15);
    expect(speedJitter(() => 0.999)).toBeGreaterThan(1.14);
  });
});
