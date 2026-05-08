import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchScheduler } from "../scheduler";

describe("stores/search/scheduler – createSearchScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces runs by `delay` ms when debounce=true", () => {
    const run = vi.fn();
    const sched = createSearchScheduler({ delay: 150, run });

    sched.schedule(true);
    expect(sched.isPending()).toBe(true);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(149);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sched.isPending()).toBe(false);
  });

  it("collapses repeated debounced schedules into a single run", () => {
    const run = vi.fn();
    const sched = createSearchScheduler({ delay: 50, run });

    sched.schedule(true);
    vi.advanceTimersByTime(40);
    sched.schedule(true);
    vi.advanceTimersByTime(40);
    sched.schedule(true);
    vi.advanceTimersByTime(50);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs immediately via the immediate coalescer when debounce=false", () => {
    const run = vi.fn();
    const queued: Array<() => void> = [];
    const sched = createSearchScheduler({
      delay: 100,
      run,
      immediate: (cb) => queued.push(cb),
    });

    sched.schedule(false);
    expect(run).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);

    queued[0]?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("immediate schedule cancels a pending debounced run", () => {
    const run = vi.fn();
    const queued: Array<() => void> = [];
    const sched = createSearchScheduler({
      delay: 100,
      run,
      immediate: (cb) => queued.push(cb),
    });

    sched.schedule(true);
    expect(sched.isPending()).toBe(true);
    sched.schedule(false);
    expect(sched.isPending()).toBe(false);

    vi.advanceTimersByTime(500);
    expect(run).not.toHaveBeenCalled();

    queued[0]?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clear() cancels a pending debounced run", () => {
    const run = vi.fn();
    const sched = createSearchScheduler({ delay: 100, run });

    sched.schedule(true);
    sched.clear();
    vi.advanceTimersByTime(500);

    expect(run).not.toHaveBeenCalled();
    expect(sched.isPending()).toBe(false);
  });
});
