import { nextTick, onBeforeUnmount, onMounted, type Ref, ref, type WatchSource, watch } from "vue";

export interface AutoScrollOptions {
  /** Ref to the scrollable container element. */
  containerRef: Ref<HTMLElement | null>;
  /** Reactive source that triggers scroll check when changed (e.g. () => store.turns). */
  watchSource: WatchSource;
  /** Optional reactive source for view mode changes that should trigger recalculation. */
  viewModeSource?: WatchSource;
  /** Pixel threshold from bottom to disengage auto-scroll (default: 80). */
  disengageThreshold?: number;
  /** Pixel threshold from bottom to re-engage auto-scroll (default: 24). */
  engageThreshold?: number;
}

/**
 * Composable for intelligent auto-scrolling with scroll-lock pattern.
 *
 * - Detects when user is near the bottom of a scroll container
 * - Auto-scrolls to bottom when new data arrives (if locked)
 * - Disengages when user scrolls up, re-engages when scrolling back to bottom
 * - Respects text selection (pauses auto-scroll during active selection)
 * - Respects prefers-reduced-motion
 * - Uses hysteresis to avoid flapping near the threshold boundary
 */
export function useAutoScroll(options: AutoScrollOptions) {
  const {
    containerRef,
    watchSource,
    viewModeSource,
    disengageThreshold = 80,
    engageThreshold = 24,
  } = options;

  const isLockedToBottom = ref(false);
  const showScrollToTop = ref(false);
  const hasOverflow = ref(false);

  let rafId: number | null = null;
  // Guard flag: prevents scroll handler from disengaging lock during programmatic smooth scrolls
  let isProgrammaticScroll = false;
  // Skip auto-scroll on the first data change (initial load should not snap to bottom)
  let hasReceivedFirstData = false;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function isNearBottom(el: HTMLElement, threshold: number): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  function hasActiveTextSelection(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range") return false;
    // Scope to the scroll container to avoid pausing on sidebar/header selections
    const el = containerRef.value;
    if (!el || !sel.anchorNode) return false;
    return el.contains(sel.anchorNode);
  }

  function updateOverflow() {
    const el = containerRef.value;
    if (!el) {
      hasOverflow.value = false;
      return;
    }
    hasOverflow.value = el.scrollHeight > el.clientHeight;
  }

  function recalculateState() {
    const el = containerRef.value;
    if (!el) return;
    updateOverflow();
    showScrollToTop.value = el.scrollTop > 300;
    // Only update lock state if user has already interacted (not on initial load)
    if (hasReceivedFirstData) {
      isLockedToBottom.value = isNearBottom(el, disengageThreshold);
    }
  }

  function scrollToBottom(animated = true) {
    const el = containerRef.value;
    if (!el) return;
    const useSmooth = animated && !prefersReducedMotion.matches;
    el.scrollTo({ top: el.scrollHeight, behavior: useSmooth ? "smooth" : "auto" });
    isLockedToBottom.value = true;
    if (useSmooth) {
      // Guard: suppress handleScroll's lock/unlock logic during smooth animation.
      // Cleared position-based in handleScroll once the element reaches the bottom.
      // Using scrollend is intentionally avoided here — an instant scroll fired by the
      // data watcher (new message arriving mid-animation) would cancel the smooth scroll
      // and trigger scrollend early, clearing the guard before we arrive at the bottom.
      isProgrammaticScroll = true;
      setTimeout(() => {
        isProgrammaticScroll = false;
      }, 2000); // safety fallback only
    }
  }

  function scrollToTop(animated = true) {
    const el = containerRef.value;
    if (!el) return;
    const useSmooth = animated && !prefersReducedMotion.matches;
    el.scrollTo({ top: 0, behavior: useSmooth ? "smooth" : "auto" });
    isLockedToBottom.value = false;
    if (useSmooth) {
      isProgrammaticScroll = true;
      setTimeout(() => {
        isProgrammaticScroll = false;
      }, 2000);
    }
  }

  function handleScroll() {
    // Coalesce with requestAnimationFrame
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const el = containerRef.value;
      if (!el) return;

      updateOverflow();
      showScrollToTop.value = el.scrollTop > 300;

      // During a programmatic smooth scroll, suppress lock/unlock logic.
      // Clear the guard once the element reaches its target position — this is
      // more robust than scrollend, which can fire early if an instant data-update
      // scroll interrupts the animation mid-way.
      if (isProgrammaticScroll) {
        const atTarget = isLockedToBottom.value
          ? isNearBottom(el, engageThreshold)
          : el.scrollTop <= engageThreshold;
        if (atTarget) isProgrammaticScroll = false;
        return;
      }

      // Hysteresis: use tighter threshold to re-engage, wider to disengage
      if (isLockedToBottom.value) {
        // Currently locked — disengage if scrolled far from bottom
        if (!isNearBottom(el, disengageThreshold)) {
          isLockedToBottom.value = false;
        }
      } else {
        // Currently unlocked — re-engage only if very close to bottom
        if (isNearBottom(el, engageThreshold)) {
          isLockedToBottom.value = true;
        }
      }
    });
  }

  // When data changes, auto-scroll if locked to bottom
  watch(watchSource, () => {
    if (!hasReceivedFirstData) {
      // First data load — don't auto-scroll; update overflow/state so the ↓ FAB
      // appears if needed. User must scroll to bottom to engage auto-scroll.
      hasReceivedFirstData = true;
      nextTick(() => recalculateState());
      return;
    }
    if (isLockedToBottom.value && !hasActiveTextSelection()) {
      // Use instant scroll for data-driven updates (avoids dizzying motion during fast refresh)
      nextTick(() => {
        const el = containerRef.value;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      });
    }
  });

  // Recalculate scroll state when view mode changes
  if (viewModeSource) {
    watch(viewModeSource, () => {
      nextTick(() => recalculateState());
    });
  }

  // Handle container element changes (rebinding listeners)
  watch(containerRef, (el, prev) => {
    if (prev) prev.removeEventListener("scroll", handleScroll);
    if (el) {
      el.addEventListener("scroll", handleScroll, { passive: true });
      recalculateState();
    }
  });

  onMounted(() => {
    const el = containerRef.value;
    if (el) {
      el.addEventListener("scroll", handleScroll, { passive: true });
      recalculateState();
    }
  });

  onBeforeUnmount(() => {
    containerRef.value?.removeEventListener("scroll", handleScroll);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return {
    /** Whether auto-scroll is currently engaged (user is at/near bottom). */
    isLockedToBottom,
    /** Whether the "scroll to top" FAB should be shown. */
    showScrollToTop,
    /** Whether the content overflows the container (FABs should be hidden if false). */
    hasOverflow,
    /** Smoothly scroll to the bottom and re-engage auto-scroll. */
    scrollToBottom,
    /** Smoothly scroll to the top. */
    scrollToTop,
    /** Force recalculate scroll state (e.g., after layout changes). */
    recalculateState,
  };
}
