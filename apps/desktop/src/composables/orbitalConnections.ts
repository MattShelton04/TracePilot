/**
 * Connection-line management for the orbital animation.
 *
 * Owns the pool of SVG `<line>` elements connecting same-repo nodes on
 * same/adjacent lanes. Extracted to keep `useOrbitalAnimation` focused on the
 * reactive state + frame loop.
 */

import type { OrbitNode } from "@/composables/useOrbitalAnimation";
import { MAX_CONNECTIONS } from "@/utils/orbitalGeometry";

export interface Connection {
  aId: number;
  bId: number;
  color: string;
  el: SVGLineElement;
}

export interface ConnectionManager {
  readonly list: Connection[];
  createFor(newNode: OrbitNode, nodes: OrbitNode[]): void;
  updatePositions(
    nodes: OrbitNode[],
    getPos: (angle: number, laneIdx: number) => { x: number; y: number },
  ): void;
  clear(): void;
}

export function createConnectionManager(svgRef: {
  value: SVGSVGElement | undefined;
}): ConnectionManager {
  const connections: Connection[] = [];

  function createFor(newNode: OrbitNode, nodes: OrbitNode[]) {
    const svg = svgRef.value;
    if (!svg) return;

    let added = 0;
    for (let i = nodes.length - 2; i >= 0 && added < 2; i--) {
      const existing = nodes[i];
      if (existing.repo !== newNode.repo) continue;
      if (Math.abs(existing.laneIdx - newNode.laneIdx) > 1) continue;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", newNode.color);
      line.setAttribute("stroke-opacity", "0");
      line.setAttribute("stroke-width", "0.8");
      line.setAttribute("stroke-linecap", "round");
      line.style.transition = "stroke-opacity 0.6s ease";
      svg.appendChild(line);

      requestAnimationFrame(() => {
        line.setAttribute("stroke-opacity", "0.2");
      });

      connections.push({ aId: newNode.id, bId: existing.id, color: newNode.color, el: line });
      added++;

      // Cap total connections
      if (connections.length > MAX_CONNECTIONS) {
        const old = connections.shift();
        old?.el.remove();
      }
    }
  }

  function updatePositions(
    nodes: OrbitNode[],
    getPos: (angle: number, laneIdx: number) => { x: number; y: number },
  ) {
    const nodeMap = new Map<number, OrbitNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    for (const conn of connections) {
      const a = nodeMap.get(conn.aId);
      const b = nodeMap.get(conn.bId);
      if (!a || !b) continue;
      const posA = getPos(a.angle, a.laneIdx);
      const posB = getPos(b.angle, b.laneIdx);
      conn.el.setAttribute("x1", String(posA.x));
      conn.el.setAttribute("y1", String(posA.y));
      conn.el.setAttribute("x2", String(posB.x));
      conn.el.setAttribute("y2", String(posB.y));
    }
  }

  function clear() {
    connections.forEach((c) => {
      c.el.remove();
    });
    connections.length = 0;
  }

  return {
    get list() {
      return connections;
    },
    createFor,
    updatePositions,
    clear,
  };
}
