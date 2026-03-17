import { ref, watch, onBeforeUnmount, type Ref } from "vue";

/**
 * Provides a reactive `nowMs` timestamp that ticks at 1-second boundaries.
 *
 * Uses drift-corrected setTimeout to align with wall-clock seconds,
 * avoiding the 60fps waste of requestAnimationFrame for a 1Hz display.
 *
 * Automatically starts when `hasActive` becomes true and stops when false.
 * Pauses when the document tab is hidden.
 */
export function useLiveDuration(hasActive: Ref<boolean>) {
  const nowMs = ref(Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function scheduleNextTick() {
    // Align to the next whole second boundary to avoid drift
    const delay = 1000 - (Date.now() % 1000);
    timer = setTimeout(() => {
      nowMs.value = Date.now();
      if (running) {
        scheduleNextTick();
      }
    }, delay);
  }

  function start() {
    if (running) return;
    running = true;
    nowMs.value = Date.now();
    scheduleNextTick();
  }

  function stop() {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Pause when document is hidden to avoid unnecessary work
  function handleVisibility() {
    if (document.hidden) {
      stop();
    } else if (hasActive.value) {
      start();
    }
  }
  document.addEventListener("visibilitychange", handleVisibility);

  const unwatchActive = watch(
    hasActive,
    (active) => {
      if (active) {
        start();
      } else {
        stop();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stop();
    document.removeEventListener("visibilitychange", handleVisibility);
    unwatchActive();
  });

  return { nowMs };
}
