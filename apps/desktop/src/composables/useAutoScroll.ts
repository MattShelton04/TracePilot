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
  // Guard flag: prevents scroll handler from disengaging lock during
  // *any* programmatic scroll (smooth OR instant). Without guarding instant
  // scrolls, fast-streaming content can grow `scrollHeight` between our
  // `scrollTo` landing and the resulting `scroll` event reaching us — at
  // which point the post-scroll position may be >disengageThreshold from
  // the new bottom and the lock would erroneously flip off. This was the
  // root cause of popout-window auto-scroll dropping its lock during SDK
  // live streaming.
  let isProgrammaticScroll = false;
  // Programmatic-scroll safety-clear timer. Cleared early when the position
  // check confirms we landed at the target.
  let programmaticScrollClearTimer: ReturnType<typeof setTimeout> | null = null;
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

  function armProgrammaticScrollGuard(safetyMs = 1500) {
    isProgrammaticScroll = true;
    if (programmaticScrollClearTimer) clearTimeout(programmaticScrollClearTimer);
    programmaticScrollClearTimer = setTimeout(() => {
      isProgrammaticScroll = false;
      programmaticScrollClearTimer = null;
    }, safetyMs);
  }

  // Set while a smooth "jump to bottom" animates. Long conversations render
  // off-screen turns lazily (`content-visibility: auto`), so the content grows
  // as the animation passes through them; `maintainLock` must not answer that
  // growth with an instant scroll, which would cancel the animation.
  let smoothToBottom = false;
  let smoothToBottomLegs = 0;
  let smoothSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  const MAX_SMOOTH_LEGS = 3;

  /** Track a smooth leg; if `scrollend` never arrives, finish with an instant snap. */
  function startSmoothLeg() {
    smoothToBottom = true;
    if (smoothSafetyTimer) clearTimeout(smoothSafetyTimer);
    smoothSafetyTimer = setTimeout(() => {
      smoothSafetyTimer = null;
      if (!smoothToBottom) return;
      smoothToBottom = false;
      maintainLock();
    }, 2500);
  }

  function scrollToBottom(animated = true) {
    const el = containerRef.value;
    if (!el) return;
    const useSmooth = animated && !prefersReducedMotion.matches;
    smoothToBottom = false;
    smoothToBottomLegs = 0;
    if (useSmooth) startSmoothLeg();
    el.scrollTo({ top: el.scrollHeight, behavior: useSmooth ? "smooth" : "auto" });
    isLockedToBottom.value = true;
    // Guard for both smooth (animation runs) and instant (resulting scroll
    // event may land after content grew further during streaming).
    armProgrammaticScrollGuard(useSmooth ? 2000 : 250);
  }

  /** Whether a smooth jump is still under way (arriving at the bottom ends it). */
  function smoothJumpActive(el: HTMLElement): boolean {
    if (smoothToBottom && isNearBottom(el, engageThreshold)) smoothToBottom = false;
    return smoothToBottom;
  }

  /** The user took over mid-jump (wheel, drag, key): stop steering the scroll. */
  function cancelSmoothOnUserInput() {
    if (!smoothToBottom) return;
    smoothToBottom = false;
    isProgrammaticScroll = false;
    if (programmaticScrollClearTimer) {
      clearTimeout(programmaticScrollClearTimer);
      programmaticScrollClearTimer = null;
    }
  }
  const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  function bindListeners(el: HTMLElement) {
    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("scrollend", handleScrollEnd);
    for (const t of USER_SCROLL_EVENTS) {
      el.addEventListener(t, cancelSmoothOnUserInput, { passive: true });
    }
  }
  function unbindListeners(el: HTMLElement) {
    el.removeEventListener("scroll", handleScroll);
    el.removeEventListener("scrollend", handleScrollEnd);
    for (const t of USER_SCROLL_EVENTS) el.removeEventListener(t, cancelSmoothOnUserInput);
  }

  /** Continue a smooth jump whose target moved because content grew meanwhile. */
  function handleScrollEnd() {
    if (!smoothToBottom) return;
    const el = containerRef.value;
    if (!el || !isLockedToBottom.value || isNearBottom(el, engageThreshold)) {
      smoothToBottom = false;
      return;
    }
    smoothToBottomLegs += 1;
    const smooth = smoothToBottomLegs < MAX_SMOOTH_LEGS;
    smoothToBottom = false;
    if (smooth) startSmoothLeg();
    armProgrammaticScrollGuard(smooth ? 2000 : 250);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function scrollToTop(animated = true) {
    const el = containerRef.value;
    if (!el) return;
    const useSmooth = animated && !prefersReducedMotion.matches;
    smoothToBottom = false;
    el.scrollTo({ top: 0, behavior: useSmooth ? "smooth" : "auto" });
    isLockedToBottom.value = false;
    armProgrammaticScrollGuard(useSmooth ? 2000 : 250);
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
        if (atTarget) {
          smoothToBottom = false;
          isProgrammaticScroll = false;
          if (programmaticScrollClearTimer) {
            clearTimeout(programmaticScrollClearTimer);
            programmaticScrollClearTimer = null;
          }
        }
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
        if (!el || smoothJumpActive(el)) return;
        armProgrammaticScrollGuard(250);
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

  // Observe scrollHeight growth so streaming/dynamic content (e.g. SDK live
  // deltas) keeps us pinned to the bottom when locked, without needing the
  // caller to plumb every reactive source into `watchSource`.
  let resizeObserver: ResizeObserver | null = null;
  function maintainLock() {
    if (!hasReceivedFirstData) return;
    if (!isLockedToBottom.value) return;
    if (hasActiveTextSelection()) return;
    const el = containerRef.value;
    if (!el || smoothJumpActive(el)) return; // handleScrollEnd finishes the jump
    armProgrammaticScrollGuard(250);
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }
  function attachResizeObserver(el: HTMLElement) {
    resizeObserver?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(() => {
      updateOverflow();
      maintainLock();
    });
    resizeObserver.observe(el);
    // Also observe the first content child to catch height growth when the
    // container itself is fixed-height (e.g. flex parents).
    const child = el.firstElementChild;
    if (child instanceof HTMLElement) resizeObserver.observe(child);
  }

  // Handle container element changes (rebinding listeners)
  watch(containerRef, (el, prev) => {
    if (prev) unbindListeners(prev);
    if (el) {
      bindListeners(el);
      attachResizeObserver(el);
      recalculateState();
    }
  });

  onMounted(() => {
    const el = containerRef.value;
    if (el) {
      bindListeners(el);
      attachResizeObserver(el);
      recalculateState();
    }
  });

  onBeforeUnmount(() => {
    if (containerRef.value) unbindListeners(containerRef.value);
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (smoothSafetyTimer) clearTimeout(smoothSafetyTimer);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (programmaticScrollClearTimer) {
      clearTimeout(programmaticScrollClearTimer);
      programmaticScrollClearTimer = null;
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
