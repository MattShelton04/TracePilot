import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import RendererScrollRegion from "../components/RendererScrollRegion.vue";

afterEach(() => vi.unstubAllGlobals());

describe("renderer scroll regions", () => {
  it("resets replaced pages without collapsing an expanded region or moving focus", async () => {
    const measurements: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          measurements.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
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
    for (const measure of measurements) measure();
    await flushPromises();
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
});
