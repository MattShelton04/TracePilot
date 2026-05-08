import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import {
  COMPLETION_DECEL_MS,
  COMPLETION_FADE_MS,
  COMPLETION_HOLD_MS,
  DISCOVERING_INTERVAL_MS,
  MIN_DISPLAY_MS,
  SAFETY_TIMEOUT_MS,
  useIndexingProgressAnimation,
} from "../useIndexingProgressAnimation";

function makeActions() {
  return {
    showLaneEllipses: vi.fn(),
    setLaneEllipseOpacity: vi.fn(),
    setGlobalSpeedMult: vi.fn(),
    decelerate: vi.fn(),
    clearSeedNodes: vi.fn(),
    createNode: vi.fn(),
    emitPulse: vi.fn(),
    logWarn: vi.fn(),
  };
}

function setup() {
  const actions = makeActions();
  const onComplete = vi.fn();
  const scope = effectScope();
  let api!: ReturnType<typeof useIndexingProgressAnimation>;
  scope.run(() => {
    api = useIndexingProgressAnimation({ actions, onComplete });
  });
  return { api, actions, onComplete, scope };
}

describe("useIndexingProgressAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // performance.now() under fake timers returns advanced ms.
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in idle phase with safe defaults", () => {
    const { api, scope } = setup();
    expect(api.phase.value).toBe("idle");
    expect(api.dismissed.value).toBe(false);
    expect(api.fadingOut.value).toBe(false);
    expect(api.progressPct.value).toBe(0);
    expect(api.sessionCounterText.value).toBe("");
    scope.stop();
  });

  it("onIndexingStarted enters discovering phase and rotates the message", () => {
    const { api, actions, scope } = setup();
    api.start();
    api.onIndexingStarted();

    expect(api.phase.value).toBe("discovering");
    expect(api.showLogo.value).toBe(true);
    expect(actions.showLaneEllipses).toHaveBeenCalled();
    expect(api.discoveringMessageIndex.value).toBe(0);

    vi.advanceTimersByTime(DISCOVERING_INTERVAL_MS);
    expect(api.discoveringMessageIndex.value).toBe(1);
    vi.advanceTimersByTime(DISCOVERING_INTERVAL_MS * 3);
    // Cycles modulo length; just assert it advanced past 1.
    expect(api.discoveringMessageIndex.value).not.toBe(1);
    scope.stop();
  });

  it("onIndexingProgress transitions to indexing, clears seeds, and emits pulses every 10 sessions", () => {
    const { api, actions, scope } = setup();
    api.start();

    api.onIndexingProgress({
      current: 1,
      total: 100,
      sessionRepo: "owner/repo",
      sessionBranch: "main",
      sessionModel: "gpt-5",
      sessionTokens: 1000,
      sessionEvents: 0,
      sessionTurns: 1,
      totalTokens: 1000,
      totalEvents: 0,
      totalRepos: 1,
    });
    expect(api.phase.value).toBe("indexing");
    expect(actions.clearSeedNodes).toHaveBeenCalledTimes(1);
    expect(actions.createNode).toHaveBeenCalledTimes(1);
    expect(api.progressPct.value).toBeCloseTo(1);
    expect(api.sessionCounterText.value).toBe("1 / 100");

    for (let i = 2; i <= 10; i++) {
      api.onIndexingProgress({
        current: i,
        total: 100,
        sessionRepo: "owner/repo",
        sessionBranch: "main",
        sessionModel: "gpt-5",
        sessionTokens: 100,
        sessionEvents: 0,
        sessionTurns: 1,
        totalTokens: 100 * i,
        totalEvents: 0,
        totalRepos: 1,
      });
    }
    expect(actions.emitPulse).toHaveBeenCalledTimes(1);

    // Seeds should not be cleared again on subsequent progress events.
    expect(actions.clearSeedNodes).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("transitions to finalizing past 90% and decelerates orbital speed", () => {
    const { api, actions, scope } = setup();
    api.start();
    api.onIndexingProgress({
      current: 95,
      total: 100,
      sessionRepo: "r",
      sessionBranch: "b",
      sessionModel: null,
      sessionTokens: 0,
      sessionEvents: 0,
      sessionTurns: 0,
      totalTokens: 0,
      totalEvents: 0,
      totalRepos: 1,
    });
    expect(api.phase.value).toBe("finalizing");
    expect(actions.setGlobalSpeedMult).toHaveBeenCalledWith(0.5);
    expect(actions.setLaneEllipseOpacity).toHaveBeenCalledWith("0.2");
    scope.stop();
  });

  it("handleCompletion runs decelerate → fade → onComplete", async () => {
    const { api, actions, onComplete, scope } = setup();
    api.start();
    // Advance past min display so completion proceeds without an extra wait.
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 1);

    const completed = api.handleCompletion();
    // Allow the awaited setTimeout(0)-or-skip path to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(api.phase.value).toBe("complete");
    expect(api.completionFlashActive.value).toBe(true);
    expect(actions.decelerate).toHaveBeenCalledWith(COMPLETION_DECEL_MS);

    vi.advanceTimersByTime(COMPLETION_DECEL_MS + COMPLETION_HOLD_MS);
    expect(api.fadingOut.value).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COMPLETION_FADE_MS);
    expect(api.dismissed.value).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);

    await completed;
    scope.stop();
  });

  it("handleCompletion is idempotent", async () => {
    const { api, actions, onComplete, scope } = setup();
    api.start();
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 1);
    api.handleCompletion();
    api.handleCompletion();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.decelerate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(COMPLETION_DECEL_MS + COMPLETION_HOLD_MS + COMPLETION_FADE_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("safety timeout triggers completion after SAFETY_TIMEOUT_MS", async () => {
    const { api, actions, onComplete, scope } = setup();
    api.start();
    vi.advanceTimersByTime(SAFETY_TIMEOUT_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.logWarn).toHaveBeenCalled();
    expect(api.phase.value).toBe("complete");
    vi.advanceTimersByTime(COMPLETION_DECEL_MS + COMPLETION_HOLD_MS + COMPLETION_FADE_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("stop() clears the discovering interval and pending timers", () => {
    const { api, scope } = setup();
    api.start();
    api.onIndexingStarted();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    api.stop();
    expect(vi.getTimerCount()).toBe(0);
    scope.stop();
  });

  it("scope.stop() runs cleanup automatically (no leaked timers)", () => {
    const { api, scope } = setup();
    api.start();
    api.onIndexingStarted();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    scope.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("onIndexingFinished snaps progress to 100 and starts completion", async () => {
    const { api, scope } = setup();
    api.start();
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 1);
    api.onIndexingFinished();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.progressPct.value).toBe(100);
    expect(api.phase.value).toBe("complete");
    scope.stop();
  });
});
