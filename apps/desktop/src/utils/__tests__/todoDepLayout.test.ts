import type { TodoItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  computeEdgePaths,
  computeLayout,
  computeViewBox,
  DEFAULT_LAYOUT_CONSTANTS,
} from "../todoDepLayout";

function todo(id: string, status: TodoItem["status"] = "pending"): TodoItem {
  return {
    id,
    title: id,
    description: "",
    status,
  } as TodoItem;
}

describe("todoDepLayout.computeLayout", () => {
  it("assigns level 0 to roots and increments along edges", () => {
    const todos = [todo("a"), todo("b"), todo("c")];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const { positions, hasCycle } = computeLayout(todos, edges);
    expect(hasCycle).toBe(false);
    // b should be below a, c below b (strictly increasing y)
    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.b.y).toBeLessThan(positions.c.y);
    // All nodes share the default width/height
    expect(positions.a.w).toBe(DEFAULT_LAYOUT_CONSTANTS.nodeW);
    expect(positions.a.h).toBe(DEFAULT_LAYOUT_CONSTANTS.nodeH);
  });

  it("detects cycles and marks hasCycle=true", () => {
    const todos = [todo("a"), todo("b"), todo("c")];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "b" }, // cycle b ↔ c
    ];
    const { positions, hasCycle } = computeLayout(todos, edges);
    expect(hasCycle).toBe(true);
    // Root 'a' sits above all nodes involved in the cycle
    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.a.y).toBeLessThan(positions.c.y);
    // Every todo is placed somewhere
    expect(Object.keys(positions)).toHaveLength(3);
  });

  it("chunks levels wider than maxPerRow into stacked sub-rows", () => {
    const wide = Array.from({ length: 7 }, (_, i) => todo(`n${i}`));
    const { positions } = computeLayout(wide, []);
    const ys = wide.map((t) => positions[t.id].y);
    const distinctYs = new Set(ys);
    // 7 items with maxPerRow=5 → 2 distinct rows
    expect(distinctYs.size).toBe(2);
  });
});

describe("todoDepLayout.computeViewBox", () => {
  it("returns default box when no positions", () => {
    const vb = computeViewBox({});
    expect(vb).toEqual({ minX: 0, minY: 0, width: 400, height: 200 });
  });

  it("encloses all nodes with padding", () => {
    const vb = computeViewBox({
      a: { x: 0, y: 0, w: 100, h: 50 },
      b: { x: 200, y: 100, w: 100, h: 50 },
    });
    expect(vb.minX).toBe(-30);
    expect(vb.minY).toBe(-20);
    expect(vb.width).toBe(300 + 60);
    expect(vb.height).toBe(150 + 40);
  });
});

describe("todoDepLayout.computeEdgePaths", () => {
  it("skips edges whose endpoints lack positions", () => {
    const paths = computeEdgePaths([{ from: "ghost", to: "b" }], {
      b: { x: 0, y: 0, w: 10, h: 10 },
    });
    expect(paths).toHaveLength(0);
  });

  it("emits a cubic bezier d-attribute for valid edges", () => {
    const paths = computeEdgePaths([{ from: "a", to: "b" }], {
      a: { x: 0, y: 0, w: 10, h: 10 },
      b: { x: 0, y: 40, w: 10, h: 10 },
    });
    expect(paths).toHaveLength(1);
    expect(paths[0].d).toMatch(/^M5,10 C5,/);
    expect(paths[0].id).toBe("edge-0");
  });
});
