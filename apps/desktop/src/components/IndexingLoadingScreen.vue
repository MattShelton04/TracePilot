<template>
  <div
    v-if="!dismissed"
    class="indexing-loading-screen"
    :class="{ 'fade-out': fadingOut }"
    :style="{
      '--ui-scale': scaleFactor,
    }"
  >
    <!-- Top progress bar -->
    <div class="progress-bar-track" :class="{ visible: phase !== 'idle' }">
      <div class="progress-bar-fill" :style="{ width: progressPct + '%' }" />
    </div>

    <!-- Orbital field -->
    <div ref="orbitalFieldRef" class="orbital-field">
      <!-- Ambient particles (created once on mount) -->
      <div ref="ambientContainerRef" class="ambient-particles" />

      <!-- SVG layer: orbital paths + connection lines -->
      <svg ref="svgLayerRef" class="orbital-svg" />

      <!-- Orbiting nodes -->
      <div
        v-for="node in visibleNodes"
        :key="node.id"
        class="orbit-node"
        :class="{ active: node.active }"
        :style="{
          left: node.x + 'px',
          top: node.y + 'px',
          '--node-color': node.color,
          '--node-glow': node.color + '55',
        }"
      >
        <div class="node-dot" />
        <div
          class="mini-card"
          :class="{ visible: node.expanded }"
          :style="{ '--node-color': node.color }"
          :title="`${node.repo} · ${node.branch}`"
        >
          <div class="mc-repo">
            <span class="mc-repo-dot" />
            {{ node.repoDisplay }}
          </div>
          <div class="mc-branch">{{ node.branchDisplay }}</div>
        </div>
      </div>

      <!-- Pulse ripples -->
      <div
        v-for="ripple in ripples"
        :key="ripple.id"
        class="pulse-ripple active"
        :style="{ left: centerX + 'px', top: centerY + 'px' }"
      />

      <!-- Center logo hub -->
      <div class="logo-hub" :class="{ visible: showLogo }">
        <div class="logo-icon">
          <div class="logo-glow" />
          <LogoIcon :size="70" />
        </div>
        <div class="phase-text">{{ phaseLabel }}</div>
        <div v-if="sessionCounterText" class="session-counter">{{ sessionCounterText }}</div>
      </div>
    </div>

    <!-- Completion flash -->
    <div class="completion-flash" :class="{ active: completionFlashActive }" />
  </div>
</template>

<script setup lang="ts">
import { reindexSessions } from "@tracepilot/client";
import type { IndexingProgressPayload } from "@tracepilot/types";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import LogoIcon from "@/components/icons/LogoIcon.vue";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import {
  DISCOVERING_MESSAGES,
  PHASE_LABELS,
  type Phase,
  useOrbitalAnimation,
} from "@/composables/useOrbitalAnimation";
import { logError, logWarn } from "@/utils/logger";

// ── Props & Emits ──────────────────────────────────────────────────────────────

const props = defineProps<{
  totalSessions: number;
}>();

const emit = defineEmits<{
  complete: [];
}>();

// ── UI state ───────────────────────────────────────────────────────────────────

const phase = ref<Phase>("idle");
const showLogo = ref(false);
const dismissed = ref(false);
const fadingOut = ref(false);
const completionFlashActive = ref(false);
const progressPct = ref(0);
const sessionCounterText = ref("");
const prefersReducedMotion = ref(false);
const discoveringMessageIndex = ref(0);

// Timer tracking for cleanup
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;
const SAFETY_TIMEOUT_MS = 60_000;
let discoveringIntervalId: ReturnType<typeof setInterval> | null = null;

// Minimum display time tracking
let mountTime = 0;
const MIN_DISPLAY_MS = 800;
let sessionsProcessed = 0;
let completionStarted = false;

// ── Template refs ──────────────────────────────────────────────────────────────

const orbitalFieldRef = ref<HTMLElement>();
const svgLayerRef = ref<SVGSVGElement>();
const ambientContainerRef = ref<HTMLElement>();

// ── Composables ────────────────────────────────────────────────────────────────

const {
  visibleNodes,
  ripples,
  centerX,
  centerY,
  scaleFactor,
  createNode,
  createSeedNode,
  clearSeedNodes,
  emitPulse,
  measureField,
  createAmbientParticles,
  drawLaneEllipses,
  showLaneEllipses,
  setLaneEllipseOpacity,
  setGlobalSpeedMult,
  start: startAnimation,
  stop: stopAnimation,
  decelerate,
} = useOrbitalAnimation({
  orbitalFieldRef,
  svgLayerRef,
  ambientContainerRef,
  phase,
  prefersReducedMotion,
});

const indexingEvents = useIndexingEvents({
  onStarted: onIndexingStarted,
  onProgress: onIndexingProgress,
  onFinished: onIndexingFinished,
});

// ── Tracked timeout helper ─────────────────────────────────────────────────────

function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    fn();
  }, ms);
  pendingTimers.add(id);
  return id;
}

// ── Computed ───────────────────────────────────────────────────────────────────

