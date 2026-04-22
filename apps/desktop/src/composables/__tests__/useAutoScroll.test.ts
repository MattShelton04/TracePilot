import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { useAutoScroll } from "../useAutoScroll";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Mount a composable with an active Vue app so lifecycle hooks (onMounted etc) run. */
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

/** Create a jsdom div with controllable scroll geometry and a spy on scrollTo. */
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

// ── RAF mock ─────────────────────────────────────────────────────────────────

let rafQueue: Array<FrameRequestCallback> = [];

function flushRaf() {
  const pending = rafQueue.splice(0);
  for (const cb of pending) cb(0);
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  rafQueue = [];
  // useFakeTimers must come FIRST so our RAF stub wins if Vitest's fake-timer
  // implementation also installs a requestAnimationFrame shim.
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false, // prefers-reduced-motion: no → smooth scrolls are used
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("useAutoScroll", () => {
  describe("initial state", () => {
    it("starts with lock off, no overflow, scroll-to-top hidden", () => {
      const state = makeScrollEl({ scrollHeight: 500, clientHeight: 500 }); // no overflow
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );

      expect(result.isLockedToBottom.value).toBe(false);
      expect(result.hasOverflow.value).toBe(false);
      expect(result.showScrollToTop.value).toBe(false);
      unmount();
    });

    it("detects overflow on mount", () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );

      expect(result.hasOverflow.value).toBe(true);
      unmount();
    });
  });

  describe("first data load", () => {
    it("does not engage lock or scroll on first data change", async () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const watchSrc = ref(0);

      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
      );

      watchSrc.value = 1; // first data
      await flushPromises();

      expect(result.isLockedToBottom.value).toBe(false);
      expect(state.scrollSpy).not.toHaveBeenCalled();
      unmount();
    });

    it("updates hasOverflow when content grows on first data change", async () => {
      const state = makeScrollEl({ scrollHeight: 400, clientHeight: 500 }); // fits initially
      const containerRef = ref<HTMLElement | null>(state.el);
      const watchSrc = ref(0);

      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
      );
      expect(result.hasOverflow.value).toBe(false);

      state.setScrollHeight(1000);
      watchSrc.value = 1;
      await flushPromises();

      expect(result.hasOverflow.value).toBe(true);
      unmount();
    });
  });

  describe("data-driven auto-scroll", () => {
    it("scrolls to bottom on data update when locked", async () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const watchSrc = ref(0);

      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
      );

      // First change → sets hasReceivedFirstData = true, does not scroll
      watchSrc.value = 1;
      await flushPromises();
      expect(result.isLockedToBottom.value).toBe(false);

      // Engage auto-scroll lock via scrollToBottom()
      result.scrollToBottom();
      state.scrollSpy.mockClear();

      // Second change → hasReceivedFirstData is true, lock is on → should auto-scroll
      watchSrc.value = 2;
      await flushPromises();

      expect(state.scrollSpy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 1000, behavior: "auto" }),
      );
      unmount();
    });

    it("does not scroll when unlocked", async () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const watchSrc = ref(1);

      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
      );
      await flushPromises();
      expect(result.isLockedToBottom.value).toBe(false);
      state.scrollSpy.mockClear();

      watchSrc.value = 2;
      await flushPromises();

      expect(state.scrollSpy).not.toHaveBeenCalled();
      unmount();
    });
  });

  describe("scroll event handling (hysteresis)", () => {
    it("disengages lock when scrolled well above bottom (above disengage threshold)", () => {
      // scrollHeight=1000, clientHeight=500 → max scrollTop=500
      // scrollTop=100 → distFromBottom = 1000 - 100 - 500 = 400 > default 80
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 100 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );
      result.isLockedToBottom.value = true;

      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      expect(result.isLockedToBottom.value).toBe(false);
      unmount();
    });

    it("does not disengage when scrolled just within the disengage threshold", () => {
      // scrollTop=430 → distFromBottom = 1000 - 430 - 500 = 70 < default 80
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 430 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );
      result.isLockedToBottom.value = true;

      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      expect(result.isLockedToBottom.value).toBe(true);
      unmount();
    });

    it("re-engages lock when scrolled back near the bottom (within engage threshold)", () => {
      // scrollTop=478 → distFromBottom = 1000 - 478 - 500 = 22 < default 24
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 478 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );
      expect(result.isLockedToBottom.value).toBe(false);

      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      expect(result.isLockedToBottom.value).toBe(true);
      unmount();
    });

    it("does not re-engage when not close enough to bottom", () => {
      // scrollTop=200 → distFromBottom = 300 > 24
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 200 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );
      expect(result.isLockedToBottom.value).toBe(false);

      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      expect(result.isLockedToBottom.value).toBe(false);
      unmount();
    });
  });

  describe("scrollToBottom", () => {
    it("sets lock and calls scrollTo", () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );
      state.scrollSpy.mockClear();

      result.scrollToBottom();

      expect(result.isLockedToBottom.value).toBe(true);
      expect(state.scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }));
      unmount();
    });

    it("programmatic guard prevents lock disengagement mid-scroll", () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0), disengageThreshold: 80 }),
      );

      result.scrollToBottom(); // guard activated
      // Simulate scroll event while still far from bottom (mid-animation)
      state.setScrollTop(100); // distFromBottom = 400 > 80
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      // Guard must prevent disengagement
      expect(result.isLockedToBottom.value).toBe(true);
      unmount();
    });

    it("guard clears automatically when position reaches the bottom", () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({
          containerRef,
          watchSource: ref(0),
          engageThreshold: 24,
          disengageThreshold: 80,
        }),
      );

      result.scrollToBottom(); // guard active
      // Arrival at bottom → guard clears
      state.setScrollTop(490); // distFromBottom = 10 ≤ 24
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      // Guard is now gone: a subsequent scroll away from bottom should disengage normally
      state.setScrollTop(100);
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();

      expect(result.isLockedToBottom.value).toBe(false);
      unmount();
    });

    it("guard clears via fallback timeout if element never reaches bottom", () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );

      result.scrollToBottom();
      state.setScrollTop(100); // stuck mid-page
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(result.isLockedToBottom.value).toBe(true); // guard still holding

      vi.advanceTimersByTime(2000); // fallback fires

      state.setScrollTop(100);
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(result.isLockedToBottom.value).toBe(false); // guard gone, disengage works
      unmount();
    });
  });

  describe("scrollToTop", () => {
    it("clears lock and scrolls to top", () => {
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: ref(0) }),
      );
      result.isLockedToBottom.value = true;
      state.scrollSpy.mockClear();

      result.scrollToTop();

      expect(result.isLockedToBottom.value).toBe(false);
      expect(state.scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
      unmount();
    });
  });

  describe("mid-scroll new-message edge case", () => {
    it("maintains lock and auto-scrolls when a new message arrives while smooth scroll is in progress", async () => {
      // Scenario: user clicks ↓ FAB → smooth scroll starts (guard active). Before
      // animation completes, a new message arrives. The guard must remain active so that
      // any scroll event still mid-animation does not disengage the lock. Once the
      // element reaches the new bottom (grown by the new message) the guard clears and
      // subsequent messages continue auto-scrolling normally.
      const state = makeScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
      const containerRef = ref<HTMLElement | null>(state.el);
      const watchSrc = ref(1);

      const { result, unmount } = withSetup(() =>
        useAutoScroll({ containerRef, watchSource: () => watchSrc.value }),
      );
      await flushPromises(); // first-data path
      expect(result.isLockedToBottom.value).toBe(false);

      // User clicks FAB → guard active, lock on
      result.scrollToBottom();
      expect(result.isLockedToBottom.value).toBe(true);

      // New message arrives mid-animation — content grows, instant scroll fires
      state.setScrollHeight(1100);
      watchSrc.value = 2;
      await flushPromises(); // data watcher → nextTick → scrollTo({top:1100, instant})
      state.scrollSpy.mockClear();

      // Scroll event while still mid-page (smooth scroll not done, guard still active)
      state.setScrollTop(400); // distFromBottom = 1100 - 400 - 500 = 200 → not at target
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(result.isLockedToBottom.value).toBe(true); // guard protected it

      // Scroll arrives at new bottom → guard clears
      state.setScrollTop(600); // 1100 - 600 - 500 = 0 ≤ 24
      state.el.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(result.isLockedToBottom.value).toBe(true);

      // Another message → must auto-scroll (lock is still engaged)
      state.setScrollHeight(1200);
      watchSrc.value = 3;
      await flushPromises();

      expect(state.scrollSpy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 1200, behavior: "auto" }),
      );
      unmount();
    });
  });

  describe("cleanup", () => {
    it("removes scroll listener from container on unmount", () => {
      const state = makeScrollEl();
      const containerRef = ref<HTMLElement | null>(state.el);
      const spy = vi.spyOn(state.el, "removeEventListener");

      const { unmount } = withSetup(() => useAutoScroll({ containerRef, watchSource: ref(0) }));
      unmount();

      expect(spy).toHaveBeenCalledWith("scroll", expect.any(Function));
    });
  });
});
