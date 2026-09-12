import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import TabNav from "../components/TabNav.vue";

const route = reactive({ name: "overview", params: { id: "session" } });
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn() }),
}));

const tabs = [
  { name: "overview", routeName: "overview", label: "Overview" },
  { name: "conversation", routeName: "conversation", label: "Conversation" },
  { name: "timeline", routeName: "timeline", label: "Timeline" },
];

let onResize: () => void;
const disconnect = vi.fn();

enableAutoUnmount(afterEach);
beforeEach(() => {
  route.name = "overview";
  disconnect.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mountStrip(modelValue?: string) {
  const page = document.createElement("main");
  document.body.append(page);
  page.scrollLeft = 40;
  page.scrollTop = 80;
  const wrapper = mount(TabNav, { props: { tabs, modelValue }, attachTo: page });
  const nav = wrapper.get("nav").element;
  // JSDOM has no layout. Model a 300px strip inside a 200px viewport;
  // the real desktop smoke audit separately verifies CSS overflow geometry.
  Object.defineProperty(nav, "clientWidth", { configurable: true, value: 200 });
  wrapper.findAll("button").forEach((button, index) => {
    Object.defineProperties(button.element, {
      offsetLeft: { value: index * 100 },
      offsetWidth: { value: 100 },
    });
  });
  return { wrapper, nav, page };
}

describe("TabNav confined scrolling", () => {
  it("reveals the initially active local tab without moving the page", async () => {
    const { nav, page } = mountStrip("timeline");
    await nextTick();
    expect(nav.scrollLeft).toBe(100);
    expect(page.scrollLeft).toBe(40);
    expect(page.scrollTop).toBe(80);
  });

  it("keeps End/Home keyboard focus visible without activating a tab or scrolling ancestors", async () => {
    const { wrapper, nav, page } = mountStrip("overview");
    await nextTick();
    const buttons = wrapper.findAll("button");
    const focus = vi.spyOn(buttons[2].element, "focus");
    await buttons[0].trigger("keydown", { key: "End" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(buttons[2].element);
    expect(nav.scrollLeft).toBe(100);
    expect(buttons[2].attributes("tabindex")).toBe("0");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await buttons[2].trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(buttons[0].element);
    expect(nav.scrollLeft).toBe(0);
    expect(page.scrollLeft).toBe(40);
    expect(page.scrollTop).toBe(80);
  });

  it("reveals local model changes without taking keyboard focus", async () => {
    const { wrapper, nav } = mountStrip("overview");
    await nextTick();
    const before = document.activeElement;
    await wrapper.setProps({ modelValue: "timeline" });
    await nextTick();
    expect(nav.scrollLeft).toBe(100);
    expect(document.activeElement).toBe(before);
    expect(wrapper.findAll("button")[2].attributes("aria-selected")).toBe("true");
  });

  it("reveals route changes such as browser Back and Forward", async () => {
    const { nav } = mountStrip();
    await nextTick();
    route.name = "timeline";
    await nextTick();
    await nextTick();
    expect(nav.scrollLeft).toBe(100);
    route.name = "overview";
    await nextTick();
    await nextTick();
    expect(nav.scrollLeft).toBe(0);
  });

  it("preserves the focused tab on resize, otherwise reveals the active tab, and disconnects", async () => {
    const { wrapper, nav } = mountStrip("timeline");
    await nextTick();
    wrapper.findAll("button")[1].element.focus();
    Object.defineProperty(nav, "clientWidth", { configurable: true, value: 100 });
    onResize();
    expect(nav.scrollLeft).toBe(100);
    (document.activeElement as HTMLElement).blur();
    onResize();
    expect(nav.scrollLeft).toBe(200);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
