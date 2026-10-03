import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
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

enableAutoUnmount(afterEach);
beforeEach(() => {
  route.name = "overview";
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mountStrip(variant?: "default" | "pill") {
  const wrapper = mount(TabNav, { props: { tabs, variant }, attachTo: document.body });
  // JSDOM has no layout: model three 100px-wide tabs side by side.
  wrapper.findAll("button").forEach((button, index) => {
    Object.defineProperties(button.element, {
      offsetLeft: { value: index * 100 },
      offsetWidth: { value: 100 },
    });
  });
  onResize();
  return wrapper;
}

describe("TabNav ink", () => {
  it("sits under the active tab without animating on first placement", async () => {
    const wrapper = mountStrip();
    await flushPromises();

    const ink = wrapper.get('[data-testid="tab-nav-ink"]');
    expect(ink.attributes("style")).toContain("translateX(0px) scaleX(100)");
    expect(ink.classes()).not.toContain("tab-nav-ink--animated");
  });

  it("slides to the newly active tab", async () => {
    const wrapper = mountStrip();
    await nextTick();

    route.name = "timeline";
    await flushPromises();

    const ink = wrapper.get('[data-testid="tab-nav-ink"]');
    expect(ink.attributes("style")).toContain("translateX(200px) scaleX(100)");
    expect(ink.classes()).toContain("tab-nav-ink--animated");
  });

  it("is not rendered for the pill variant", async () => {
    const wrapper = mountStrip("pill");
    await nextTick();

    expect(wrapper.find('[data-testid="tab-nav-ink"]').exists()).toBe(false);
  });
});
