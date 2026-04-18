import type { TodoItem } from "@tracepilot/types";

export interface LayoutConstants {
  nodeW: number;
  nodeH: number;
  gapX: number;
  gapY: number;
  subRowGap: number;
  maxPerRow: number;
}

export const DEFAULT_LAYOUT_CONSTANTS: LayoutConstants = {
  nodeW: 170,
  nodeH: 54,
  gapX: 60,
  gapY: 36,
  subRowGap: 16,
  maxPerRow: 5,
};

export interface NodePos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutResult {
  positions: Record<string, NodePos>;
  hasCycle: boolean;
}

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface EdgePath {
  id: string;
  from: string;
  to: string;
  d: string;
}

/**
 * Topological layout (Kahn's algorithm) with chunked sub-rows to avoid
 * excessive horizontal spread. Nodes with no incoming edges sit at level 0.
 * Nodes remaining in a cycle are placed in a separate trailing row.
 */
export function computeLayout(
  todos: TodoItem[],
  edges: LayoutEdge[],
  constants: LayoutConstants = DEFAULT_LAYOUT_CONSTANTS,
): LayoutResult {
  const { nodeW, nodeH, gapX, gapY, subRowGap, maxPerRow } = constants;

  const inDeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  todos.forEach((t) => {
    inDeg[t.id] = 0;
    adj[t.id] = [];
  });
  edges.forEach((e) => {
    if (adj[e.from] === undefined || inDeg[e.to] === undefined) return;
    adj[e.from].push(e.to);
    inDeg[e.to]++;
  });

  const levels: Record<string, number> = {};
  const queue: string[] = [];
  todos.forEach((t) => {
    if (inDeg[t.id] === 0) {
      queue.push(t.id);
      levels[t.id] = 0;
    }
  });

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const next of adj[cur]) {
      levels[next] = Math.max(levels[next] ?? 0, levels[cur] + 1);
      inDeg[next]--;
      if (inDeg[next] === 0) queue.push(next);
    }
  }

  const cycleNodes = todos.filter((t) => levels[t.id] === undefined);
  const detectedCycle = cycleNodes.length > 0;
  const maxLevel = Math.max(0, ...Object.values(levels));
  const cycleLevel = cycleNodes.length > 0 ? maxLevel + 1 : maxLevel;
  cycleNodes.forEach((t) => {
    levels[t.id] = cycleLevel;
  });

  const byLevel: Record<number, TodoItem[]> = {};
  todos.forEach((t) => {
    const lv = levels[t.id] ?? 0;
    if (!byLevel[lv]) byLevel[lv] = [];
    byLevel[lv].push(t);
  });

  const effectiveMax = cycleNodes.length > 0 ? cycleLevel : maxLevel;
  const positions: Record<string, NodePos> = {};

  let cumulativeY = 0;
  for (let lv = 0; lv <= effectiveMax; lv++) {
    const items = byLevel[lv] || [];
    if (items.length === 0) {
      cumulativeY += nodeH + gapY;
      continue;
    }

    const subRows: TodoItem[][] = [];
    for (let i = 0; i < items.length; i += maxPerRow) {
      subRows.push(items.slice(i, i + maxPerRow));
    }

    subRows.forEach((row, rowIdx) => {
      const totalW = row.length * nodeW + (row.length - 1) * gapX;
      const startX = -totalW / 2;
      row.forEach((t, i) => {
        positions[t.id] = {
          x: startX + i * (nodeW + gapX),
          y: cumulativeY + rowIdx * (nodeH + subRowGap),
          w: nodeW,
          h: nodeH,
        };
      });
    });

    const levelHeight = subRows.length * nodeH + (subRows.length - 1) * subRowGap;
    cumulativeY += levelHeight + gapY;
  }

  return { positions, hasCycle: detectedCycle };
}

export function computeViewBox(positions: Record<string, NodePos>): ViewBox {
  const list = Object.values(positions);
  if (list.length === 0) return { minX: 0, minY: 0, width: 400, height: 200 };
  const minX = Math.min(...list.map((p) => p.x)) - 30;
  const maxX = Math.max(...list.map((p) => p.x + p.w)) + 30;
  const minY = Math.min(...list.map((p) => p.y)) - 20;
  const maxY = Math.max(...list.map((p) => p.y + p.h)) + 20;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Build cubic Bezier path data between laid-out nodes. The last control
 * point retains a horizontal offset so the arrow tangent reflects the
 * approach angle rather than always pointing straight down.
 */
export function computeEdgePaths(
  edges: LayoutEdge[],
  positions: Record<string, NodePos>,
): EdgePath[] {
  const out: EdgePath[] = [];
  edges.forEach((e, i) => {
    const from = positions[e.from];
    const to = positions[e.to];
    if (!from || !to) return;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const cy1 = y1 + (y2 - y1) * 0.4;
    const cy2 = y1 + (y2 - y1) * 0.6;
    const cx2 = x2 + (x1 - x2) * 0.25;
    out.push({
      id: `edge-${i}`,
      from: e.from,
      to: e.to,
      d: `M${x1},${y1} C${x1},${cy1} ${cx2},${cy2} ${x2},${y2}`,
    });
  });
  return out;
}
