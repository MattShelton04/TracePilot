import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useTimelinePlayback } from "../composables/useTimelinePlayback";

// Drive animation frames by hand: each `frame(ms)` advances the clock and runs queued callbacks.
let now = 0;
let queued: FrameRequestCallback[] = [];

function frame(elapsedMs: number) {
  now += elapsedMs;
  const run = queued;
  queued = [];
  for (const cb of run) cb(now);
}

beforeEach(() => {
  now = 0;
  queued = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    queued = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(durationMs = 60_000) {
  const duration = ref(durationMs);
  const scope = effectScope();
  const playback = scope.run(() => useTimelinePlayback(duration, { fullRunSeconds: 10 }));
  if (!playback) throw new Error("no playback");
  return { playback, duration, scope };
}

describe("useTimelinePlayback", () => {
  it("rests at the end so the whole session shows", () => {
    const { playback } = setup();
    expect(playback.positionMs.value).toBe(60_000);
    expect(playback.playing.value).toBe(false);
  });

  it("replays from the start, compressing the session to the full-run length", () => {
    const { playback } = setup();
    playback.play();
    expect(playback.positionMs.value).toBe(0);
    frame(1_000); // 1s of a 10s run covers a tenth of the session
    expect(playback.positionMs.value).toBeCloseTo(6_000);
    playback.speed.value = 2;
    frame(1_000);
    expect(playback.positionMs.value).toBeCloseTo(18_000);
  });

  it("stops at the end", () => {
    const { playback } = setup();
    playback.play();
    frame(20_000);
    expect(playback.positionMs.value).toBe(60_000);
    expect(playback.playing.value).toBe(false);
  });

  it("pauses, seeks within bounds and follows a changing duration", async () => {
    const { playback, duration } = setup();
    playback.play();
    frame(1_000);
    playback.pause();
    frame(1_000);
    expect(playback.positionMs.value).toBeCloseTo(6_000);
    playback.seek(-5);
    expect(playback.positionMs.value).toBe(0);
    playback.seek(90_000);
    expect(playback.positionMs.value).toBe(60_000);
    duration.value = 30_000;
    await nextTick();
    expect(playback.positionMs.value).toBe(30_000);
  });

  it("stops animating when its scope is disposed", () => {
    const { playback, scope } = setup();
    playback.play();
    scope.stop();
    expect(queued).toHaveLength(0);
  });
});
