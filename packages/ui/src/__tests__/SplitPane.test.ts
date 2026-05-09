import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import SplitPane from "../components/SplitPane.vue";

describe("SplitPane", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders both panes", () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "test-1", persist: false },
      slots: {
        first: '<div class="p1">A</div>',
        second: '<div class="p2">B</div>',
      },
    });
    expect(wrapper.find(".p1").exists()).toBe(true);
    expect(wrapper.find(".p2").exists()).toBe(true);
  });

  it("sets initial size on the first pane", () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "t-2", initialSize: 240, persist: false },
    });
    const first = wrapper.find(".split__pane--first").element as HTMLElement;
    expect(first.style.width).toBe("240px");
  });

  it("applies vertical orientation class", () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "t-3", orientation: "vertical", persist: false },
    });
    expect(wrapper.classes()).toContain("split--vertical");
  });

  it("handle has separator semantics with valuemin/max/now and aria-controls", () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "t-4", initialSize: 300, min: 100, max: 600, persist: false },
    });
    const handle = wrapper.find(".split__handle");
    expect(handle.attributes("role")).toBe("separator");
    expect(handle.attributes("aria-orientation")).toBe("vertical"); // horizontal pane → vertical separator
    expect(handle.attributes("aria-valuemin")).toBe("100");
    expect(handle.attributes("aria-valuemax")).toBe("600");
    expect(handle.attributes("aria-valuenow")).toBe("300");
    expect(handle.attributes("aria-controls")).toBe("tp-split-t-4-first");
    expect(handle.attributes("tabindex")).toBe("0");
  });

  it("Alt+ArrowRight increases size by 16px (horizontal)", async () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "t-5", initialSize: 200, min: 50, max: 800, persist: false },
    });
    await wrapper.find(".split__handle").trigger("keydown", { key: "ArrowRight", altKey: true });
    await nextTick();
    expect(wrapper.find(".split__handle").attributes("aria-valuenow")).toBe("216");
  });

  it("Alt+Shift+ArrowLeft decreases size by 64px and clamps to min", async () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "t-6", initialSize: 100, min: 50, max: 800, persist: false },
    });
    await wrapper
      .find(".split__handle")
      .trigger("keydown", { key: "ArrowLeft", altKey: true, shiftKey: true });
    await nextTick();
    // 100 - 64 = 36, clamps to min 50.
    expect(wrapper.find(".split__handle").attributes("aria-valuenow")).toBe("50");
  });

  it("Alt+Home resets to initialSize", async () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "t-7", initialSize: 320, min: 50, max: 800, persist: false },
    });
    await wrapper.find(".split__handle").trigger("keydown", { key: "ArrowRight", altKey: true });
    await wrapper.find(".split__handle").trigger("keydown", { key: "Home", altKey: true });
    await nextTick();
    expect(wrapper.find(".split__handle").attributes("aria-valuenow")).toBe("320");
  });

  it("persists size to localStorage under namespaced key", async () => {
    const wrapper = mount(SplitPane, {
      props: { paneId: "persist-1", initialSize: 200, min: 50, max: 800, persist: true },
    });
    await wrapper.find(".split__handle").trigger("keydown", { key: "ArrowRight", altKey: true });
    await nextTick();
    const stored = window.localStorage.getItem("tracepilot:splitpane:persist-1");
    expect(stored).toBe("216");
  });

  it("restores persisted size on mount", () => {
    window.localStorage.setItem("tracepilot:splitpane:persist-2", "420");
    const wrapper = mount(SplitPane, {
      props: { paneId: "persist-2", initialSize: 200, min: 50, max: 800, persist: true },
    });
    expect(wrapper.find(".split__handle").attributes("aria-valuenow")).toBe("420");
  });
});
