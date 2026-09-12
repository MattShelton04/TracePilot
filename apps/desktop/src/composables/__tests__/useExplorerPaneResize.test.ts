import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { useExplorerPaneResize } from "../useExplorerPaneResize";

describe("Explorer pane resizing", () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup(width = 1000) {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    let result!: ReturnType<typeof useExplorerPaneResize>;
    const element = document.createElement("div");
    Object.defineProperty(element, "clientWidth", { get: () => width });
    const wrapper = mount(
      defineComponent({
        setup() {
          result = useExplorerPaneResize(ref(element));
          return () => h("div");
        },
      }),
    );
    return {
      result,
      wrapper,
      disconnect,
      resizeTo(next: number) {
        width = next;
        resize();
      },
    };
  }

  it("reserves reading space when shrinking and restores the preferred tree width", () => {
    const { result, resizeTo, wrapper } = setup();
    result.onResizeKeydown(new KeyboardEvent("keydown", { key: "End" }));
    expect(result.treeWidth.value).toBe(500);
    resizeTo(650);
    expect(result.treeWidth.value).toBe(325);
    resizeTo(0); // A retained hidden session must not lose its width preference.
    expect(result.treeWidth.value).toBe(325);
    resizeTo(1000);
    expect(result.treeWidth.value).toBe(500);
    wrapper.unmount();
  });

  it("supports keyboard increments and bounds without scrolling the page", () => {
    const { result, wrapper } = setup(650);
    const key = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      cancelable: true,
    });
    result.onResizeKeydown(key);
    expect(result.treeWidth.value).toBe(290);
    expect(key.defaultPrevented).toBe(true);
    result.onResizeKeydown(new KeyboardEvent("keydown", { key: "End" }));
    expect(result.treeWidth.value).toBe(325);
    result.onResizeKeydown(new KeyboardEvent("keydown", { key: "Home" }));
    result.onResizeKeydown(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(result.treeWidth.value).toBe(160);
    wrapper.unmount();
  });

  it("clamps dragging and tears down listeners when the tab closes", () => {
    const { result, wrapper, disconnect } = setup(650);
    result.startDrag(new MouseEvent("mousedown", { clientX: 240, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 900 }));
    expect(result.treeWidth.value).toBe(325);
    expect(result.isDragging.value).toBe(true);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(result.isDragging.value).toBe(false);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }));
    expect(result.treeWidth.value).toBe(325);
  });
});
