import { nextTick, onScopeDispose, watch } from "vue";
import {
  anchoredTop,
  holdAnchor,
  holdScroll,
  type ItemAnchor,
  scrollToClamped,
  topItem,
} from "./useScrollRestore";

/** Conversation turns; lining one up survives turns laid out at placeholder heights. */
const ANCHOR_ATTR = "data-turn-idx";
/** The session's sub-tab nav: the first tab list in the scroller, above every sub-tab. */
const NAV_SELECTOR = '[role="tablist"]';
/** Matches useAutoScroll's re-engage distance: this close to the end counts as following it. */
const BOTTOM_THRESHOLD = 24;
/** A scroll position held this long is where the user was reading. */
const SETTLE_MS = 1000;
/** How long a restore waits for the sub-tab's content before giving up. */
const MAX_WAIT_MS = 5000;
/** Sessions times sub-tabs kept; the route view shows many sessions in turn. */
const MAX_POSITIONS = 30;
const USER_INPUTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

interface SubTabPosition {
  top: number;
  /** The user was at the end, following new content; return there. */
  atBottom: boolean;
  anchor?: ItemAnchor;
}

export interface UseSubTabScrollOptions {
  /** The scroller the sub-tabs share (the session panel's `.page-content`). */
  el: () => HTMLElement | null;
  sessionId: () => string;
  subTab: () => string;
  /**
   * True when the sub-tab being entered was opened to show a specific target
   * (a deep link, "Show in conversation", a checkpoint). That scroll wins.
   */
  hasFocusTarget?: (subTab: string) => boolean;
}

