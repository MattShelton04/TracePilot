<template>
  <div
    v-if="!dismissed"
    class="indexing-loading-screen"
    :class="{ 'fade-out': fadingOut }"
    :style="{
      opacity: fadingOut ? 0 : undefined,
      transform: fadingOut ? 'scale(1.02)' : undefined,
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
      <div class="logo-hub" :class="{ visible: phase !== 'idle' || showLogo }">
        <div class="logo-icon">
          <div class="logo-glow" />
          <LogoIcon :size="70" />
        </div>
        <div class="phase-text">{{ phaseLabel }}</div>
        <div v-if="sessionCounterText" class="session-counter">{{ sessionCounterText }}</div>
      </div>
    </div>

    <!-- Stats panel -->
    <OrbitalStatsPanel
      :visible="phase === 'indexing' || phase === 'finalizing'"
      :display-sessions="displaySessions"
      :total-sessions="props.totalSessions"
      :display-tokens="displayTokens"
      :display-events="displayEvents"
      :display-repos="displayRepos"
      :progress-pct="progressPct"
      :repo-legend-items="repoLegendItems"
    />

    <!-- Completion flash -->
    <div class="completion-flash" :class="{ active: completionFlashActive }" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import type { IndexingProgressPayload } from '@tracepilot/types'
import { reindexSessions } from '@tracepilot/client'
import LogoIcon from '@/components/icons/LogoIcon.vue'
import OrbitalStatsPanel from '@/components/OrbitalStatsPanel.vue'
import { useAnimatedCounters } from '@/composables/useAnimatedCounters'
import { useIndexingEvents } from '@/composables/useIndexingEvents'
import {
  useOrbitalAnimation,
  PHASE_LABELS,
  type Phase,
} from '@/composables/useOrbitalAnimation'

// ── Props & Emits ──────────────────────────────────────────────────────────────

const props = defineProps<{
  totalSessions: number
}>()

const emit = defineEmits<{
  complete: []
}>()

// ── UI state ───────────────────────────────────────────────────────────────────

const phase = ref<Phase>('idle')
const showLogo = ref(false)
const dismissed = ref(false)
const fadingOut = ref(false)
const completionFlashActive = ref(false)
const progressPct = ref(0)
const sessionCounterText = ref('')
const prefersReducedMotion = ref(false)

// Timer tracking for cleanup
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()
let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null
const SAFETY_TIMEOUT_MS = 60_000

// Minimum display time tracking
let mountTime = 0
const MIN_DISPLAY_MS = 1500
let sessionsProcessed = 0

// ── Template refs ──────────────────────────────────────────────────────────────

const orbitalFieldRef = ref<HTMLElement>()
const svgLayerRef = ref<SVGSVGElement>()
const ambientContainerRef = ref<HTMLElement>()

// ── Composables ────────────────────────────────────────────────────────────────

const counters = useAnimatedCounters()
const { displaySessions, displayTokens, displayEvents, displayRepos } = counters

const {
  visibleNodes,
  ripples,
  repoLegendItems,
  centerX,
  centerY,
  scaleFactor,
  createNode,
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
  onFrame: counters.lerpCounters,
})

const indexingEvents = useIndexingEvents({
  onStarted: onIndexingStarted,
  onProgress: onIndexingProgress,
  onFinished: onIndexingFinished,
})

// ── Tracked timeout helper ─────────────────────────────────────────────────────

/** setTimeout that auto-cleans on unmount */
function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
  return id
}

// ── Computed ───────────────────────────────────────────────────────────────────

const phaseLabel = computed(() => PHASE_LABELS[phase.value])

// ── Phase transitions ──────────────────────────────────────────────────────────

function setPhase(newPhase: Phase) {
  phase.value = newPhase

  if (newPhase === 'discovering') {
    showLogo.value = true
    showLaneEllipses()
  }

  if (newPhase === 'finalizing') {
    setGlobalSpeedMult(0.5)
    setLaneEllipseOpacity('0.2')
  }
}

// ── Completion sequence ────────────────────────────────────────────────────────

async function handleCompletion() {
  // Guard against double-completion
  if (dismissed.value || phase.value === 'complete') return

  // Ensure minimum display time
  const elapsed = performance.now() - mountTime
  if (elapsed < MIN_DISPLAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DISPLAY_MS - elapsed))
  }

  phase.value = 'complete'

  // Step 1: Show "Ready" text + completion flash
  completionFlashActive.value = true

  // Step 2: Decelerate orbits over 300ms
  decelerate(300)

  // Step 3: After 600ms, start fade-out
  safeTimeout(() => {
    fadingOut.value = true

    // Step 4: After fade completes (500ms), emit complete
    safeTimeout(() => {
      dismissed.value = true
      emit('complete')
    }, 500)
  }, 600)
}

// ── Tauri event handlers ───────────────────────────────────────────────────────

function onIndexingStarted() {
  setPhase('discovering')
}

