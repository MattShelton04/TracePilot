import type { Ref, WatchStopHandle } from "vue";
import { onMounted, shallowRef, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";

interface ItemAnchor {
  id: string;
  /** Distance from the scroller's top edge to the item's top edge. */
  offset: number;
}

interface SavedPosition {
  top: number;
  /** The first item showing at the top when the user left. */
  anchor?: ItemAnchor;
}

/** Saved scroll positions for this app session, keyed by view and view state. */
const positions = new Map<string, SavedPosition>();
/** Enough for recent searches and the session list without growing forever. */
const MAX_POSITIONS = 20;

export interface UseScrollRestoreOptions {
  /**
   * Identifies what the scroller shows, read when leaving and when mounting.
   * Include the state that changes the content (route query, filters, sort)
   * so a position is only restored over the same list it was saved on.
   */
  key: () => string;
  /** The scroll container. It may appear only once the data has loaded. */
  el: Ref<HTMLElement | null>;
  /** True once the content has rendered; restoring waits for it. Defaults to always ready. */
  ready?: () => boolean;
  /**
   * Attribute that identifies the list's items, such as `data-session-id`.
   * When set, the restore lines up the item that was at the top instead of
   * reusing the raw offset, which drifts when off-screen items are laid out
   * with placeholder heights (`content-visibility: auto`).
   */
  anchorAttr?: string;
}

function items(scroller: HTMLElement, attr: string) {
  return scroller.querySelectorAll<HTMLElement>(`[${attr}]`);
}

function topItem(scroller: HTMLElement, attr: string): ItemAnchor | undefined {
  const edge = scroller.getBoundingClientRect().top;
  for (const item of items(scroller, attr)) {
    const rect = item.getBoundingClientRect();
    const id = item.getAttribute(attr);
    if (id && rect.bottom > edge) return { id, offset: rect.top - edge };
  }
  return undefined;
}

/** The scrollTop that puts the anchor item back where it was, if it still exists. */
function anchoredTop(scroller: HTMLElement, attr: string, anchor: ItemAnchor): number | null {
  for (const item of items(scroller, attr)) {
    if (item.getAttribute(attr) !== anchor.id) continue;
    const fromEdge = item.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    return scroller.scrollTop + fromEdge - anchor.offset;
  }
  return null;
}

function scrollTo(scroller: HTMLElement, top: number) {
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.min(Math.max(0, top), max);
}

/**
 * Items rendered around the new viewport swap their placeholder heights over
 * the next frames, which moves the anchor. Keep it in place until it holds
 * still, for a few frames at most, unless the user starts scrolling.
 *
 * Those swaps happen after animation frame callbacks, so a resize observer on
 * the list also corrects within the same frame, before it is painted.
 */
function holdAnchor(scroller: HTMLElement, attr: string, anchor: ItemAnchor) {
  if (typeof requestAnimationFrame !== "function") return;
  let userScrolled = false;
  const onInput = () => {
    userScrolled = true;
  };
  const inputs = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
  for (const type of inputs) scroller.addEventListener(type, onInput, { passive: true });
  /** Re-aligns the anchor: true if it moved, null once it is gone or the user has scrolled. */
  const correct = (): boolean | null => {
    const next = userScrolled ? null : anchoredTop(scroller, attr, anchor);
    if (next === null) return null;
    if (Math.abs(next - scroller.scrollTop) < 1) return false;
    scrollTo(scroller, next);
    return true;
  };
  const list = scroller.querySelector(`[${attr}]`)?.parentElement;
  const resizes =
    list && typeof ResizeObserver === "function" ? new ResizeObserver(() => correct()) : null;
  resizes?.observe(list as HTMLElement);
  let framesLeft = 10;
  let stillFrames = 0;
  const settle = () => {
    const moved = correct();
    stillFrames = moved ? 0 : stillFrames + 1;
    if (moved !== null && stillFrames < 2 && --framesLeft > 0) {
      requestAnimationFrame(settle);
      return;
    }
    resizes?.disconnect();
    for (const type of inputs) scroller.removeEventListener(type, onInput);
  };
  requestAnimationFrame(settle);
}

function savePosition(key: string, position: SavedPosition) {
  positions.delete(key);
  if (position.top <= 0) return;
  positions.set(key, position);
  if (positions.size > MAX_POSITIONS) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) positions.delete(oldest);
  }
}

/**
 * Keep a route view's scroll position when the user leaves and comes back
 * (back/forward, or reopening the same view in the same state). Views unmount
 * on navigation, so their scroller would otherwise start at the top again.
 *
 * The position is saved when leaving the route and restored once, after
 * `ready` reports the content is rendered, clamped to the content's current
 * height. A different key (other filters, another query) starts at the top.
 *
 * `pendingAnchorId` names the item a coming restore will line up, until it
 * has run, so a list that renders progressively can render that item first.
 */
export function useScrollRestore({
  key,
  el,
  ready = () => true,
  anchorAttr,
}: UseScrollRestoreOptions) {
  // Read at setup so the view can prepare its first render for the restore.
  const pending = shallowRef(positions.get(key()));

  onBeforeRouteLeave(() => {
    const scroller = el.value;
    if (!scroller) return;
    savePosition(key(), {
      top: scroller.scrollTop,
      anchor: anchorAttr ? topItem(scroller, anchorAttr) : undefined,
    });
  });

  function restore(scroller: HTMLElement, saved: SavedPosition) {
    const anchor = anchorAttr ? saved.anchor : undefined;
    const target = anchorAttr && anchor ? anchoredTop(scroller, anchorAttr, anchor) : null;
    scrollTo(scroller, target ?? saved.top);
    if (anchorAttr && anchor && target !== null) holdAnchor(scroller, anchorAttr, anchor);
  }

  onMounted(() => {
    const saved = pending.value;
    if (!saved) return;
    let restored = false;
    let stop: WatchStopHandle | undefined;
    // `flush: "post"` runs after the DOM has been patched for the change.
    stop = watch(
      () => (ready() ? el.value : null),
      (scroller) => {
        if (restored || !scroller) return;
        restored = true;
        stop?.();
        restore(scroller, saved);
        pending.value = undefined;
      },
      { flush: "post", immediate: true },
    );
    if (restored) stop();
  });

  return {
    pendingAnchorId: (): string | undefined => (anchorAttr ? pending.value?.anchor?.id : undefined),
  };
}

/** Test helper: forget every saved position. */
export function resetScrollPositions() {
  positions.clear();
}
