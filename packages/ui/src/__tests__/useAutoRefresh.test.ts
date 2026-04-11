import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// Mock onBeforeUnmount so the composable can be called outside a component.
// We capture the registered callback so tests can invoke it directly.
let capturedUnmountCallback: (() => void) | null = null;

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue");
  return {
    ...actual,
    onBeforeUnmount: vi.fn((cb: () => void) => {
      capturedUnmountCallback = cb;
    }),
  };
});

import { useAutoRefresh } from "../composables/useAutoRefresh";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simulate the browser firing a visibilitychange event. */
function fireVisibilityChange(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Flush Vue's reactive scheduler (microtask queue) to settle watch callbacks. */
function flushReactivity() {
  return Promise.resolve();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedUnmountCallback = null;
    // Ensure tab is visible by default
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    // Run unmount cleanup to remove event listeners and stop timers
    capturedUnmountCallback?.();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────

  it("starts with refreshing=false and no timer when disabled", () => {
    const onRefresh = vi.fn();
    const enabled = ref(false);
    const { refreshing } = useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(30) });

    expect(refreshing.value).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  // ── Manual refresh ─────────────────────────────────────────────────────

  it("calls onRefresh and manages refreshing state on manual refresh", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { refresh, refreshing } = useAutoRefresh({
      onRefresh,
      enabled: ref(false),
    });

    expect(refreshing.value).toBe(false);
    const promise = refresh();
    expect(refreshing.value).toBe(true);
    await promise;
    expect(refreshing.value).toBe(false);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("in-flight guard: second refresh() call while first is pending returns early", async () => {
    let resolveFirst!: () => void;
    const onRefresh = vi.fn().mockReturnValueOnce(new Promise<void>((r) => (resolveFirst = r)));

    const { refresh, refreshing } = useAutoRefresh({
      onRefresh,
      enabled: ref(false),
    });

    const first = refresh();
    expect(refreshing.value).toBe(true);

    // Second call should be a no-op — resolves immediately
    await refresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;
    expect(refreshing.value).toBe(false);
  });

  it("refreshing resets to false even when onRefresh throws", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("network error"));
    const { refresh, refreshing } = useAutoRefresh({
      onRefresh,
      enabled: ref(false),
    });

    await expect(refresh()).rejects.toThrow("network error");
    expect(refreshing.value).toBe(false);
  });

  // ── Timer reset on manual refresh ─────────────────────────────────────

  it("manual refresh resets the auto-refresh clock (prevents rapid double-refresh)", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    const { refresh } = useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(30) });

    // Advance to T=28s — the auto-refresh timer hasn't fired yet.
    await vi.advanceTimersByTimeAsync(28_000);
    expect(onRefresh).not.toHaveBeenCalled();

    // Manual refresh at T=28s resets the clock.
    await refresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // The old timer would have fired at T=30s (2s from now), but the
    // manual refresh reset the clock. Advancing 2s should not trigger another.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onRefresh).toHaveBeenCalledTimes(1); // no double-refresh

    // Next auto-refresh should fire at T=28+30=T=58s, i.e., 28s from now.
    await vi.advanceTimersByTimeAsync(28_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("manual refresh near timer boundary does not cause a double-refresh", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    const { refresh } = useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(10) });

    // Advance to 1ms before the timer fires.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(onRefresh).not.toHaveBeenCalled();

    // Manual refresh at T≈10s — old timer would fire in 1ms.
    await refresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Advance 1ms past where old timer would have fired — must NOT fire again.
    await vi.advanceTimersByTimeAsync(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // ── Auto-refresh ───────────────────────────────────────────────────────

  it("auto-refresh fires onRefresh after the configured interval", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    expect(onRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("auto-refresh reschedules itself after each tick", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(onRefresh).toHaveBeenCalledTimes(i);
    }
  });

  it("auto-refresh continues after onRefresh throws (error-resilient loop)", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("transient error"));
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    // First tick throws — loop should still continue
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Second tick should fire normally
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("auto-refresh timer fires exactly once per interval (no double-scheduling)", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(10) });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  // ── Page Visibility API ────────────────────────────────────────────────

  it("pauses auto-refresh when tab is hidden", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    fireVisibilityChange(true); // hide — timer stops

    await vi.advanceTimersByTimeAsync(20_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("resumes auto-refresh when tab becomes visible again", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    fireVisibilityChange(true); // hide
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).not.toHaveBeenCalled();

    fireVisibilityChange(false); // show — schedules fresh timer

    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // ── enabled ref toggle ─────────────────────────────────────────────────

  it("stops timer when enabled is toggled to false", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    enabled.value = false;
    await flushReactivity(); // flush Vue watch callback

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("starts timer when enabled is toggled to true", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(false);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).not.toHaveBeenCalled();

    enabled.value = true;
    await flushReactivity(); // flush Vue watch callback

    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // ── intervalSeconds change ─────────────────────────────────────────────

  it("restarts timer with new interval when intervalSeconds changes", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    const intervalSeconds = ref(30);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds });

    // Before the 30s timer fires, change the interval to 5s
    await vi.advanceTimersByTimeAsync(10_000);
    intervalSeconds.value = 5;
    await flushReactivity(); // flush Vue watch callback

    // The 30s timer should be cancelled; new 5s timer fires
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  it("stops timer and removes visibility listener on unmount", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const enabled = ref(true);
    useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    capturedUnmountCallback?.();
    capturedUnmountCallback = null; // prevent afterEach double-invoke

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).not.toHaveBeenCalled();

    // Visibility events should be ignored after unmount
    fireVisibilityChange(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not reschedule timer if unmounted during an in-flight refresh", async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn().mockReturnValue(new Promise<void>((r) => (resolveRefresh = r)));
    const enabled = ref(true);
    const { refresh } = useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    // Kick off a manual refresh
    const refreshPromise = refresh();

    // Unmount while refresh is still in-flight
    capturedUnmountCallback?.();
    capturedUnmountCallback = null;

    // Complete the refresh
    resolveRefresh();
    await refreshPromise;

    // Timer should NOT be rescheduled after dispose
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // ── enabled toggled during in-flight refresh ───────────────────────────

  it("does not reschedule when enabled is turned off during an in-flight refresh", async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn().mockReturnValue(new Promise<void>((r) => (resolveRefresh = r)));
    const enabled = ref(true);
    const { refresh } = useAutoRefresh({ onRefresh, enabled, intervalSeconds: ref(5) });

    const refreshPromise = refresh();

    // Disable auto-refresh while the refresh is in-flight
    enabled.value = false;
    await flushReactivity();

    resolveRefresh();
    await refreshPromise;

    // No timer should be scheduled since enabled=false
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
