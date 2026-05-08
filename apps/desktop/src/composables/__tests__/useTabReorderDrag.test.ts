import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, ref } from "vue";
import { useTabReorderDrag } from "../useTabReorderDrag";

interface MockTab {
  sessionId: string;
  label: string;
  activeSubTab: string;
}

function makeTabs(ids: string[]): MockTab[] {
  return ids.map((id) => ({ sessionId: id, label: id, activeSubTab: "overview" }));
}

function makeTabEl(left: number, width: number): HTMLElement {
  const el = document.createElement("div");
  // jsdom doesn't lay out elements; stub getBoundingClientRect.
  el.getBoundingClientRect = () =>
    ({
      left,
      right: left + width,
      top: 0,
      bottom: 30,
      width,
      height: 30,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return el;
}

function makeStripEl(): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 30,
      width: 1000,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function makePointerEvent(
  type: string,
  init: { clientX: number; clientY: number; button?: number; target?: HTMLElement },
  currentTarget: HTMLElement,
): PointerEvent {
  const ev = {
    type,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: 1,
    target: init.target ?? currentTarget,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return ev as unknown as PointerEvent;
}

describe("useTabReorderDrag", () => {
  let onReorder: ReturnType<typeof vi.fn>;
  let onDragOut: ReturnType<typeof vi.fn>;
  let scope: ReturnType<typeof effectScope>;

  beforeEach(() => {
    onReorder = vi.fn();
    onDragOut = vi.fn();
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  function setup(tabIds: string[] = ["a", "b", "c"]) {
    const tabsArr = makeTabs(tabIds);
    const tabsRef = ref(tabsArr);
    const tabs = computed(() => tabsRef.value);
    const els = tabIds.map((_, i) => makeTabEl(i * 100, 100));
    const tabEls = ref<(HTMLElement | null)[]>(els);
    const stripRef = ref<HTMLElement | null>(makeStripEl());
    const drag = scope.run(() =>
      useTabReorderDrag({ tabs, tabEls, stripRef, onReorder, onDragOut }),
    )!;
    return { drag, els, tabs, tabsRef, stripRef };
  }

  it("drags a tab to a new position and calls onReorder with shifted target", () => {
    const { drag, els } = setup();

    drag.onPointerDown(makePointerEvent("pointerdown", { clientX: 50, clientY: 10 }, els[0]), 0);
    expect(els[0].setPointerCapture).toHaveBeenCalled();

    // Move past threshold to position over tab "c" (index 2)
    drag.onPointerMove(makePointerEvent("pointermove", { clientX: 250, clientY: 10 }, els[0]));
    expect(drag.isDragging.value).toBe(true);
    expect(drag.dragIndex.value).toBe(0);
    // dragCenterX = 0 + 50 + 200 = 250; midpoints are 50, 150, 250.
    // 250 is NOT < 250, so target falls through to 3 (length)
    expect(drag.insertionIndex.value).toBe(3);

    drag.onPointerUp(makePointerEvent("pointerup", { clientX: 250, clientY: 10 }, els[0]));
    // toIdx=3, > dragIndex(0), so subtract 1 → moveTab(0, 2)
    expect(onReorder).toHaveBeenCalledWith(0, 2);
    expect(onDragOut).not.toHaveBeenCalled();
    expect(drag.isDragging.value).toBe(false);
    expect(drag.dragIndex.value).toBe(-1);
  });

  it("treats a sub-threshold move as a click and does not reorder", () => {
    const { drag, els } = setup();

    drag.onPointerDown(makePointerEvent("pointerdown", { clientX: 50, clientY: 10 }, els[0]), 0);
    drag.onPointerMove(makePointerEvent("pointermove", { clientX: 52, clientY: 11 }, els[0]));
    expect(drag.isDragging.value).toBe(false);
    drag.onPointerUp(makePointerEvent("pointerup", { clientX: 52, clientY: 11 }, els[0]));

    expect(onReorder).not.toHaveBeenCalled();
    expect(onDragOut).not.toHaveBeenCalled();
  });

  it("calls onDragOut when released far above/below the strip", () => {
    const { drag, els } = setup();

    drag.onPointerDown(makePointerEvent("pointerdown", { clientX: 50, clientY: 10 }, els[0]), 0);
    drag.onPointerMove(makePointerEvent("pointermove", { clientX: 100, clientY: 200 }, els[0]));
    drag.onPointerUp(makePointerEvent("pointerup", { clientX: 100, clientY: 200 }, els[0]));

    expect(onDragOut).toHaveBeenCalledWith("a");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("ignores non-primary pointer buttons", () => {
    const { drag, els } = setup();
    drag.onPointerDown(
      makePointerEvent("pointerdown", { clientX: 50, clientY: 10, button: 2 }, els[0]),
      0,
    );
    expect(drag.dragIndex.value).toBe(-1);
    expect(els[0].setPointerCapture).not.toHaveBeenCalled();
  });

  it("ignores pointerdown on the close button", () => {
    const { drag, els } = setup();
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    els[0].appendChild(closeBtn);
    drag.onPointerDown(
      makePointerEvent("pointerdown", { clientX: 50, clientY: 10, target: closeBtn }, els[0]),
      0,
    );
    expect(drag.dragIndex.value).toBe(-1);
  });

  it("onPointerCancel resets state", () => {
    const { drag, els } = setup();
    drag.onPointerDown(makePointerEvent("pointerdown", { clientX: 50, clientY: 10 }, els[0]), 0);
    drag.onPointerMove(makePointerEvent("pointermove", { clientX: 200, clientY: 10 }, els[0]));
    expect(drag.isDragging.value).toBe(true);
    drag.onPointerCancel(makePointerEvent("pointercancel", { clientX: 200, clientY: 10 }, els[0]));
    expect(drag.isDragging.value).toBe(false);
    expect(drag.dragIndex.value).toBe(-1);
    expect(drag.insertionIndex.value).toBeNull();
  });

  it("cleans up state when the effect scope is disposed mid-drag", () => {
    const { drag, els } = setup();
    drag.onPointerDown(makePointerEvent("pointerdown", { clientX: 50, clientY: 10 }, els[0]), 0);
    drag.onPointerMove(makePointerEvent("pointermove", { clientX: 200, clientY: 10 }, els[0]));
    expect(drag.isDragging.value).toBe(true);

    scope.stop();

    expect(drag.isDragging.value).toBe(false);
    expect(drag.dragIndex.value).toBe(-1);
    expect(drag.dragSessionId.value).toBeNull();
    expect(drag.insertionIndex.value).toBeNull();
  });
});
