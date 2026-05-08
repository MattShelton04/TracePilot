/**
 * useTabReorderDrag — pointer-based drag-to-reorder state machine for the
 * session tab strip.
 *
 * Owns the pointer/drag state, drop-indicator math, and reorder-vs-pop-out
 * decision. Uses element pointer-capture (`setPointerCapture`) instead of
 * window/document listeners, so there are no global listeners to leak; the
 * `onScopeDispose` cleanup still resets state defensively in case the
 * component unmounts mid-drag.
 */

import { type ComputedRef, onScopeDispose, type Ref, ref } from "vue";
import type { SessionTab } from "@/stores/sessionTabs";

export interface UseTabReorderDragOptions {
  /** Reactive list of tabs being rendered. */
  tabs: ComputedRef<readonly SessionTab[]> | Ref<readonly SessionTab[]>;
  /** Per-tab root HTMLElement refs, indexed parallel to `tabs`. */
  tabEls: Ref<(HTMLElement | null)[]>;
  /** The strip container element (used to detect drag-out for pop-out). */
  stripRef: Ref<HTMLElement | null>;
  /** Called when a drag completes inside the strip and the order changed. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Called when the drag ended outside the strip (vertical pop-out gesture). */
  onDragOut: (sessionId: string) => void;
}

export interface UseTabReorderDragReturn {
  isDragging: Ref<boolean>;
  dragIndex: Ref<number>;
  dragSessionId: Ref<string | null>;
  dragOffset: Ref<number>;
  insertionIndex: Ref<number | null>;
  onPointerDown: (event: PointerEvent, index: number) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
}

const DRAG_THRESHOLD = 5; // px before drag starts

export function useTabReorderDrag(opts: UseTabReorderDragOptions): UseTabReorderDragReturn {
  const isDragging = ref(false);
  const dragIndex = ref(-1);
  const dragSessionId = ref<string | null>(null);
  const dragOffset = ref(0);
  const dragCurrentX = ref(0);
  const insertionIndex = ref<number | null>(null);

  let pointerStartX = 0;
  let pointerStartY = 0;
  let tabStartLeft = 0;
  let tabWidths: number[] = [];
  let tabLeftEdges: number[] = [];
  let dragStarted = false;

  function onPointerDown(event: PointerEvent, index: number) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".tab-close")) return;

    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    dragIndex.value = index;
    dragSessionId.value = opts.tabs.value[index]?.sessionId ?? null;
    dragStarted = false;

    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);

    tabWidths = [];
    tabLeftEdges = [];
    for (const ref of opts.tabEls.value) {
      if (ref) {
        const rect = ref.getBoundingClientRect();
        tabWidths.push(rect.width);
        tabLeftEdges.push(rect.left);
      }
    }
    tabStartLeft = tabLeftEdges[index] ?? 0;
  }

  function onPointerMove(event: PointerEvent) {
    if (dragIndex.value < 0) return;

    const dx = event.clientX - pointerStartX;
    const dy = event.clientY - pointerStartY;

    if (!dragStarted) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragStarted = true;
      isDragging.value = true;
      dragOffset.value = 0;
    }

    dragOffset.value = dx;
    dragCurrentX.value = event.clientX;

    const dragCenterX = tabStartLeft + (tabWidths[dragIndex.value] ?? 0) / 2 + dx;
    let targetIdx = opts.tabs.value.length;
    for (let i = 0; i < opts.tabs.value.length; i++) {
      const midpoint = (tabLeftEdges[i] ?? 0) + (tabWidths[i] ?? 0) / 2;
      if (dragCenterX < midpoint) {
        targetIdx = i;
        break;
      }
    }
    insertionIndex.value =
      targetIdx === dragIndex.value || targetIdx === dragIndex.value + 1 ? null : targetIdx;
  }

  function onPointerUp(event: PointerEvent) {
    if (dragIndex.value < 0) return;

    const el = event.currentTarget as HTMLElement;
    el.releasePointerCapture(event.pointerId);

    if (!dragStarted) {
      cleanupDrag();
      return;
    }

    const stripRect = opts.stripRef.value?.getBoundingClientRect();
    const sessionId = dragSessionId.value;
    const outside = stripRect
      ? event.clientY < stripRect.top - 20 || event.clientY > stripRect.bottom + 20
      : false;

    if (outside && sessionId) {
      opts.onDragOut(sessionId);
    } else if (insertionIndex.value !== null) {
      let toIdx = insertionIndex.value;
      if (toIdx > dragIndex.value) toIdx -= 1;
      if (toIdx !== dragIndex.value) {
        opts.onReorder(dragIndex.value, toIdx);
      }
    }

    cleanupDrag();
  }

  function onPointerCancel(_event: PointerEvent) {
    cleanupDrag();
  }

  function cleanupDrag() {
    isDragging.value = false;
    dragIndex.value = -1;
    dragSessionId.value = null;
    dragOffset.value = 0;
    insertionIndex.value = null;
    dragStarted = false;
    tabWidths = [];
    tabLeftEdges = [];
  }

  onScopeDispose(cleanupDrag);

  return {
    isDragging,
    dragIndex,
    dragSessionId,
    dragOffset,
    insertionIndex,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
