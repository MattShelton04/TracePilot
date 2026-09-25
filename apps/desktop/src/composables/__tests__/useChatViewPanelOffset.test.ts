import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { useChatViewPanelOffset } from "../useChatViewPanelOffset";

function mountHost(isOpen: ReturnType<typeof ref<boolean>>) {
  let api!: ReturnType<typeof useChatViewPanelOffset>;
  const Host = defineComponent({
    setup() {
      const root = ref<HTMLElement | null>(null);
      api = useChatViewPanelOffset(root, () => isOpen.value ?? false);
      return () =>
        h("div", { class: "page-content" }, [
          h("div", { class: "page-content-inner" }, [h("div", { ref: root, class: "cv-root" })]),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  const root = wrapper.find(".cv-root").element as HTMLElement;
  const scroller = wrapper.find(".page-content").element as HTMLElement;
  return { wrapper, root, scroller, api: () => api };
}

describe("useChatViewPanelOffset", () => {
  it("ignores scroll while the panel is closed and positions it on open", async () => {
    const isOpen = ref(false);
    const { wrapper, root, scroller, api } = mountHost(isOpen);
    let top = 120;
    vi.spyOn(root, "getBoundingClientRect").mockImplementation(
      () => ({ top, bottom: top + 10 }) as DOMRect,
    );

    top = 80;
    scroller.dispatchEvent(new Event("scroll"));
    expect(api().panelTopPx.value).not.toBe(80);

    isOpen.value = true;
    await nextTick();
    expect(api().panelTopPx.value).toBe(80);

    top = 40;
    scroller.dispatchEvent(new Event("scroll"));
    expect(api().panelTopPx.value).toBe(40);
    wrapper.unmount();
  });

  it("does not rewrite unchanged breakout offsets on scroll", () => {
    const isOpen = ref(true);
    const { wrapper, root, scroller } = mountHost(isOpen);
    const setProperty = vi.spyOn(root.style, "setProperty");
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new Event("scroll"));
    expect(setProperty).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
