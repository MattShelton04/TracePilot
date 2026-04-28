// Regression tests for the popout-window auto-scroll lock bug.
// See `useAutoScroll.test.ts` for the broader behavioural coverage; this file
// isolates the instant-scroll programmatic-guard regression so the parent
// suite stays under the file-size guard-rail.
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { useAutoScroll } from "../useAutoScroll";

function withSetup<T>(fn: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const app = createApp({
    setup() {
      result = fn();
      return {};
    },
    render: () => null as never,
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app.mount(root);
  return {
    result,
    unmount: () => {
      app.unmount();
      root.remove();
    },
  };
}

function makeScrollEl(
  opts: { scrollHeight?: number; clientHeight?: number; scrollTop?: number } = {},
) {
  const el = document.createElement("div");
  let _scrollHeight = opts.scrollHeight ?? 1000;
  const _clientHeight = opts.clientHeight ?? 500;
  let _scrollTop = opts.scrollTop ?? 0;

  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => _scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => _clientHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => _scrollTop,
    set: (v: number) => {
      _scrollTop = v;
    },
  });

  const scrollSpy = vi.fn((scrollOpts: ScrollToOptions) => {
    if (scrollOpts?.top !== undefined) _scrollTop = scrollOpts.top;
  });
  Object.defineProperty(el, "scrollTo", { configurable: true, writable: true, value: scrollSpy });

  return {
    el,
    setScrollHeight: (v: number) => {
      _scrollHeight = v;
    },
    setScrollTop: (v: number) => {
      _scrollTop = v;
    },
    scrollSpy,
  };
}

let rafQueue: Array<FrameRequestCallback> = [];
function flushRaf() {
  const pending = rafQueue.splice(0);
  for (const cb of pending) cb(0);
}

beforeEach(() => {
  rafQueue = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useAutoScroll instant-scroll programmatic guard (popout streaming)", () => {
  it("does not disengage lock when streaming content outpaces the post-scroll handler", async () => {
    // Reproduces the popout-window auto-scroll bug:
    // - User is at the bottom (locked organically, no FAB click).
    // - SDK streaming text grows scrollHeight rapidly.
    // - Data-watcher fires instant `scrollTo({behavior:"auto"})`.
    // - Between scrollTo landing and the resulting `scroll` event,
    //   `scrollHeight` grew further (popout webview timing).
    // - Without an instant-scroll guard, the post-scroll handler sees
    //   `distFromBottom > disengageThreshold` and erroneously flips lock off.
    const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    const containerRef = ref<HTMLElement | null>(state.el);
    const watchSrc = ref(0);

    const { result, unmount } = withSetup(() =>
      useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
    );

    // First-data tick (no scroll), then engage organically.
    watchSrc.value = 1;
    await flushPromises();
    result.isLockedToBottom.value = true;

    // Streaming content grows; data watcher fires.
    state.setScrollHeight(1500);
    watchSrc.value = 2;
    await flushPromises();

    // Webview lag: scroll event lands while scrollHeight has grown again,
    // putting us 300px from the new bottom (well past the 80px disengage).
    state.setScrollHeight(2000);
    state.setScrollTop(1200);
    state.el.dispatchEvent(new Event("scroll"));
    flushRaf();

    expect(result.isLockedToBottom.value).toBe(true);
    unmount();
  });

  it("re-arms the instant guard for each subsequent maintainLock-style scroll", async () => {
    const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    const containerRef = ref<HTMLElement | null>(state.el);
    const watchSrc = ref(0);

    const { result, unmount } = withSetup(() =>
      useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
    );
    watchSrc.value = 1;
    await flushPromises();
    result.isLockedToBottom.value = true;

    state.setScrollHeight(1500);
    watchSrc.value = 2;
    await flushPromises();

    state.setScrollTop(900); // distFromBottom = 100 > 80
    state.el.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(result.isLockedToBottom.value).toBe(true);

    // Advance past the previous safety timeout: only re-arming keeps us safe.
    vi.advanceTimersByTime(1000);

    state.setScrollHeight(2000);
    watchSrc.value = 3;
    await flushPromises();

    state.setScrollTop(1300); // distFromBottom = 200 > 80
    state.el.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(result.isLockedToBottom.value).toBe(true);
    unmount();
  });
});
