import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import SessionTabStrip from "@/components/layout/SessionTabStrip.vue";
import { useSessionTabsStore } from "@/stores/sessionTabs";

vi.mock("@tracepilot/client", () => ({ openSessionWindow: vi.fn() }));

// A 300px strip whose tabs are each 100px wide, starting 40px in (after the
// Home pill and separator). jsdom has no layout, so geometry is stubbed here.
const STRIP_WIDTH = 300;
const TAB_START = 40;
const TAB_WIDTH = 100;

const scrollLefts = new WeakMap<Element, number>();
const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
  scrollLefts.set(this, options.left ?? 0);
});
const stubbed = ["clientWidth", "scrollLeft", "getBoundingClientRect", "scrollTo"] as const;
const originals = new Map(
  stubbed.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]),
);
const isStrip = (el: Element) => el.classList.contains("session-tab-strip");

function stubLayout() {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return isStrip(this) ? STRIP_WIDTH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollLefts.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrollLefts.set(this, value);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const strip = this.closest(".session-tab-strip");
      if (!strip || this === strip) return new DOMRect(0, 0, STRIP_WIDTH, 36);
      const index = [...strip.querySelectorAll('[role="tab"]')].indexOf(this);
      const scroll = scrollLefts.get(strip) ?? 0;
      return new DOMRect(TAB_START + index * TAB_WIDTH - scroll, 4, TAB_WIDTH, 32);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
}

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }),
  });
}

enableAutoUnmount(afterEach);
beforeEach(() => {
  localStorage.clear();
  setupPinia();
  scrollTo.mockClear();
  stubLayout();
  setReducedMotion(false);
});
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
  Reflect.deleteProperty(window, "matchMedia");
});

async function setup(ids = ["one", "two"]) {
  const store = useSessionTabsStore();
  for (const id of ids) store.openTab(id, `Audit ${id}`);
  const host = mount(
    defineComponent({
      setup: () => () =>
        h("div", [
          h("button", { id: "outside" }, "Outside"),
          h(SessionTabStrip, { isSessionListRoute: true }),
        ]),
    }),
    { attachTo: document.body },
  );
  await flushPromises();
  const strip = host.get<HTMLElement>(".session-tab-strip").element;
  return { store, host, strip };
}

describe("session tab strip keeps the active tab in view", () => {
  it("scrolls a newly opened tab past the right edge into view without moving focus", async () => {
    const { store, host, strip } = await setup();
    expect(scrollTo).not.toHaveBeenCalled();
    const outside = host.get<HTMLButtonElement>("#outside").element;
    outside.focus();

    for (const id of ["three", "four", "five"]) store.openTab(id, `Audit ${id}`);
    await flushPromises();

    // Tab five spans 440–540; the strip shows 0–300, so it scrolls by 240.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 240, behavior: "smooth" });
    expect(scrollTo.mock.contexts.at(-1)).toBe(strip);
    expect(strip.scrollLeft).toBe(240);
    expect(document.activeElement).toBe(outside);
  });

  it("scrolls back to an active tab hidden past the left edge", async () => {
    const { store, strip } = await setup(["one", "two", "three", "four", "five"]);
    expect(strip.scrollLeft).toBe(240);

    store.activateTab("one");
    await flushPromises();

    expect(scrollTo).toHaveBeenLastCalledWith({ left: TAB_START, behavior: "smooth" });
    expect(strip.scrollLeft).toBe(TAB_START);
  });

  it("leaves the strip alone when the active tab is already visible", async () => {
    const { store } = await setup(["one", "two"]);
    store.activateTab("one");
    await flushPromises();
    store.updateLabel("one", "A longer audit label");
    await flushPromises();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("jumps instead of animating when reduced motion is preferred", async () => {
    setReducedMotion(true);
    const { store } = await setup();
    store.openTab("three", "Audit three");
    await flushPromises();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 40, behavior: "auto" });
  });
});
