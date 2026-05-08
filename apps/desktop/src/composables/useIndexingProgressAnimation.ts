/**
 * useIndexingProgressAnimation — orchestration state machine for the
 * indexing loading screen.
 *
 * Owns: phase ref, derived progress strings, the `discovering` rotating-message
 * interval, completion sequencing (decelerate → hold → fade → emit), the
 * safety timeout, and bookkeeping of every active timer so cleanup on
 * scope dispose is leak-free.
 *
 * Does **not** touch the DOM. Orbital scene-side effects (createNode,
 * emitPulse, decelerate, lane-ellipse opacity, etc.) are injected as
 * callbacks by the parent component, which sources them from the scene's
 * exposed `useOrbitalAnimation` instance.
 */

import type { IndexingProgressPayload } from "@tracepilot/types";
import { computed, onScopeDispose, type Ref, ref } from "vue";
import { DISCOVERING_MESSAGES, PHASE_LABELS, type Phase } from "@/composables/useOrbitalAnimation";

export const SAFETY_TIMEOUT_MS = 60_000;
export const MIN_DISPLAY_MS = 800;
export const DISCOVERING_INTERVAL_MS = 2_000;
export const COMPLETION_DECEL_MS = 400;
export const COMPLETION_HOLD_MS = 350;
export const COMPLETION_FADE_MS = 400;

export interface IndexingProgressActions {
  /** Show lane ellipses (scene-side DOM). */
  showLaneEllipses: () => void;
  /** Set lane ellipse opacity (scene-side DOM). */
  setLaneEllipseOpacity: (value: string) => void;
  /** Adjust the global orbital angular speed multiplier. */
  setGlobalSpeedMult: (value: number) => void;
  /** Trigger the deceleration tween over `ms` milliseconds. */
  decelerate: (ms: number) => void;
  /** Drop all decorative seed nodes once real progress arrives. */
  clearSeedNodes: () => void;
  /** Spawn an orbiting node for a real session. */
  createNode: (repo: string, branch: string, tokens: number) => void;
  /** Emit a center-pulse ripple (every Nth real session). */
  emitPulse: () => void;
  /** Logger for non-fatal warnings (safety timeout). */
  logWarn?: (...args: unknown[]) => void;
}

export interface IndexingProgressAnimationOptions {
  actions: IndexingProgressActions;
  /** Called once after the fade-out completes (parent emits 'complete'). */
  onComplete: () => void;
}

export function useIndexingProgressAnimation(opts: IndexingProgressAnimationOptions) {
  const { actions, onComplete } = opts;

  // ── Reactive state ──────────────────────────────────────────────────────
  const phase = ref<Phase>("idle");
  const showLogo = ref(false);
  const dismissed = ref(false);
  const fadingOut = ref(false);
  const completionFlashActive = ref(false);
  const progressPct = ref(0);
  const sessionCounterText = ref("");
  const prefersReducedMotion = ref(false);
  const discoveringMessageIndex = ref(0);

  // ── Timer bookkeeping ───────────────────────────────────────────────────
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let discoveringIntervalId: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle bookkeeping ───────────────────────────────────────────────
  let mountTime = 0;
  let sessionsProcessed = 0;
  let completionStarted = false;
  let seedsCleared = false;

  function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      fn();
    }, ms);
    pendingTimers.add(id);
    return id;
  }

  // ── Computed ────────────────────────────────────────────────────────────
  const phaseLabel = computed(() => {
    if (phase.value === "discovering") {
      return DISCOVERING_MESSAGES[discoveringMessageIndex.value];
    }
    return PHASE_LABELS[phase.value];
  });

  // ── Phase machine ───────────────────────────────────────────────────────
  function setPhase(newPhase: Phase) {
    phase.value = newPhase;

    if (newPhase === "discovering") {
      showLogo.value = true;
      actions.showLaneEllipses();
      discoveringMessageIndex.value = 0;
      if (discoveringIntervalId) clearInterval(discoveringIntervalId);
      discoveringIntervalId = setInterval(() => {
        discoveringMessageIndex.value =
          (discoveringMessageIndex.value + 1) % DISCOVERING_MESSAGES.length;
      }, DISCOVERING_INTERVAL_MS);
    } else if (discoveringIntervalId) {
      clearInterval(discoveringIntervalId);
      discoveringIntervalId = null;
    }

    if (newPhase === "finalizing") {
      actions.setGlobalSpeedMult(0.5);
      actions.setLaneEllipseOpacity("0.2");
    }
  }

  // ── Completion sequence ─────────────────────────────────────────────────
  async function handleCompletion() {
    if (completionStarted) return;
    completionStarted = true;

    const elapsed = performance.now() - mountTime;
    if (elapsed < MIN_DISPLAY_MS) {
      await new Promise((r) => setTimeout(r, MIN_DISPLAY_MS - elapsed));
    }

    if (dismissed.value) return;

    phase.value = "complete";
    completionFlashActive.value = true;

    actions.decelerate(COMPLETION_DECEL_MS);

    safeTimeout(() => {
      fadingOut.value = true;
      safeTimeout(() => {
        dismissed.value = true;
        onComplete();
      }, COMPLETION_FADE_MS);
    }, COMPLETION_DECEL_MS + COMPLETION_HOLD_MS);
  }

  // ── Indexing event handlers ─────────────────────────────────────────────
  function onIndexingStarted() {
    setPhase("discovering");
  }

  function onIndexingProgress(payload: IndexingProgressPayload) {
    if (phase.value === "discovering" || phase.value === "idle") {
      setPhase("indexing");
    }

    if (!seedsCleared) {
      seedsCleared = true;
      actions.clearSeedNodes();
    }

    const pct = payload.total > 0 ? (payload.current / payload.total) * 100 : 0;
    progressPct.value = pct;
    sessionCounterText.value = `${payload.current} / ${payload.total}`;

    if (payload.sessionRepo) {
      actions.createNode(
        payload.sessionRepo,
        payload.sessionBranch ?? "main",
        payload.sessionTokens,
      );
      sessionsProcessed++;
      if (sessionsProcessed % 10 === 0) {
        actions.emitPulse();
      }
    }

    if (pct > 90 && phase.value === "indexing") {
      setPhase("finalizing");
    }
  }

  function onIndexingFinished() {
    progressPct.value = 100;
    handleCompletion();
  }

  // ── Mount/start orchestration ───────────────────────────────────────────
  function start() {
    mountTime = performance.now();
    prefersReducedMotion.value =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    safetyTimeoutId = safeTimeout(() => {
      if (phase.value !== "complete" && !dismissed.value) {
        actions.logWarn?.("[indexing] Loading screen safety timeout — proceeding to app");
        handleCompletion();
      }
    }, SAFETY_TIMEOUT_MS);
  }

  function stop() {
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
  }

  onScopeDispose(stop);

  return {
    // reactive state
    phase: phase as Ref<Phase>,
    showLogo,
    dismissed,
    fadingOut,
    completionFlashActive,
    progressPct,
    sessionCounterText,
    prefersReducedMotion,
    discoveringMessageIndex,
    phaseLabel,
    // derived/handlers
    onIndexingStarted,
    onIndexingProgress,
    onIndexingFinished,
    handleCompletion,
    setPhase,
    start,
    stop,
  };
}
