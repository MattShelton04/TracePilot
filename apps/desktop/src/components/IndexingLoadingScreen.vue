<template>
  <div
    v-if="!progress.dismissed.value"
    class="indexing-loading-screen"
    :class="{ 'fade-out': progress.fadingOut.value }"
    :style="{
      '--ui-scale': sceneScaleFactor,
    }"
  >
    <!-- Top progress bar -->
    <div class="progress-bar-track" :class="{ visible: progress.phase.value !== 'idle' }">
      <div class="progress-bar-fill" :style="{ width: progress.progressPct.value + '%' }" />
    </div>

    <!-- Orbital scene (visual surface) -->
    <IndexingOrbitalScene
      ref="sceneRef"
      :phase="progress.phase.value"
      :prefers-reduced-motion="progress.prefersReducedMotion.value"
      :show-logo="progress.showLogo.value"
      :phase-label="progress.phaseLabel.value"
      :session-counter-text="progress.sessionCounterText.value"
      :completion-flash-active="progress.completionFlashActive.value"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * IndexingLoadingScreen — host shell for the indexing experience.
 *
 * Owns the top progress bar, root fade-out shell, Tauri event wiring, and
 * delegates animation state to `useIndexingProgressAnimation` and the visual
 * orbital surface to `IndexingOrbitalScene`. The composable's action surface
 * is fulfilled lazily through `sceneRef` so the parent never reaches into
 * the scene's DOM directly.
 */

import { reindexSessions } from "@tracepilot/client";
import { computed, nextTick, onMounted, ref } from "vue";
import IndexingOrbitalScene from "@/components/indexing/IndexingOrbitalScene.vue";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import { useIndexingProgressAnimation } from "@/composables/useIndexingProgressAnimation";
import { logError, logWarn } from "@/utils/logger";

const _props = defineProps<{
  totalSessions: number;
}>();

const emit = defineEmits<{
  complete: [];
}>();

const sceneRef = ref<InstanceType<typeof IndexingOrbitalScene> | null>(null);

const progress = useIndexingProgressAnimation({
  actions: {
    showLaneEllipses: () => sceneRef.value?.showLaneEllipses(),
    setLaneEllipseOpacity: (v) => sceneRef.value?.setLaneEllipseOpacity(v),
    setGlobalSpeedMult: (v) => sceneRef.value?.setGlobalSpeedMult(v),
    decelerate: (ms) => sceneRef.value?.decelerate(ms),
    clearSeedNodes: () => sceneRef.value?.clearSeedNodes(),
    createNode: (repo, branch, tokens) => sceneRef.value?.createNode(repo, branch, tokens),
    emitPulse: () => sceneRef.value?.emitPulse(),
    logWarn: (...args: unknown[]) => logWarn(String(args[0] ?? ""), ...args.slice(1)),
  },
  onComplete: () => emit("complete"),
});

const sceneScaleFactor = computed(() => sceneRef.value?.scaleFactor ?? 1);

const indexingEvents = useIndexingEvents({
  onStarted: progress.onIndexingStarted,
  onProgress: progress.onIndexingProgress,
  onFinished: progress.onIndexingFinished,
});

/** Seed decorative dot-only nodes across all lanes for immediate visual activity. */
function seedDecorativeNodes() {
  const seed = sceneRef.value?.createSeedNode;
  if (!seed) return;
  // Spread across the three orbital lanes (token thresholds: 30k, 100k, ∞)
  seed("·", 5_000);
  seed("·", 15_000);
  seed("·", 25_000);
  seed("·", 60_000);
  seed("·", 80_000);
  seed("·", 120_000);
  seed("·", 200_000);
}

onMounted(async () => {
  // Register event listeners BEFORE triggering indexing
  await indexingEvents.setup();
  await nextTick();

  // Start state machine + safety timeout (composable owns timer cleanup).
  progress.start();

  // Show logo + seed decorative nodes immediately for visual activity
  progress.showLogo.value = true;
  seedDecorativeNodes();
  sceneRef.value?.showLaneEllipses();

  // Trigger indexing
  reindexSessions().catch((err) => {
    logError("[indexing] Indexing failed (non-fatal):", err);
    progress.handleCompletion();
  });
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

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .indexing-loading-screen,
  .indexing-loading-screen *,
  .indexing-loading-screen *::before,
  .indexing-loading-screen *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
