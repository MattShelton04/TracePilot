<template>
  <div ref="orbitalFieldRef" class="orbital-field">
    <!-- Ambient particles (created once on mount) -->
    <div ref="ambientContainerRef" class="ambient-particles" />

    <!-- SVG layer: orbital paths + connection lines -->
    <svg ref="svgLayerRef" class="orbital-svg" role="img" aria-label="Animated orbital network showing indexing progress" />

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

    <!-- Completion flash -->
    <div class="completion-flash" :class="{ active: completionFlashActive }" />
  </div>
</template>

<script setup lang="ts">
/**
 * IndexingOrbitalScene — visual scene for IndexingLoadingScreen.
 *
 * Owns the orbital field DOM (ambient particles, SVG, orbiting nodes, pulse
 * ripples, logo hub, completion flash), runs `useOrbitalAnimation` against
 * its own template refs, and exposes the animation action surface back to the
 * parent so the progress state machine can drive the scene without reaching
 * into its DOM. All animation init runs in `onMounted`; rAF teardown happens
 * in `onBeforeUnmount`.
 */

import { onBeforeUnmount, onMounted, ref, toRef } from "vue";
import LogoIcon from "@/components/icons/LogoIcon.vue";
import { type Phase, useOrbitalAnimation } from "@/composables/useOrbitalAnimation";

const props = defineProps<{
  phase: Phase;
  prefersReducedMotion: boolean;
  showLogo: boolean;
  phaseLabel: string;
  sessionCounterText: string;
  completionFlashActive: boolean;
}>();

const orbitalFieldRef = ref<HTMLElement>();
const svgLayerRef = ref<SVGSVGElement>();
const ambientContainerRef = ref<HTMLElement>();

const orbital = useOrbitalAnimation({
  orbitalFieldRef,
  svgLayerRef,
  ambientContainerRef,
  phase: toRef(props, "phase"),
  prefersReducedMotion: toRef(props, "prefersReducedMotion"),
});

const {
  visibleNodes,
  ripples,
  centerX,
  centerY,
  scaleFactor,
  measureField,
  createAmbientParticles,
  drawLaneEllipses,
  start: startAnimation,
  stop: stopAnimation,
} = orbital;

onMounted(() => {
  measureField();
  createAmbientParticles(35);
  drawLaneEllipses();
  startAnimation();
});

onBeforeUnmount(() => {
  stopAnimation();
});

defineExpose({
  showLaneEllipses: orbital.showLaneEllipses,
  setLaneEllipseOpacity: orbital.setLaneEllipseOpacity,
  setGlobalSpeedMult: orbital.setGlobalSpeedMult,
  decelerate: orbital.decelerate,
  clearSeedNodes: orbital.clearSeedNodes,
  createNode: orbital.createNode,
  createSeedNode: orbital.createSeedNode,
  emitPulse: orbital.emitPulse,
  scaleFactor,
});
</script>

<style scoped>
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
  .orbital-field *,
  .orbital-field *::before,
  .orbital-field *::after {
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
