import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "../usePolling";
import { useVisibilityGatedPoll } from "../useVisibilityGatedPoll";

/**
 * Flip `document.hidden` + dispatch `visibilitychange`. Node's jsdom doesn't
 * ship Page Visibility with an override, so we redefine the getter per-test.
 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useVisibilityGatedPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("exposes usePolling controls with (fn, intervalMs, options?) signature", () => {
    const scope = effectScope();
    scope.run(() => {
      const controls = useVisibilityGatedPoll(() => {}, 1000, { immediate: false });
      expect(typeof controls.start).toBe("function");
      expect(typeof controls.stop).toBe("function");
      expect(typeof controls.trigger).toBe("function");
      expect(controls.isRunning.value).toBe(false);
    });
    scope.stop();
  });

  it("fires immediately when immediate=true and re-fires on interval", async () => {
    const scope = effectScope();
    const fn = vi.fn();
    scope.run(() => {
      const controls = useVisibilityGatedPoll(fn, 1000);
      controls.start();
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(4);
    scope.stop();
  });

  it("pauses while document is hidden", async () => {
    const scope = effectScope();
    const fn = vi.fn();
    scope.run(() => {
      const controls = useVisibilityGatedPoll(fn, 1000, { immediate: false });
      controls.start();
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("fires an immediate catch-up tick on visibility regain by default", async () => {
    const scope = effectScope();
    const fn = vi.fn();
    scope.run(() => {
      const controls = useVisibilityGatedPoll(fn, 1000, { immediate: false });
      controls.start();
    });

    setHidden(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(0);

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    scope.stop();
  });

  it("does not fire on regain when triggerOnRegain=false", async () => {
    const scope = effectScope();
    const fn = vi.fn();
    scope.run(() => {
      const controls = useVisibilityGatedPoll(fn, 1000, {
        immediate: false,
        triggerOnRegain: false,
      });
      controls.start();
    });

    setHidden(true);
    await vi.advanceTimersByTimeAsync(5000);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("stops cleanly on scope disposal", async () => {
    const fn = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      const controls = useVisibilityGatedPoll(fn, 1000, { immediate: false });
      controls.start();
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    scope.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("usePolling — triggerOnRegain option", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("defaults triggerOnRegain to true", async () => {
    const scope = effectScope();
    const fn = vi.fn();
    scope.run(() => {
      const controls = usePolling(fn, { intervalMs: 1000, immediate: false });
      controls.start();
    });
    setHidden(true);
    await vi.advanceTimersByTimeAsync(2000);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});