function maxScroll(scroller: HTMLElement) {
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

/** The scroll offset at which the sub-tab nav's top (or bottom) edge meets the scroller's top. */
function navOffset(scroller: HTMLElement, side: "top" | "bottom"): number {
  const nav = scroller.querySelector(NAV_SELECTOR);
  if (!nav) return 0;
  const edge = scroller.getBoundingClientRect().top;
  return nav.getBoundingClientRect()[side] - edge + scroller.scrollTop;
}

/** The scroll offset past which the sub-tab nav has left the top of the scroller. */
function navEnd(scroller: HTMLElement): number {
  return navOffset(scroller, "bottom");
}

function snapshot(scroller: HTMLElement): SubTabPosition {
  const top = scroller.scrollTop;
  return {
    top,
    atBottom: maxScroll(scroller) - top <= BOTTOM_THRESHOLD,
    anchor: topItem(scroller, ANCHOR_ATTR),
  };
}

/**
 * Remember where the user was reading on each session sub-tab, and go back
 * there when they return. The sub-tabs share one scroller and unmount when
 * hidden, so it would otherwise reset to the top.
 *
 * The sub-tab nav scrolls away with the content, so a user deep in a tab
 * scrolls back up to switch. The position kept is therefore the last one the
 * user held below the nav (or wherever they were, when an in-content link
 * switched tabs), not the top they scrolled up to just to reach the nav.
 *
 * A sub-tab seen for the first time starts at its top: the scroller moves up
 * until the nav reaches the top edge, but never down, so the header doesn't
 * slide back and the tab bar stays under the pointer. A return waits until
 * the content is tall enough (or the anchored turn has rendered), for a few
 * seconds at most, and is dropped when the user scrolls, the sub-tab or
 * session changes, or a focus target is pending. A user who was following
 * the end returns to the (possibly grown) end.
 *
 * Positions live with the calling view, so a closed session tab drops its own.
 */
export function useSubTabScroll({ el, sessionId, subTab, hasFocusTarget }: UseSubTabScrollOptions) {
  const positions = new Map<string, SubTabPosition>();
  /** The last position held below the nav during this visit. */
  let reading: SubTabPosition | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelPending: (() => void) | null = null;
  /** The sub-tab whose restore is still waiting for its content. */
  let waitingKey: string | null = null;
  let generation = 0;

  const keyOf = (sid: string, tab: string) => `${sid}\u0000${tab}`;

  function onScroll() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const scroller = el();
      if (scroller && scroller.scrollTop >= navEnd(scroller)) reading = snapshot(scroller);
    }, SETTLE_MS);
  }

  let listening: HTMLElement | null = null;
  watch(
    el,
    (scroller) => {
      listening?.removeEventListener("scroll", onScroll);
      listening = scroller;
      listening?.addEventListener("scroll", onScroll, { passive: true });
    },
    { immediate: true, flush: "post" },
  );

  function cancel() {
    generation += 1;
    cancelPending?.();
    cancelPending = null;
  }

  function save(key: string, scroller: HTMLElement) {
    const now = snapshot(scroller);
    // Back at the nav only to switch: keep the reading position below it.
    const kept = reading && now.top < navEnd(scroller) ? reading : now;
    positions.delete(key);
    if (kept.top <= 0) return;
    positions.set(key, kept);
    if (positions.size > MAX_POSITIONS) {
      const oldest = positions.keys().next().value;
      if (oldest !== undefined) positions.delete(oldest);
    }
  }

  /** Applies the position once the content can show it; returns a stop for the settling hold. */
  function tryApply(scroller: HTMLElement, saved: SubTabPosition): (() => void) | false {
    if (saved.atBottom) {
      if (maxScroll(scroller) < saved.top) return false;
      scrollToClamped(scroller, scroller.scrollHeight);
      return holdScroll(scroller, () => maxScroll(scroller), scroller.firstElementChild);
    }
    const anchored = saved.anchor ? anchoredTop(scroller, ANCHOR_ATTR, saved.anchor) : null;
    if (anchored !== null && saved.anchor) {
      scrollToClamped(scroller, anchored);
      return holdAnchor(scroller, ANCHOR_ATTR, saved.anchor);
    }
    if (maxScroll(scroller) < saved.top) return false;
    scrollToClamped(scroller, saved.top);
    return () => {};
  }

  function applied(stop: () => void, saved: SubTabPosition) {
    cancelPending = stop;
    // Returning to the nav straight away should not lose this position.
    reading = saved;
  }

  function restore(scroller: HTMLElement, key: string, saved: SubTabPosition) {
    const stop = tryApply(scroller, saved);
    if (stop) {
      applied(stop, saved);
      return;
    }
    // Still loading: retry as the content grows, until the user takes over.
    const retry = () => {
      const done = tryApply(scroller, saved);
      if (!done) return;
      stopWaiting();
      applied(done, saved);
    };
    const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(retry) : null;
    resizes?.observe(scroller);
    if (scroller.firstElementChild) resizes?.observe(scroller.firstElementChild);
    for (const type of USER_INPUTS) scroller.addEventListener(type, stopWaiting, { passive: true });
    const timer = setTimeout(stopWaiting, MAX_WAIT_MS);
    function stopWaiting() {
      resizes?.disconnect();
      clearTimeout(timer);
      for (const type of USER_INPUTS) scroller.removeEventListener(type, stopWaiting);
      if (cancelPending === stopWaiting) cancelPending = null;
      if (waitingKey === key) waitingKey = null;
    }
    cancelPending = stopWaiting;
    waitingKey = key;
  }

  // `pre` runs before the DOM patch, while the scroller still shows the sub-tab being left.
  watch(
    () => [sessionId(), subTab()] as const,
    ([sid, tab], [prevSid, prevTab]) => {
      const leftKey = keyOf(prevSid, prevTab);
      // Left before its content arrived: the position shown is not the user's.
      const leftWaiting = waitingKey === leftKey;
      cancel();
      clearTimeout(settleTimer);
      const leaving = el();
      if (leaving && !leftWaiting) save(leftKey, leaving);
      reading = null;
      if (hasFocusTarget?.(tab)) return;
      const key = keyOf(sid, tab);
      const saved = positions.get(key);
      const token = generation;
      void nextTick(() => {
        const scroller = el();
        if (token !== generation || !scroller) return;
        if (saved) restore(scroller, key, saved);
        else scroller.scrollTop = Math.min(scroller.scrollTop, navOffset(scroller, "top"));
      });
    },
    { flush: "pre" },
  );

  onScopeDispose(() => {
    cancel();
    clearTimeout(settleTimer);
    listening?.removeEventListener("scroll", onScroll);
    listening = null;
  });
}