const phaseLabel = computed(() => {
  if (phase.value === "discovering") {
    return DISCOVERING_MESSAGES[discoveringMessageIndex.value];
  }
  return PHASE_LABELS[phase.value];
});

// ── Seed nodes ─────────────────────────────────────────────────────────────────

/** Seed decorative dot-only nodes across all lanes for immediate visual activity. */
function seedDecorativeNodes() {
  // Spread across the three orbital lanes (token thresholds: 30k, 100k, ∞)
  createSeedNode("·", 5_000);
  createSeedNode("·", 15_000);
  createSeedNode("·", 25_000);
  createSeedNode("·", 60_000);
  createSeedNode("·", 80_000);
  createSeedNode("·", 120_000);
  createSeedNode("·", 200_000);
}

// ── Phase transitions ──────────────────────────────────────────────────────────

function setPhase(newPhase: Phase) {
  phase.value = newPhase;

  if (newPhase === "discovering") {
    showLogo.value = true;
    showLaneEllipses();
    // Start cycling through discovering messages every 2 seconds
    discoveringMessageIndex.value = 0;
    if (discoveringIntervalId) clearInterval(discoveringIntervalId);
    discoveringIntervalId = setInterval(() => {
      discoveringMessageIndex.value =
        (discoveringMessageIndex.value + 1) % DISCOVERING_MESSAGES.length;
    }, 2000);
  } else {
    // Stop cycling when leaving discovering phase
    if (discoveringIntervalId) {
      clearInterval(discoveringIntervalId);
      discoveringIntervalId = null;
    }
  }

  if (newPhase === "finalizing") {
    setGlobalSpeedMult(0.5);
    setLaneEllipseOpacity("0.2");
  }
}

// ── Completion sequence ────────────────────────────────────────────────────────

async function handleCompletion() {
  if (completionStarted) return;
  completionStarted = true;

  // Ensure minimum display time
  const elapsed = performance.now() - mountTime;
  if (elapsed < MIN_DISPLAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DISPLAY_MS - elapsed));
  }

  if (dismissed.value) return;

  phase.value = "complete";
  completionFlashActive.value = true;

  // Sequence: decelerate 400ms → hold 350ms → fade 400ms
  const DECEL_MS = 400;
  const HOLD_MS = 350;
  const FADE_MS = 400;

  decelerate(DECEL_MS);

  safeTimeout(() => {
    // Hold phase complete — begin fade
    fadingOut.value = true;
    safeTimeout(() => {
      dismissed.value = true;
      emit("complete");
    }, FADE_MS);
  }, DECEL_MS + HOLD_MS);
}

// ── Tauri event handlers ───────────────────────────────────────────────────────

function onIndexingStarted() {
  setPhase("discovering");
}

let seedsCleared = false;

function onIndexingProgress(payload: IndexingProgressPayload) {
  if (phase.value === "discovering" || phase.value === "idle") {
    setPhase("indexing");
  }

  // Clear decorative seed nodes on first real progress event
  if (!seedsCleared) {
    seedsCleared = true;
    clearSeedNodes();
  }

  // Update progress
  const pct = payload.total > 0 ? (payload.current / payload.total) * 100 : 0;
  progressPct.value = pct;
  sessionCounterText.value = `${payload.current} / ${payload.total}`;

  // Create orbiting node if this event has session info
  if (payload.sessionRepo) {
    createNode(payload.sessionRepo, payload.sessionBranch ?? "main", payload.sessionTokens);

    sessionsProcessed++;
    if (sessionsProcessed % 10 === 0) {
      emitPulse();
    }
  }

  // Transition to finalizing at >90%
  if (pct > 90 && phase.value === "indexing") {
    setPhase("finalizing");
  }
}

function onIndexingFinished() {
  progressPct.value = 100;
  handleCompletion();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  mountTime = performance.now();

  prefersReducedMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Register event listeners BEFORE triggering indexing
  await indexingEvents.setup();

  await nextTick();

  // Measure viewport and initialize orbital visuals
  measureField();
  createAmbientParticles(35);
  drawLaneEllipses();

  // Start animation loop
  startAnimation();

  // Show logo + seed decorative nodes immediately for visual activity
  showLogo.value = true;
  seedDecorativeNodes();
  showLaneEllipses();

  // Trigger indexing
  reindexSessions().catch((err) => {
    logError("[indexing] Indexing failed (non-fatal):", err);
    handleCompletion();
  });

  // Safety timeout
  safetyTimeoutId = safeTimeout(() => {
    if (phase.value !== "complete" && !dismissed.value) {
      logWarn("[indexing] Loading screen safety timeout — proceeding to app");
      handleCompletion();
    }
  }, SAFETY_TIMEOUT_MS);
});

onUnmounted(() => {
  stopAnimation();
  for (const id of pendingTimers) clearTimeout(id);
  pendingTimers.clear();
  if (safetyTimeoutId) {
    clearTimeout(safetyTimeoutId);
    safetyTimeoutId = null;
  }
  if (discoveringIntervalId) {
    clearInterval(discoveringIntervalId);
    discoveringIntervalId = null;
  }
});
</script>

