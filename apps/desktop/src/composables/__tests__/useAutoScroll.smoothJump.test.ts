// Smooth "jump to bottom" through lazily rendered content (long conversations
// render off-screen turns with `content-visibility: auto`, so the content grows
// while the animation runs). Split from `useAutoScroll.test.ts` to keep that
// suite under the file-size guard-rail.
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

describe("smooth jump through lazily rendered content", () => {
  // Long conversations render off-screen turns on demand, so the content
  // grows while a smooth jump-to-bottom animates.
  async function startJump() {
    const state = makeScrollEl({ scrollHeight: 10_000, clientHeight: 500, scrollTop: 0 });
    const containerRef = ref<HTMLElement | null>(state.el);
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    const watchSrc = ref(1);
    const mounted = withSetup(() =>
      useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
    );
    await flushPromises();
    watchSrc.value = 2; // first data received
    await flushPromises();
    // The jump's smooth animation is still under way: keep scrollTo inert.
    state.scrollSpy.mockImplementation(() => {});
    mounted.result.scrollToBottom();
    state.scrollSpy.mockClear();
    const grow = (h: number) => {
      state.setScrollHeight(h);
      for (const cb of observers) cb([], {} as ResizeObserver);
    };
    return { state, grow, ...mounted };
  }

  it("does not cancel the animation with an instant scroll when content grows", async () => {
    const { state, grow, unmount } = await startJump();
    grow(14_000);
    expect(state.scrollSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("continues smoothly to the new bottom when the animation ends short of it", async () => {
    const { state, grow, unmount } = await startJump();
    grow(14_000);
    state.setScrollTop(9_500); // the first leg's (stale) target
    state.el.dispatchEvent(new Event("scrollend"));
    expect(state.scrollSpy).toHaveBeenCalledWith({ top: 14_000, behavior: "smooth" });
    unmount();
  });

  it("stops steering once the user scrolls during the jump", async () => {
    const { state, grow, unmount } = await startJump();
    state.el.dispatchEvent(new Event("wheel"));
    grow(14_000);
    state.setScrollTop(3_000);
    state.el.dispatchEvent(new Event("scrollend"));
    expect(state.scrollSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    unmount();
  });

  it("falls back to an instant snap if scrollend never arrives", async () => {
    const { state, grow, unmount } = await startJump();
    grow(14_000);
    vi.advanceTimersByTime(2_600);
    expect(state.scrollSpy).toHaveBeenCalledWith({ top: 14_000, behavior: "auto" });
    unmount();
  });
});