function onIndexingProgress(payload: IndexingProgressPayload) {
  if (phase.value === 'discovering' || phase.value === 'idle') {
    setPhase('indexing')
  }

  // Update progress
  const pct = payload.total > 0 ? (payload.current / payload.total) * 100 : 0
  progressPct.value = pct

  // Update counter targets
  counters.targetSessions.value = payload.current
  counters.targetTokens.value = payload.totalTokens
  counters.targetEvents.value = payload.totalEvents
  sessionCounterText.value = `${payload.current} / ${payload.total}`

  // Create orbiting node if this event has session info
  if (payload.sessionRepo) {
    createNode(
      payload.sessionRepo,
      payload.sessionBranch ?? 'main',
      payload.sessionTokens,
    )
    counters.targetRepos.value = repoLegendItems.value.length

    sessionsProcessed++
    if (sessionsProcessed % 10 === 0) {
      emitPulse()
    }
  }

  // Transition to finalizing at >90%
  if (pct > 90 && phase.value === 'indexing') {
    setPhase('finalizing')
  }
}

function onIndexingFinished() {
  // Snap counters to final values
  progressPct.value = 100
  handleCompletion()
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  mountTime = performance.now()

  // Detect reduced motion preference
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // CRITICAL: Register event listeners BEFORE triggering indexing
  // to prevent the race condition where events fire before we're listening.
  await indexingEvents.setup()

  await nextTick()

  // Measure viewport and initialize orbital visuals
  measureField()
  createAmbientParticles(35)
  drawLaneEllipses()

  // Start animation loop (also sets up resize observer)
  startAnimation()

  // Show logo after brief delay
  safeTimeout(() => {
    showLogo.value = true
  }, 200)

  // NOW trigger indexing — listeners are guaranteed to be active
  reindexSessions().catch((err) => {
    console.error('Indexing failed (non-fatal):', err)
    // Ensure we don't get stuck — transition to app
    handleCompletion()
  })

  // Safety timeout — if indexing-finished never arrives, auto-complete
  safetyTimeoutId = safeTimeout(() => {
    if (phase.value !== 'complete' && !dismissed.value) {
      console.warn('Loading screen safety timeout — proceeding to app')
      handleCompletion()
    }
  }, SAFETY_TIMEOUT_MS)
})

onUnmounted(() => {
  // Stop animation loop and clean up orbital DOM elements
  stopAnimation()

  // Clean up all tracked timers
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
  if (safetyTimeoutId) {
    clearTimeout(safetyTimeoutId)
    safetyTimeoutId = null
  }
})
</script>

<style scoped>
/* ── Component root ── */
.indexing-loading-screen {
  position: fixed;
  inset: 0;
  background: #0d1117;
  z-index: 9999;
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.indexing-loading-screen.fade-out {
  pointer-events: none;
}

/* ── Progress bar (top) ── */
.progress-bar-track {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #21262d;
  z-index: 10000;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.progress-bar-track.visible {
  opacity: 1;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
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
  transition: opacity 0.8s ease, transform 0.8s ease;
  color: #818cf8;
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
  0%,
  100% {
    opacity: 0.6;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.1);
  }
}

.logo-hub .phase-text {
  font-size: calc(0.75rem * var(--ui-scale, 1));
  color: #7d8590;
  letter-spacing: 0.04em;
  text-align: center;
}

.logo-hub .session-counter {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: calc(0.75rem * var(--ui-scale, 1));
  color: #818cf8;
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
  background: var(--node-color, #818cf8);
  box-shadow: 0 0 10px 3px var(--node-glow, rgba(129, 140, 248, 0.4));
  transform: scale(0);
  opacity: 0;
}

.orbit-node.active .node-dot {
  animation: dotPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes dotPop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.8);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Mini card (expanded from dot) */
.orbit-node .mini-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  background: #161b22;
  border: 1px solid #30363d;
  border-left: 3px solid var(--node-color, #818cf8);
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
  color: #e6edf3;
  overflow: hidden;
  text-overflow: ellipsis;
}

.orbit-node .mini-card .mc-repo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--node-color, #818cf8);
  flex-shrink: 0;
}

.orbit-node .mini-card .mc-branch {
  font-size: calc(10px * var(--ui-scale, 1));
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  color: #7d8590;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Pulse ripple ── */
@keyframes ripplePulse {
  0% {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0.5;
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}

.pulse-ripple {
  position: absolute;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  border: 1px solid #818cf8;
  pointer-events: none;
  z-index: 2;
  opacity: 0;
}

.pulse-ripple.active {
  animation: ripplePulse 1.2s ease-out forwards;
}

/* ── Completion flash ── */
@keyframes completionPulse {
  0% {
    opacity: 0;
  }
  30% {
    opacity: 0.06;
  }
  100% {
    opacity: 0;
  }
}

.completion-flash {
  position: fixed;
  inset: 0;
  background: #818cf8;
  opacity: 0;
  pointer-events: none;
  z-index: 45;
}

.completion-flash.active {
  animation: completionPulse 1s ease-out forwards;
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
  background: #818cf8;
  opacity: 0;
  pointer-events: none;
  animation: particleDrift linear infinite;
}

@keyframes particleDrift {
  0% {
    opacity: 0;
    transform: translate(0, 0);
  }
  15% {
    opacity: 0.1;
  }
  85% {
    opacity: 0.1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--dx), var(--dy));
  }
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
