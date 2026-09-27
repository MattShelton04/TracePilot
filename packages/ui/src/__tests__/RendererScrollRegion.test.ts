import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import RendererScrollRegion from "../components/RendererScrollRegion.vue";

afterEach(() => vi.unstubAllGlobals());

function mockMeasurements() {
  let notifyResize = () => {};
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const disconnect = vi.fn();
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  const cancelFrame = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  return {
    requestFrame,
    cancelFrame,
    disconnect,
    notifyResize: () => notifyResize(),
    async nextFrame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
      await flushPromises();
    },
  };
}

describe("renderer scroll regions", () => {
  it("resets replaced pages without collapsing an expanded region or moving focus", async () => {
    const measurements = mockMeasurements();
    const wrapper = mount(RendererScrollRegion, {
      attachTo: document.body,
      props: { label: "rows", resetKey: 0 },
      slots: { default: "Row content" },
    });
    const viewport = wrapper.get(".renderer-scroll-region__viewport").element as HTMLElement;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 700 },
      clientHeight: { value: 320 },
    });
    measurements.notifyResize();
    await measurements.nextFrame();
    const toggle = wrapper.get(".renderer-scroll-region__toggle");
    await toggle.trigger("click");
    (toggle.element as HTMLElement).focus();
    viewport.scrollTop = 400;
    await wrapper.setProps({ resetKey: 1 });
    await flushPromises();
    expect(viewport.scrollTop).toBe(0);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(viewport.style.maxHeight).toBe("none");
    expect(document.activeElement).toBe(toggle.element);
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });

  it("defers and coalesces resize measurements and cancels them on unmount", async () => {
    const measurements = mockMeasurements();
    const wrapper = mount(RendererScrollRegion, { slots: { default: "Content" } });
    const viewport = wrapper.get(".renderer-scroll-region__viewport").element;
    const readHeight = vi.fn().mockReturnValue(700);
    Object.defineProperties(viewport, {
      scrollHeight: { get: readHeight },
      clientHeight: { value: 320 },
    });
    measurements.notifyResize();
    measurements.notifyResize();
    await flushPromises();
    expect(readHeight).not.toHaveBeenCalled();
    expect(wrapper.find(".renderer-scroll-region__toggle").exists()).toBe(false);
    expect(measurements.requestFrame).toHaveBeenCalledTimes(1);
    await measurements.nextFrame();
    expect(readHeight).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".renderer-scroll-region__toggle").text()).toBe("Show all output");

    readHeight.mockReturnValue(100);
    measurements.notifyResize();
    measurements.notifyResize();
    expect(measurements.requestFrame).toHaveBeenCalledTimes(2);
    await measurements.nextFrame();
    expect(wrapper.find(".renderer-scroll-region__toggle").exists()).toBe(false);

    measurements.notifyResize();
    wrapper.unmount();
    expect(measurements.disconnect).toHaveBeenCalledOnce();
    expect(measurements.cancelFrame).toHaveBeenCalledWith(3);
    measurements.notifyResize();
    expect(measurements.requestFrame).toHaveBeenCalledTimes(3);
    await measurements.nextFrame();
    expect(readHeight).toHaveBeenCalledTimes(2);
  });
});
