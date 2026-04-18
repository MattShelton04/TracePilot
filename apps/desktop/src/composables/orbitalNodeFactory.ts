/**
 * Orbit-node factory for the indexing-loading animation.
 *
 * Owns node creation, the repo → colour mapping, and the legend item list.
 * Kept as a plain factory so the main controller composable only has to
 * drive state + the rAF loop.
 */

import type { ConnectionManager } from "@/composables/orbitalConnections";
import type { OrbitNode, RepoLegendItem } from "@/composables/useOrbitalAnimation";
import type { Ref } from "vue";
import {
  assignLane,
  getRepoPalette,
  MAX_VISIBLE_NODES,
  type Phase,
  randomStartAngle,
  SEED_COLOR,
  speedJitter,
  truncateMiddle,
} from "@/utils/orbitalGeometry";

const REPO_PALETTE = getRepoPalette();

export interface NodeFactoryDeps {
  nodes: OrbitNode[];
  legendItems: Ref<RepoLegendItem[]>;
  phase: Ref<Phase>;
  connectionMgr: ConnectionManager;
  getPos: (angle: number, laneIdx: number) => { x: number; y: number };
  safeTimeout: (fn: () => void, ms: number) => void;
}

export interface NodeFactory {
  createSeedNode(label: string, tokens: number): OrbitNode;
  clearSeedNodes(): void;
  createNode(repo: string, branch: string, tokens: number): OrbitNode;
}

export function createOrbitNodeFactory(deps: NodeFactoryDeps): NodeFactory {
  const repoColorMap = new Map<string, string>();
  let nextColorIndex = 0;
  let nodeIdCounter = 0;

  function getRepoColor(repo: string): string {
    let color = repoColorMap.get(repo);
    if (!color) {
      color = REPO_PALETTE[nextColorIndex % REPO_PALETTE.length];
      nextColorIndex++;
      repoColorMap.set(repo, color);
      deps.legendItems.value.push({
        name: repo,
        displayName: truncateMiddle(repo, 36),
        color,
      });
    }
    return color;
  }

  function buildNode(
    repo: string,
    branch: string,
    laneIdx: number,
    color: string,
    repoDisplay: string,
    branchDisplay: string,
  ): OrbitNode {
    const startAngle = randomStartAngle();
    const jitter = speedJitter();
    const pos = deps.getPos(startAngle, laneIdx);
    return {
      id: nodeIdCounter++,
      repo,
      repoDisplay,
      branch,
      branchDisplay,
      color,
      laneIdx,
      angle: startAngle,
      speedJitter: jitter,
      x: pos.x - 4,
      y: pos.y - 4,
      active: false,
      expanded: false,
      createdAt: performance.now(),
    };
  }

  /**
   * Create a decorative seed node for visual activity before real data arrives.
   * Does NOT touch repoColorMap, legendItems, or nextColorIndex.
   */
  function createSeedNode(label: string, tokens: number): OrbitNode {
    const laneIdx = assignLane(tokens);
    const node = buildNode(label, "…", laneIdx, SEED_COLOR, label, "…");
    deps.nodes.push(node);
    requestAnimationFrame(() => {
      node.active = true;
    });
    return node;
  }

  /** Remove all seed nodes (call when first real progress arrives). */
  function clearSeedNodes() {
    for (let i = deps.nodes.length - 1; i >= 0; i--) {
      if (deps.nodes[i].color === SEED_COLOR) deps.nodes.splice(i, 1);
    }
  }

  function createNode(repo: string, branch: string, tokens: number): OrbitNode {
    const laneIdx = assignLane(tokens);
    const color = getRepoColor(repo);
    const node = buildNode(
      repo,
      branch,
      laneIdx,
      color,
      truncateMiddle(repo, 28),
      truncateMiddle(branch, 18),
    );
    deps.nodes.push(node);

    requestAnimationFrame(() => {
      node.active = true;
    });

    // Expand to mini-card after 800ms
    deps.safeTimeout(() => {
      if (deps.phase.value !== "complete" && deps.nodes.includes(node)) {
        node.expanded = true;
      }
    }, 800);

    // Create SVG connections to same-repo nodes on same/adjacent lanes
    deps.connectionMgr.createFor(node, deps.nodes);

    // Fade out oldest nodes when over limit
    if (deps.nodes.length > MAX_VISIBLE_NODES + 10) {
      deps.nodes.splice(0, deps.nodes.length - MAX_VISIBLE_NODES);
    }

    return node;
  }

  return { createSeedNode, clearSeedNodes, createNode };
}
