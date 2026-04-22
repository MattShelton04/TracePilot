/**
 * Orbital animation controller composable.
 *
 * Thin DOM + rAF + reactive-state wrapper around the pure math in
 * `@/utils/orbitalGeometry`. Manages orbiting nodes, SVG connections, lane
 * ellipses, ambient particles, and pulse ripples; all DOM resources are
 * released via `stop()`.
 *
 * Public return shape is preserved byte-for-byte from the pre-Wave-42
 * implementation; consumers (`IndexingLoadingScreen.vue`) continue to import
 * `useOrbitalAnimation`, `PHASE_LABELS`, and `DISCOVERING_MESSAGES` from here.
 */

import { computed, type Ref, reactive, ref } from "vue";
import { createConnectionManager } from "@/composables/orbitalConnections";
import {
  createLaneEllipseLayer,
  createAmbientParticles as spawnAmbientParticles,
} from "@/composables/orbitalDomLayers";
import { createOrbitNodeFactory } from "@/composables/orbitalNodeFactory";
import {
  angularSpeedFor,
  computeOrbitalPos,
  computeScaleFactor,
  LANES,
  MAX_VISIBLE_NODES,
  type Phase,
} from "@/utils/orbitalGeometry";

export type { Phase } from "@/utils/orbitalGeometry";
// ── Re-exports (back-compat with IndexingLoadingScreen) ────────────────────
export { DISCOVERING_MESSAGES, LANES, PHASE_LABELS } from "@/utils/orbitalGeometry";

// ── Types ──────────────────────────────────────────────────────────────────

export interface OrbitNode {
  id: number;
  repo: string;
  repoDisplay: string;
  branch: string;
  branchDisplay: string;
  color: string;
  laneIdx: number;
  angle: number;
  speedJitter: number;
  x: number;
  y: number;
  active: boolean;
  expanded: boolean;
  createdAt: number;
}

interface Ripple {
  id: number;
  removeAt: number;
}

export interface RepoLegendItem {
  name: string;
  displayName: string;
  color: string;
}

export interface OrbitalAnimationOptions {
  orbitalFieldRef: Ref<HTMLElement | undefined>;
  svgLayerRef: Ref<SVGSVGElement | undefined>;
  ambientContainerRef: Ref<HTMLElement | undefined>;
  phase: Ref<Phase>;
  prefersReducedMotion: Ref<boolean>;
  /** Called on every animation frame (use for counter lerp, etc.) */
  onFrame?: () => void;
}

const NODE_X_OFFSET = 4;

