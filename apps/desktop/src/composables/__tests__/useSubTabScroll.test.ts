import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { useSubTabScroll } from "../useSubTabScroll";

/** The sub-tab nav ends this far down the content (header, actions, tabs). */
const NAV_END = 300;
const VIEWPORT = 600;

const sessionId = ref("s1");
const subTab = ref("conversation");
/** Content height per sub-tab; the scroller shows the one last rendered. */
let heights: Record<string, number> = {};
let rendered = "";
let top = 0;
let focusTarget = false;
let scroller: HTMLElement;

/** Resize observers the composable has open; `grow` fires them like a layout change. */
const observers = new Set<FakeResizeObserver>();
class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    observers.add(this);
  }
  disconnect() {
    observers.delete(this);
  }
  fire() {
    this.callback();
  }
}

const maxTop = () => Math.max(0, (heights[rendered] ?? 0) - VIEWPORT);

/** jsdom has no layout: the scroller clamps like a browser and the nav moves with it. */
function fakeLayout(el: HTMLElement) {
  scroller = el;
  Object.defineProperties(el, {
    scrollTop: {
      get: () => Math.min(top, maxTop()),
      set: (v: number) => {
        top = Math.min(Math.max(0, v), maxTop());
      },
      configurable: true,
    },
    scrollHeight: { get: () => heights[rendered] ?? 0, configurable: true },
    clientHeight: { get: () => VIEWPORT, configurable: true },
  });
}

const Harness = defineComponent({
  setup() {
    const el = ref<HTMLElement | null>(null);
    useSubTabScroll({
      el: () => el.value,
      sessionId: () => sessionId.value,
      subTab: () => subTab.value,
      hasFocusTarget: () => focusTarget,
    });
    return () => {
      rendered = `${sessionId.value}/${subTab.value}`;
      return h(
        "div",
        {
          class: "page-content",
          ref: (node) => {
            if (node && node !== el.value) fakeLayout(node as HTMLElement);
            el.value = node as HTMLElement | null;
          },
        },
        [
          h("div", {
            role: "tablist",
            ref: (node) => {
              if (!node) return;
              (node as HTMLElement).getBoundingClientRect = () =>
                ({ top: NAV_END - 40 - top, bottom: NAV_END - top }) as DOMRect;
            },
          }),
          h("p", rendered),
        ],
      );
    };
  },
});

/** The user scrolls to `to` (a scroll event follows, as in a browser). */
function scrollTo(to: number) {
  scroller.scrollTop = to;
  scroller.dispatchEvent(new Event("scroll"));
}

/** The user scrolls to `to` and stays there long enough to be reading. */
function readAt(to: number) {
  scrollTo(to);
  vi.advanceTimersByTime(1000);
}

async function switchTo(tab: string, session = sessionId.value) {
  sessionId.value = session;
  subTab.value = tab;
  await nextTick();
  await nextTick();
}

describe("useSubTabScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    observers.clear();
    sessionId.value = "s1";
    subTab.value = "conversation";
    heights = { "s1/conversation": 4000, "s1/overview": 2000, "s1/metrics": 2500 };
    top = 0;
    focusTarget = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns to where the user was reading after a glance at another sub-tab", async () => {
    const wrapper = mount(Harness);
    readAt(1500);
    // Back up to the nav to reach the tabs, without stopping to read.
    scrollTo(0);

    await switchTo("overview");
    expect(scroller.scrollTop).toBe(0);
    await switchTo("conversation");

    expect(scroller.scrollTop).toBe(1500);
    wrapper.unmount();
  });

  it("starts a sub-tab opened for the first time at the top", async () => {
    const wrapper = mount(Harness);
    // An in-content link switches while the user is deep in the tab.
    scrollTo(1200);

    await switchTo("overview");
    expect(scroller.scrollTop).toBe(0);
    await switchTo("metrics");
    expect(scroller.scrollTop).toBe(0);
    await switchTo("conversation");
    expect(scroller.scrollTop).toBe(1200);
    wrapper.unmount();
  });

  it("keeps a position chosen at the top of the tab", async () => {
    const wrapper = mount(Harness);
    readAt(1500);
    readAt(100);

    await switchTo("overview");
    await switchTo("conversation");

    // 100 is above the nav's end, so the reading position below it is kept.
    expect(scroller.scrollTop).toBe(1500);
    readAt(900);
    await switchTo("overview");
    await switchTo("conversation");
    expect(scroller.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it("does not override a deep link or jump into the sub-tab", async () => {
    const wrapper = mount(Harness);
    readAt(1500);
    await switchTo("overview");

    focusTarget = true;
    subTab.value = "conversation";
    await nextTick();
    // The focus target scrolls the turn into view once it renders.
    scroller.scrollTop = 2600;
    await nextTick();
    vi.advanceTimersByTime(6000);

    expect(scroller.scrollTop).toBe(2600);
    wrapper.unmount();
  });

  it("waits for a sub-tab still loading, then restores", async () => {
    const wrapper = mount(Harness);
    readAt(1500);
    await switchTo("overview");

    heights["s1/conversation"] = 200;
    await switchTo("conversation");
    expect(scroller.scrollTop).toBe(0);

    heights["s1/conversation"] = 4000;
    for (const observer of [...observers]) observer.fire();
    expect(scroller.scrollTop).toBe(1500);
    expect(observers.size).toBe(0);
    wrapper.unmount();
  });

  it("gives up waiting once the user scrolls, the wait runs out, or the session changes", async () => {
    const wrapper = mount(Harness);
    readAt(1500);
    await switchTo("overview");
    const late = () => {
      heights["s1/conversation"] = 4000;
      for (const observer of [...observers]) observer.fire();
    };

    heights["s1/conversation"] = 200;
    await switchTo("conversation");
    scroller.dispatchEvent(new Event("wheel"));
    late();
    expect(scroller.scrollTop).toBe(0);

    await switchTo("overview");
    heights["s1/conversation"] = 200;
    await switchTo("conversation");
    vi.advanceTimersByTime(5000);
    late();
    expect(scroller.scrollTop).toBe(0);
    expect(observers.size).toBe(0);
    wrapper.unmount();
  });

  it("drops a pending restore when the session changes", async () => {
    heights["s2/conversation"] = 3000;
    const wrapper = mount(Harness);
    readAt(1500);
    await switchTo("overview");
    heights["s1/conversation"] = 200;
    await switchTo("conversation");
    expect(observers.size).toBeGreaterThan(0);

    await switchTo("conversation", "s2");
    expect(observers.size).toBe(0);
    expect(scroller.scrollTop).toBe(0);
    wrapper.unmount();
  });

  it("returns a user following the end to the end, after new content arrived", async () => {
    const wrapper = mount(Harness);
    readAt(4000 - VIEWPORT);
    await switchTo("overview");

    heights["s1/conversation"] = 5000;
    await switchTo("conversation");
    vi.advanceTimersByTime(200);

    expect(scroller.scrollTop).toBe(5000 - VIEWPORT);
    wrapper.unmount();
  });

  it("leaves no listener, observer or timer behind on unmount", async () => {
    const wrapper = mount(Harness);
    readAt(1500);
    scrollTo(1400);
    await switchTo("overview");
    heights["s1/conversation"] = 200;
    await switchTo("conversation");
    scrollTo(10);
    const remove = vi.spyOn(scroller, "removeEventListener");

    wrapper.unmount();

    expect(observers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
