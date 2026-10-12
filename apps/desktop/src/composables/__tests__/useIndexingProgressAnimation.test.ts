import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import {
  DISCOVERING_INTERVAL_MS,
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

const FADE_MS = 180;

function setup(fadeMs = FADE_MS) {
  const actions = makeActions();
  const onComplete = vi.fn();
  const scope = effectScope();
  const options = { actions, onComplete, fadeDurationMs: () => fadeMs };
  let api!: ReturnType<typeof useIndexingProgressAnimation>;
  scope.run(() => {
    api = useIndexingProgressAnimation(options);
  });
  return { api, actions, onComplete, scope };
}

describe("useIndexingProgressAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it.each([
    0, 2_000,
  ])("hands off within one fade after indexing finishes at %i ms", async (elapsed) => {
    const { api, onComplete, scope } = setup();
    api.start();
    vi.advanceTimersByTime(elapsed);
    api.onIndexingFinished();
    await vi.advanceTimersByTimeAsync(FADE_MS - 1);
    expect(onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(api.dismissed.value).toBe(true);
    scope.stop();
  });

  it("begins the fade as soon as completion is requested", () => {
    const { api, onComplete, scope } = setup();
    api.start();
    api.handleCompletion();
    expect(api.phase.value).toBe("complete");
    expect(api.completionFlashActive.value).toBe(true);
    expect(api.fadingOut.value).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    scope.stop();
  });

  it("uses the host's fade duration", () => {
    const { api, onComplete, scope } = setup(75);
    api.start();
    api.handleCompletion();
    vi.advanceTimersByTime(74);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("does not wait for a fade when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const { api, onComplete, scope } = setup();
    api.start();
    api.onIndexingFinished();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.prefersReducedMotion.value).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("handleCompletion is idempotent across finish and recovery callbacks", () => {
    const { api, onComplete, scope } = setup();
    api.start();
    api.onIndexingFinished();
    api.handleCompletion();
    vi.advanceTimersByTime(FADE_MS);
    api.onIndexingFinished();
    vi.advanceTimersByTime(FADE_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("safety timeout triggers completion after SAFETY_TIMEOUT_MS", () => {
    const { api, actions, onComplete, scope } = setup();
    api.start();
    vi.advanceTimersByTime(SAFETY_TIMEOUT_MS - 1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(api.phase.value).toBe("idle");
    vi.advanceTimersByTime(1);
    expect(actions.logWarn).toHaveBeenCalled();
    expect(api.phase.value).toBe("complete");
    vi.advanceTimersByTime(FADE_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("waits for completion even after progress reaches 100%", () => {
    const { api, onComplete, scope } = setup();
    api.start();
    api.onIndexingProgress({
      current: 1,
      total: 1,
      sessionRepo: null,
      sessionBranch: null,
      sessionModel: null,
      sessionTokens: 0,
      sessionEvents: 0,
      sessionTurns: 0,
      totalTokens: 0,
      totalEvents: 0,
      totalRepos: 0,
    });
    vi.advanceTimersByTime(2_000);
    expect(api.phase.value).toBe("finalizing");
    expect(api.fadingOut.value).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
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

  it("does not finish after unmount during the fade", async () => {
    const { api, onComplete, scope } = setup();
    api.start();
    api.onIndexingFinished();
    scope.stop();
    await vi.advanceTimersByTimeAsync(SAFETY_TIMEOUT_MS);
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores late recovery callbacks after unmount", async () => {
    const { api, onComplete, scope } = setup();
    api.start();
    scope.stop();
    api.handleCompletion();
    await vi.advanceTimersByTimeAsync(SAFETY_TIMEOUT_MS);
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("onIndexingFinished snaps progress to 100 and starts completion", () => {
    const { api, scope } = setup();
    api.start();
    api.onIndexingFinished();
    expect(api.progressPct.value).toBe(100);
    expect(api.phase.value).toBe("complete");
    scope.stop();
  });
});
