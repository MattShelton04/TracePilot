import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { useResizeHandle } from "../composables/useResizeHandle";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

async function setup(initialWidth = 716) {
  let width = initialWidth;
  let api!: ReturnType<typeof useResizeHandle>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useResizeHandle({
          minPct: 25,
          maxPct: 75,
          initial: 50,
          minPanePx: 300,
          splitterPx: 5,
        });
        return () =>
          h("div", { ref: api.containerRef }, [
            h("div", { tabindex: 0, onMousedown: api.onMouseDown, onKeydown: api.onKeyDown }),
          ]);
      },
    }),
    { attachTo: document.body },
  );
  cleanups.push(() => wrapper.unmount());
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockImplementation(
    () => ({ width, left: 0 }) as DOMRect,
  );
  window.dispatchEvent(new Event("resize"));
  await nextTick();
  return {
    api,
    wrapper,
    setWidth(next: number, notify = true) {
      width = next;
      if (notify) window.dispatchEvent(new Event("resize"));
    },
  };
}

describe("useResizeHandle", () => {
  it("keeps both panes readable when dragged at the minimum desktop size", async () => {
    const { api, wrapper } = await setup();
    await wrapper.get("[tabindex]").trigger("mousedown", { button: 0 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 179 }));
    expect((api.leftWidth.value * 716) / 100).toBeCloseTo(300);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 700 }));
    expect(716 - 5 - (api.leftWidth.value * 716) / 100).toBeCloseTo(300);
  });

  it("preserves the large workspace range and clamps when the window narrows", async () => {
    const { api, wrapper, setWidth } = await setup(2400);
    await wrapper.get("[tabindex]").trigger("mousedown", { button: 0 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(api.leftWidth.value).toBe(25);
    setWidth(716);
    await nextTick();
    expect((api.leftWidth.value * 716) / 100).toBeCloseTo(300);
  });

  it("supports arrows, larger steps, bounds and reset without stealing modified shortcuts", async () => {
    const { api, wrapper } = await setup(1000);
    const separator = wrapper.get("[tabindex]");
    await separator.trigger("keydown", { key: "ArrowLeft" });
    expect(api.leftWidth.value).toBeCloseTo(48.4);
    await separator.trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(api.leftWidth.value).toBeCloseTo(54.8);
    await separator.trigger("keydown", { key: "Home" });
    expect(api.leftWidth.value).toBe(30);
    await separator.trigger("keydown", { key: "ArrowLeft" });
    expect(api.leftWidth.value).toBe(30);
    await separator.trigger("keydown", { key: "End" });
    expect(api.leftWidth.value).toBe(69.5);
    await separator.trigger("keydown", { key: "Enter" });
    expect(api.leftWidth.value).toBe(50);
    for (const modifiers of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
    ]) {
      await separator.trigger("keydown", { key: "ArrowLeft", ...modifiers });
    }
    expect(api.leftWidth.value).toBe(50);
  });

  it("observes container changes, handles insufficient space and releases its observer", async () => {
    let notify!: () => void;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { api, wrapper, setWidth } = await setup(2400);
    expect(observe).toHaveBeenCalledWith(wrapper.element);
    await wrapper.get("[tabindex]").trigger("keydown", { key: "End" });
    setWidth(716, false);
    notify();
    expect(716 - 5 - (api.leftWidth.value * 716) / 100).toBeCloseTo(300);
    setWidth(500, false);
    notify();
    expect(api.minLeftWidth.value).toBe(49.5);
    expect(api.maxLeftWidth.value).toBe(49.5);
    expect(api.leftWidth.value).toBe(49.5);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("ignores secondary clicks and releases active drags on blur and unmount", async () => {
    const { api, wrapper } = await setup(1000);
    const separator = wrapper.get("[tabindex]");
    await separator.trigger("mousedown", { button: 2 });
    expect(api.dragging.value).toBe(false);
    await separator.trigger("mousedown", { button: 0 });
    expect(document.activeElement).toBe(separator.element);
    expect(api.dragging.value).toBe(true);
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 }));
    expect(api.leftWidth.value).toBe(50);
    await separator.trigger("mousedown", { button: 0 });
    wrapper.unmount();
    expect(api.dragging.value).toBe(false);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 }));
    expect(api.leftWidth.value).toBe(50);
  });
});
