import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useIntervalRefresh } from "../useIntervalRefresh";

describe("useIntervalRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire fn before start()", () => {
    const fn = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useIntervalRefresh(fn, 1000);
    });
    vi.advanceTimersByTime(5_000);
    expect(fn).not.toHaveBeenCalled();
    scope.stop();
  });

  it("fires fn on each interval after start()", () => {
    const fn = vi.fn();
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, 1000);
    });
    controls.start();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_500);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(controls.isRunning.value).toBe(true);
    scope.stop();
  });

  it("fires immediately when immediate: true", () => {
    const fn = vi.fn();
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, 1000, { immediate: true });
    });
    controls.start();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("stop() halts further ticks", () => {
    const fn = vi.fn();
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, 1000);
    });
    controls.start();
    vi.advanceTimersByTime(2_000);
    expect(fn).toHaveBeenCalledTimes(2);
    controls.stop();
    expect(controls.isRunning.value).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(fn).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("rearms when a reactive interval changes", async () => {
    const fn = vi.fn();
    const interval = ref(1000);
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, interval);
    });
    controls.start();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);

    interval.value = 250;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    fn.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(4);
    scope.stop();
  });

  it("respects an enabled getter (pauses without firing fn)", () => {
    const fn = vi.fn();
    const enabled = ref(false);
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, 500, { enabled });
    });
    controls.start();
    vi.advanceTimersByTime(2_000);
    expect(fn).not.toHaveBeenCalled();

    enabled.value = true;
    vi.advanceTimersByTime(1_500);
    expect(fn).toHaveBeenCalledTimes(3);
    scope.stop();
  });

  it("cleans up the timer when its effect scope is disposed", () => {
    const fn = vi.fn();
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, 1000);
    });
    controls.start();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);

    scope.stop();
    expect(controls.isRunning.value).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("skips a tick when the previous async fn() has not resolved", async () => {
    let resolveCurrent: (() => void) | null = null;
    const fn = vi.fn((): Promise<void> => {
      return new Promise<void>((resolve) => {
        resolveCurrent = resolve;
      });
    });

    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, 1000);
    });
    controls.start();

    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000);
    expect(fn).toHaveBeenCalledTimes(1);

    (resolveCurrent as (() => void) | null)?.();
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("restart() picks up the latest interval", () => {
    const fn = vi.fn();
    const interval = ref(1000);
    const scope = effectScope();
    let controls!: ReturnType<typeof useIntervalRefresh>;
    scope.run(() => {
      controls = useIntervalRefresh(fn, interval);
    });
    controls.start();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);

    interval.value = 200;
    controls.restart();
    fn.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(5);
    scope.stop();
  });
});
