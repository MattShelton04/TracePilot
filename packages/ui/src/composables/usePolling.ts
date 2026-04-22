import { getCurrentScope, onScopeDispose, ref, type Ref, watch } from "vue";

export interface UsePollingOptions {
  /** Poll interval in ms. Required. */
  intervalMs: number;
  /** Kick immediately on start (default true). */
  immediate?: boolean;
  /** Pause polling while document is hidden (default true). */
  pauseWhenHidden?: boolean;
  /**
   * When the document becomes visible again, fire an immediate tick before
   * re-arming the interval. Only meaningful when `pauseWhenHidden` is true.
   * Default true — this keeps UI state fresh after a long idle period.
   */
  triggerOnRegain?: boolean;
  /** Pause polling when this ref is false (e.g. intersection observer). */
  active?: Ref<boolean>;
  /** Swallow errors from fn and continue (default true). Set false to let errors escape. */
  swallowErrors?: boolean;
  /** Called with thrown errors when swallowErrors is true. */
  onError?: (err: unknown) => void;
}

export interface UsePollingControls {
  start: () => void;
  stop: () => void;
  trigger: () => Promise<void>;
  isRunning: Ref<boolean>;
}

/**
 * Visibility- and scope-aware polling composable.
 *
 * Behaviour:
 * - Skips a tick while a previous invocation is still in-flight (no overlap).
 * - Pauses while `document.hidden` when `pauseWhenHidden` is true.
 * - Pauses when the `active` ref flips to `false`; resumes when it flips back.
 * - Cleans up automatically on the enclosing effect scope (component or store).
 *
 * Note: `intervalMs` is captured at construction time. To change the interval
 * mid-flight, call `stop()` and create a new `usePolling` instance — this keeps
 * the composable small and predictable.
 */
export function usePolling(
  fn: () => void | Promise<void>,
  options: UsePollingOptions,
): UsePollingControls {
  const {
    intervalMs,
    immediate = true,
    pauseWhenHidden = true,
    triggerOnRegain = true,
    active,
    swallowErrors = true,
    onError,
  } = options;

  const isRunning = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let visibilityBound = false;

  function handleError(err: unknown) {
    if (swallowErrors) {
      try {
        onError?.(err);
      } catch {
        // ignore onError handler failures
      }
      return;
    }
    throw err;
  }

  async function trigger(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await fn();
    } catch (err) {
      handleError(err);
    } finally {
      inFlight = false;
    }
  }

  function canRun(): boolean {
    if (!isRunning.value) return false;
    if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) return false;
    if (active && !active.value) return false;
    return true;
  }

  function clearTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function scheduleTimer() {
    clearTimer();
    if (!canRun()) return;
    timer = setInterval(() => {
      if (!canRun()) return;
      void trigger();
    }, intervalMs);
  }

  function handleVisibility() {
    if (!isRunning.value) return;
    if (document.hidden) {
      clearTimer();
    } else {
      // On regain: fire an immediate tick (configurable) before re-arming
      // the interval so UI state isn't stuck at its pre-hide snapshot.
      if (triggerOnRegain && canRun()) {
        void trigger();
      }
      scheduleTimer();
    }
  }

  function bindVisibility() {
    if (visibilityBound || !pauseWhenHidden || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", handleVisibility);
    visibilityBound = true;
  }

  function unbindVisibility() {
    if (!visibilityBound || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", handleVisibility);
    visibilityBound = false;
  }

  function start() {
    if (isRunning.value) return;
    isRunning.value = true;
    bindVisibility();
    if (immediate && canRun()) {
      void trigger();
    }
    scheduleTimer();
  }

  function stop() {
    if (!isRunning.value) {
      clearTimer();
      unbindVisibility();
      return;
    }
    isRunning.value = false;
    clearTimer();
    unbindVisibility();
  }

  // Respond to external `active` toggles while running.
  if (active) {
    watch(active, (val) => {
      if (!isRunning.value) return;
      if (val) {
        scheduleTimer();
      } else {
        clearTimer();
      }
    });
  }

  // Scope-agnostic cleanup: works inside components (onUnmounted) and
  // inside Pinia setup-store scopes. When called outside any scope,
  // callers are expected to invoke stop() themselves.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop();
    });
  }

  return { start, stop, trigger, isRunning };
}
