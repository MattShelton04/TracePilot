/**
 * Pure layout algorithm for the horizontal agent tree.
 *
 * Given a root + hierarchical `AgentNode`-shaped input, produces absolute
 * positions for every node plus bezier connector lines between parents and
 * children. Extracted from `AgentTreeView.vue` (Wave 37) so the layout math
 * can be tested in isolation and reused by child components.
 */

export interface AgentTreeLayoutNode<N> {
  node: N;
  x: number;
  y: number;
  width: number;
}

export interface AgentTreeSvgLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  parentId: string;
  childId: string;
}

export interface AgentTreeLayoutResult<N> {
  nodes: AgentTreeLayoutNode<N>[];
  lines: AgentTreeSvgLine[];
  width: number;
  height: number;
}

export interface LayoutNodeInput {
  id: string;
  children?: LayoutNodeInput[];
}

export interface AgentTreeLayoutConfig {
  rootWidth: number;
  childWidth: number;
  rowGap: number;
  colGap: number;
  maxPerRow: number;
  rootNodeHeight: number;
  childNodeHeight: number;
}

export const DEFAULT_AGENT_TREE_LAYOUT_CONFIG: AgentTreeLayoutConfig = {
  rootWidth: 280,
  childWidth: 220,
  rowGap: 80,
  colGap: 24,
  maxPerRow: 5,
  rootNodeHeight: 120,
  childNodeHeight: 140,
};

/**
 * Build the horizontal tree layout.
 *
 * The root is drawn centered at the top; children are BFS-grouped into depth
 * levels and then chunked into rows of up to `maxPerRow` items. Each row is
 * centered horizontally inside the canvas.
 */
export function buildAgentTreeLayout<N extends LayoutNodeInput>(
  root: N,
  rootChildren: N[],
  config: AgentTreeLayoutConfig = DEFAULT_AGENT_TREE_LAYOUT_CONFIG,
): AgentTreeLayoutResult<N> {
  const { rootWidth, childWidth, rowGap, colGap, maxPerRow, rootNodeHeight, childNodeHeight } =
    config;

  interface FlatChild {
    node: N;
    parentId: string;
    depth: number;
  }

  const levels: FlatChild[][] = [];
  let queue: FlatChild[] = rootChildren.map((n) => ({
    node: n,
    parentId: root.id,
    depth: 0,
  }));
  while (queue.length > 0) {
    const nextQueue: FlatChild[] = [];
    for (const item of queue) {
      if (!levels[item.depth]) levels[item.depth] = [];
      levels[item.depth].push(item);
      if (item.node.children?.length) {
        for (const child of item.node.children) {
          nextQueue.push({
            node: child as N,
            parentId: item.node.id,
            depth: item.depth + 1,
          });
        }
      }
    }
    queue = nextQueue;
  }

  const rows: FlatChild[][] = [];
  for (const level of levels) {
    for (let i = 0; i < level.length; i += maxPerRow) {
      rows.push(level.slice(i, i + maxPerRow));
    }
  }

  const maxRowWidth = Math.max(
    rootWidth,
    ...rows.map((row) => row.length * childWidth + (row.length - 1) * colGap),
  );
  const totalWidth = Math.max(maxRowWidth + 60, rootWidth + 60);

  const rootX = (totalWidth - rootWidth) / 2;
  const rootY = 20;
  const nodes: AgentTreeLayoutNode<N>[] = [{ node: root, x: rootX, y: rootY, width: rootWidth }];

  const nodeCenters = new Map<string, { cx: number; bottomY: number }>();
  nodeCenters.set(root.id, {
    cx: rootX + rootWidth / 2,
    bottomY: rootY + rootNodeHeight,
  });

  const lines: AgentTreeSvgLine[] = [];
  const rootBottomY = rootY + rootNodeHeight;

  rows.forEach((row, rowIdx) => {
    const rowWidth = row.length * childWidth + (row.length - 1) * colGap;
    const startX = (totalWidth - rowWidth) / 2;
    const childY = rootBottomY + rowGap + rowIdx * (childNodeHeight + rowGap);

    row.forEach((item, colIdx) => {
      const childX = startX + colIdx * (childWidth + colGap);
      nodes.push({ node: item.node, x: childX, y: childY, width: childWidth });

      nodeCenters.set(item.node.id, {
        cx: childX + childWidth / 2,
        bottomY: childY + childNodeHeight,
      });

      const parentCenter = nodeCenters.get(item.parentId);
      if (parentCenter) {
        lines.push({
          x1: parentCenter.cx,
          y1: parentCenter.bottomY,
          x2: childX + childWidth / 2,
          y2: childY,
          parentId: item.parentId,
          childId: item.node.id,
        });
      }
    });
  });

  const lastRow = rows[rows.length - 1];
  const lastRowY = lastRow
    ? rootBottomY + rowGap + (rows.length - 1) * (childNodeHeight + rowGap) + childNodeHeight
    : rootBottomY;
  const totalHeight = lastRowY + 30;

  return { nodes, lines, width: totalWidth, height: totalHeight };
}

/**
 * Produce an SVG bezier-curve path between a parent's bottom-center and a
 * child's top-center, given the connector line endpoints.
 */
export function bezierPath(line: AgentTreeSvgLine): string {
  const midY = (line.y1 + line.y2) / 2;
  return `M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`;
}
