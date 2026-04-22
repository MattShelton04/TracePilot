import { describe, expect, it } from "vitest";
import {
  bezierPath,
  buildAgentTreeLayout,
  DEFAULT_AGENT_TREE_LAYOUT_CONFIG,
} from "../../utils/agentTreeLayout";

interface N {
  id: string;
  children?: N[];
}

describe("agentTreeLayout", () => {
  it("places the root centered at the top of the canvas", () => {
    const root: N = { id: "main" };
    const result = buildAgentTreeLayout(root, []);
    const rootLayout = result.nodes.find((n) => n.node.id === "main")!;
    expect(rootLayout.y).toBe(20);
    // Root is centered horizontally: rootX + rootWidth/2 === totalWidth/2
    expect(rootLayout.x + rootLayout.width / 2).toBe(result.width / 2);
    // No children → no connectors
    expect(result.lines).toEqual([]);
  });

  it("emits one bezier line per parent→child relationship (BFS layered)", () => {
    const root: N = { id: "main" };
    const children: N[] = [{ id: "a", children: [{ id: "a1" }, { id: "a2" }] }, { id: "b" }];
    const result = buildAgentTreeLayout(root, children);
    // main→a, main→b, a→a1, a→a2
    expect(result.lines).toHaveLength(4);
    const parentIds = result.lines.map((l) => l.parentId);
    expect(parentIds).toEqual(expect.arrayContaining(["main", "main", "a", "a"]));
    const childIds = result.lines.map((l) => l.childId);
    expect(new Set(childIds)).toEqual(new Set(["a", "b", "a1", "a2"]));
  });

  it("chunks rows of more than MAX_PER_ROW siblings onto separate rows", () => {
    const siblings: N[] = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}` }));
    const { maxPerRow, childNodeHeight, rowGap } = DEFAULT_AGENT_TREE_LAYOUT_CONFIG;
    expect(maxPerRow).toBe(5);
    const result = buildAgentTreeLayout({ id: "main" } as N, siblings);
    // 7 children → 5 on row 1, 2 on row 2. Row 2 y should be below row 1 by childNodeHeight + rowGap
    const ys = result.nodes
      .filter((n) => n.node.id !== "main")
      .map((n) => n.y)
      .sort((a, b) => a - b);
    const uniqueYs = [...new Set(ys)];
    expect(uniqueYs).toHaveLength(2);
    expect(uniqueYs[1] - uniqueYs[0]).toBe(childNodeHeight + rowGap);
  });

  it("bezierPath produces a SVG path string with a C (cubic) segment", () => {
    const d = bezierPath({ x1: 0, y1: 0, x2: 10, y2: 20, parentId: "p", childId: "c" });
    expect(d).toContain("M 0 0");
    expect(d).toContain("C");
    expect(d).toContain("10 20");
  });

  it("exposes sensible default config constants", () => {
    expect(DEFAULT_AGENT_TREE_LAYOUT_CONFIG.rootWidth).toBe(280);
    expect(DEFAULT_AGENT_TREE_LAYOUT_CONFIG.childWidth).toBe(220);
    expect(DEFAULT_AGENT_TREE_LAYOUT_CONFIG.rowGap).toBe(80);
    expect(DEFAULT_AGENT_TREE_LAYOUT_CONFIG.colGap).toBe(24);
    expect(DEFAULT_AGENT_TREE_LAYOUT_CONFIG.maxPerRow).toBe(5);
  });
});