export function useOrbitalAnimation(options: OrbitalAnimationOptions) {
  const {
    orbitalFieldRef,
    svgLayerRef,
    ambientContainerRef,
    phase,
    prefersReducedMotion,
    onFrame,
  } = options;

  // ── Reactive state ─────────────────────────────────────────────────────
  const nodes = reactive<OrbitNode[]>([]);
  const connectionMgr = createConnectionManager(svgLayerRef);
  const ripples = ref<Ripple[]>([]);
  const repoLegendItems = ref<RepoLegendItem[]>([]);
  const centerX = ref(0);
  const centerY = ref(0);
  const scaleFactor = ref(1);

  // ── Internal state ─────────────────────────────────────────────────────
  let rippleIdCounter = 0;
  let animFrameId = 0;
  let lastTimestamp = 0;
  let globalSpeedMult = 1;
  let animating = false;
  let resizeObserver: ResizeObserver | null = null;

  const ellipseLayer = createLaneEllipseLayer({
    svgRef: svgLayerRef,
    getCenter: () => ({ x: centerX.value, y: centerY.value }),
    getScale: () => scaleFactor.value,
  });

  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  function safeTimeout(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      fn();
    }, ms);
    pendingTimers.add(id);
  }

  function getOrbitalPos(angle: number, laneIdx: number) {
    return computeOrbitalPos(
      angle,
      LANES[laneIdx],
      centerX.value,
      centerY.value,
      scaleFactor.value,
    );
  }

  const nodeFactory = createOrbitNodeFactory({
    nodes: nodes as OrbitNode[],
    legendItems: repoLegendItems,
    phase,
    connectionMgr,
    getPos: getOrbitalPos,
    safeTimeout,
  });

  // ── Viewport measurement ───────────────────────────────────────────────
  function measureField() {
    const el = orbitalFieldRef.value;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    centerX.value = w / 2;
    centerY.value = h / 2;
    scaleFactor.value = computeScaleFactor(w, h);
    svgLayerRef.value?.setAttribute("viewBox", `0 0 ${w} ${h}`);
    ellipseLayer.updatePositions();
  }

  // ── DOM layer thin wrappers ────────────────────────────────────────────
  function createAmbientParticles(count: number) {
    spawnAmbientParticles(ambientContainerRef.value, count, prefersReducedMotion.value);
  }
  const drawLaneEllipses = ellipseLayer.draw;
  const showLaneEllipses = ellipseLayer.show;
  const setLaneEllipseOpacity = ellipseLayer.setOpacity;

  // ── Pulse ripple ───────────────────────────────────────────────────────
  function emitPulse() {
    if (prefersReducedMotion.value) return;

    const id = rippleIdCounter++;
    ripples.value.push({ id, removeAt: performance.now() + 1300 });
    ellipseLayer.brightenBriefly();
    setTimeout(() => {
      ripples.value = ripples.value.filter((r) => r.id !== id);
    }, 1300);
  }

  // ── Animation loop ─────────────────────────────────────────────────────
  function advanceNodes(dtSeconds: number) {
    for (const node of nodes) {
      const speed = angularSpeedFor(LANES[node.laneIdx]);
      node.angle += speed * dtSeconds * node.speedJitter * globalSpeedMult;
      const pos = getOrbitalPos(node.angle, node.laneIdx);
      node.x = pos.x - NODE_X_OFFSET;
      node.y = pos.y - NODE_X_OFFSET;
    }
    connectionMgr.updatePositions(nodes, getOrbitalPos);
  }

  function animate(timestamp: number) {
    if (!animating) return;

    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (!prefersReducedMotion.value && phase.value !== "complete") advanceNodes(dt);

    onFrame?.();
    animFrameId = requestAnimationFrame(animate);
  }

  /** Start the animation loop and resize observer. */
  function start() {
    animating = true;
    lastTimestamp = 0;
    animFrameId = requestAnimationFrame(animate);

    resizeObserver = new ResizeObserver(() => measureField());
    if (orbitalFieldRef.value) resizeObserver.observe(orbitalFieldRef.value);
  }

  /** Stop the animation loop and clean up all DOM resources. */
  function stop() {
    animating = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
    for (const id of pendingTimers) clearTimeout(id);
    pendingTimers.clear();
    resizeObserver?.disconnect();
    resizeObserver = null;
    connectionMgr.clear();
    ellipseLayer.clear();
  }

  function setGlobalSpeedMult(value: number) {
    globalSpeedMult = value;
  }

  /** Smoothly decelerate orbits over the given duration. */
  function decelerate(durationMs = 300) {
    if (prefersReducedMotion.value) {
      globalSpeedMult = 0;
      return;
    }

    const decStart = performance.now();
    const startSpeed = globalSpeedMult;
    function step() {
      const t = Math.min((performance.now() - decStart) / durationMs, 1);
      globalSpeedMult = startSpeed * (1 - t);
      advanceNodes(0.016);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ── Computed ───────────────────────────────────────────────────────────
  const visibleNodes = computed(() =>
    nodes.length <= MAX_VISIBLE_NODES ? nodes : nodes.slice(nodes.length - MAX_VISIBLE_NODES),
  );

  return {
    nodes,
    visibleNodes,
    ripples,
    repoLegendItems,
    centerX,
    centerY,
    scaleFactor,
    createNode: nodeFactory.createNode,
    createSeedNode: nodeFactory.createSeedNode,
    clearSeedNodes: nodeFactory.clearSeedNodes,
    emitPulse,
    measureField,
    createAmbientParticles,
    drawLaneEllipses,
    showLaneEllipses,
    setLaneEllipseOpacity,
    setGlobalSpeedMult,
    start,
    stop,
    decelerate,
  };
}
