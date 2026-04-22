import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";

import { usePolling } from "../composables/usePolling";

function fireVisibilityChange(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function flushMicrotasks() {
  return Promise.resolve();
}

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does NOT invoke fn before start() is called", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    usePolling(fn, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn immediately when immediate=true (default)", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { start } = usePolling(fn, { intervalMs: 1000 });
    start();
    await flushMicrotasks();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT call fn immediately when immediate=false", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { start } = usePolling(fn, { intervalMs: 1000, immediate: false });
    start();
    await flushMicrotasks();
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires fn on each interval tick", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { start } = usePolling(fn, { intervalMs: 500, immediate: false });
    start();
    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledTimes(i);
    }
  });

  it("does not double-invoke while a previous invocation is still pending", async () => {
    let resolveFirst!: () => void;
    const fn = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);

    const { start } = usePolling(fn, { intervalMs: 100, immediate: true });
    start();
    await flushMicrotasks();
    expect(fn).toHaveBeenCalledTimes(1);

    // Several intervals elapse while the first call is still pending.
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);

    // Resolve first; the next scheduled tick may fire a new call.
    resolveFirst();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("respects pauseWhenHidden: pauses on hidden, resumes on visible", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    // Opt out of regain catch-up tick to keep the legacy "resume=1 tick per
    // interval" semantics under test here. Regain-trigger behaviour has its
    // own test in useVisibilityGatedPoll.test.ts.
    const { start } = usePolling(fn, {
      intervalMs: 1000,
      immediate: false,
      triggerOnRegain: false,
    });
    start();

    fireVisibilityChange(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled();

    fireVisibilityChange(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("pauseWhenHidden=false: keeps polling when document is hidden", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { start } = usePolling(fn, {
      intervalMs: 1000,
      immediate: false,
      pauseWhenHidden: false,
    });
    start();
    fireVisibilityChange(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    // restore
    fireVisibilityChange(false);
  });

  it("active=ref(false) pauses; flipping to true resumes", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const active = ref(false);
    const { start } = usePolling(fn, { intervalMs: 1000, immediate: false, active });
    start();

    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).not.toHaveBeenCalled();

    active.value = true;
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stop() clears the interval and further ticks do not fire", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { start, stop } = usePolling(fn, { intervalMs: 500, immediate: false });
    start();
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent", () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { start, stop, isRunning } = usePolling(fn, { intervalMs: 500, immediate: false });
    start();
    expect(isRunning.value).toBe(true);
    stop();
    stop();
    stop();
    expect(isRunning.value).toBe(false);
  });

  it("cleans up timer and listeners when enclosing effect scope is disposed", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const scope = effectScope();
    scope.run(() => {
      const { start } = usePolling(fn, { intervalMs: 500, immediate: false });
      start();
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);

    scope.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Visibility events after disposal must not re-trigger
    fireVisibilityChange(true);
    fireVisibilityChange(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("swallowErrors=true invokes onError and keeps polling", async () => {
    const err = new Error("boom");
    const fn = vi.fn().mockRejectedValue(err);
    const onError = vi.fn();
    const { start } = usePolling(fn, {
      intervalMs: 500,
      immediate: false,
      swallowErrors: true,
      onError,
    });
    start();

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);

    // Loop continues after error
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("swallowErrors=false lets the error escape through trigger()", async () => {
    const err = new Error("nope");
    const fn = vi.fn().mockRejectedValue(err);
    const { trigger } = usePolling(fn, {
      intervalMs: 500,
      immediate: false,
      swallowErrors: false,
    });
    await expect(trigger()).rejects.toThrow("nope");
  });

  it("trigger() respects the in-flight guard", async () => {
    let resolveFirst!: () => void;
    const fn = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);

    const { trigger } = usePolling(fn, { intervalMs: 500, immediate: false });
    const first = trigger();
    await trigger(); // should be a no-op
    expect(fn).toHaveBeenCalledTimes(1);
    resolveFirst();
    await first;
    await trigger();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