<style scoped>
/* ── Component root ── */
.indexing-loading-screen {
  position: fixed;
  inset: 0;
  background: var(--canvas-inset);
  z-index: 9999;
  transition: opacity 0.4s ease;
}

.indexing-loading-screen.fade-out {
  opacity: 0;
  pointer-events: none;
}

/* ── Progress bar (top) ── */
.progress-bar-track {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--canvas-subtle);
  z-index: 10000;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.progress-bar-track.visible {
  opacity: 1;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-emphasis), var(--accent-fg));
  border-radius: 0 2px 2px 0;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
}

/* ── Orbital field ── */
.orbital-field {
  position: fixed;
  inset: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── SVG layer ── */
.orbital-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.orbital-svg :deep(line) {
  stroke-linecap: round;
}

.orbital-svg :deep(ellipse) {
  fill: none;
  stroke-width: 1;
}

/* ── Center logo hub ── */
.logo-hub {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.6s ease;
  color: var(--accent-fg);
}

.logo-hub.visible {
  opacity: 1;
}

.logo-hub .logo-icon {
  width: calc(70px * var(--ui-scale, 1));
  height: calc(70px * var(--ui-scale, 1));
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-hub .logo-glow {
  position: absolute;
  width: calc(160px * var(--ui-scale, 1));
  height: calc(160px * var(--ui-scale, 1));
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(99, 102, 241, 0.3) 0%,
    rgba(99, 102, 241, 0.08) 50%,
    transparent 70%
  );
  animation: logoGlowPulse 3s ease-in-out infinite;
  pointer-events: none;
}

@keyframes logoGlowPulse {
  0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
}

.logo-hub .phase-text {
  font-size: calc(0.75rem * var(--ui-scale, 1));
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  text-align: center;
}

.logo-hub .session-counter {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: calc(0.75rem * var(--ui-scale, 1));
  color: var(--accent-fg);
  font-variant-numeric: tabular-nums;
}

/* ── Orbiting nodes ── */
.orbit-node {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  will-change: transform;
}

.orbit-node .node-dot {
  width: calc(8px * var(--ui-scale, 1));
  height: calc(8px * var(--ui-scale, 1));
  border-radius: 50%;
  background: var(--node-color, var(--accent-fg));
  box-shadow: 0 0 10px 3px var(--node-glow, rgba(129, 140, 248, 0.4));
  transform: scale(0);
  opacity: 0;
}

.orbit-node.active .node-dot {
  animation: dotPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes dotPop {
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.8); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

/* Mini card (expanded from dot) */
.orbit-node .mini-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-left: 3px solid var(--node-color, var(--accent-fg));
  border-radius: 8px;
  padding: calc(5px * var(--ui-scale, 1)) calc(10px * var(--ui-scale, 1));
  white-space: nowrap;
  pointer-events: auto;
  min-width: calc(100px * var(--ui-scale, 1));
  max-width: calc(220px * var(--ui-scale, 1));
  transition:
    transform 0.4s cubic-bezier(0.34, 1.2, 0.64, 1),
    opacity 0.3s ease;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.3),
    0 0 12px var(--node-glow, rgba(129, 140, 248, 0.15));
}

.orbit-node .mini-card.visible {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
}

.orbit-node .mini-card .mc-repo {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: calc(11px * var(--ui-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.orbit-node .mini-card .mc-repo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--node-color, var(--accent-fg));
  flex-shrink: 0;
}

.orbit-node .mini-card .mc-branch {
  font-size: calc(10px * var(--ui-scale, 1));
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  color: var(--text-tertiary);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Pulse ripple ── */
@keyframes ripplePulse {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 0.5; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}

.pulse-ripple {
  position: absolute;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  border: 1px solid var(--accent-fg);
  pointer-events: none;
  z-index: 2;
  opacity: 0;
}

.pulse-ripple.active {
  animation: ripplePulse 1.2s ease-out forwards;
}

/* ── Completion flash ── */
@keyframes completionPulse {
  0% { opacity: 0; }
  30% { opacity: 0.04; }
  100% { opacity: 0; }
}

.completion-flash {
  position: fixed;
  inset: 0;
  background: var(--accent-fg);
  opacity: 0;
  pointer-events: none;
  z-index: 45;
}

.completion-flash.active {
  animation: completionPulse 0.5s ease-out forwards;
}

/* ── Ambient particles ── */
.ambient-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ambient-particles :deep(.ambient-particle) {
  position: absolute;
  border-radius: 50%;
  background: var(--accent-fg);
  opacity: 0;
  pointer-events: none;
  animation: particleDrift linear infinite;
}

@keyframes particleDrift {
  0% { opacity: 0; transform: translate(0, 0); }
  15% { opacity: 0.1; }
  85% { opacity: 0.1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .indexing-loading-screen *,
  .indexing-loading-screen *::before,
  .indexing-loading-screen *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  .orbit-node {
    will-change: auto;
  }

  .logo-glow {
    display: none;
  }

  .ambient-particles {
    display: none;
  }
}
</style>
