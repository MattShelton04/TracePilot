import { describe, expect, it } from "vitest";
import { placeAnchoredMenu } from "../menuPlacement";

const viewport = { width: 960, height: 640 };
const anchor = (left: number, top: number) => ({ left, top, bottom: top + 16 });

describe("placeAnchoredMenu", () => {
  it("goes below the trigger when it fits", () => {
    expect(placeAnchoredMenu(anchor(100, 100), { width: 300, height: 200 }, viewport)).toEqual({
      x: 100,
      y: 120,
      maxHeight: 360,
    });
  });

  it("goes above the trigger when only that fits", () => {
    const placed = placeAnchoredMenu(anchor(100, 560), { width: 300, height: 200 }, viewport);
    expect(placed).toEqual({ x: 100, y: 356, maxHeight: 360 });
    expect(placed.y + 200).toBeLessThanOrEqual(560);
  });

  it("scrolls on the roomier side when neither fits", () => {
    const short = { width: 960, height: 300 };
    expect(placeAnchoredMenu(anchor(100, 100), { width: 300, height: 500 }, short)).toEqual({
      x: 100,
      y: 120,
      maxHeight: 172,
    });
    expect(placeAnchoredMenu(anchor(100, 200), { width: 300, height: 500 }, short)).toEqual({
      x: 100,
      y: 8,
      maxHeight: 188,
    });
  });

  it("stays inside the right edge", () => {
    expect(placeAnchoredMenu(anchor(800, 100), { width: 400, height: 100 }, viewport).x).toBe(552);
    expect(placeAnchoredMenu(anchor(2, 100), { width: 400, height: 100 }, viewport).x).toBe(8);
  });
});
