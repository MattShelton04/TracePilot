import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { type TimelinePlaybackAxis, useTimelinePlayback } from "../composables/useTimelinePlayback";

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

  it("keeps a scrubbed position when new events extend the session", async () => {
    const { playback, duration } = setup();
    playback.play();
    frame(1_000);
    playback.pause();
    frame(1_000);
    expect(playback.positionMs.value).toBeCloseTo(6_000);
    playback.seek(-5);
    expect(playback.positionMs.value).toBe(0);
    duration.value = 90_000;
    await nextTick();
    expect(playback.positionMs.value).toBe(0);
    playback.seek(18_000);
    duration.value = 120_000;
    await nextTick();
    expect(playback.positionMs.value).toBe(18_000);
    playback.seek(200_000);
    expect(playback.positionMs.value).toBe(120_000);
    duration.value = 30_000;
    await nextTick();
    expect(playback.positionMs.value).toBe(30_000);
  });

  it("follows new events while resting at the end", async () => {
    const { playback, duration } = setup();
    duration.value = 90_000;
    await nextTick();
    expect(playback.positionMs.value).toBe(90_000);
    playback.seek(45_000);
    playback.seek(90_000);
    duration.value = 120_000;
    await nextTick();
    expect(playback.positionMs.value).toBe(120_000);
  });

  it("preserves the real timestamp when an idle-gap scale changes", async () => {
    const axis = ref<TimelinePlaybackAxis>({
      durationMs: 100,
      toAnchor: (v) => v * 10,
      fromAnchor: (ms) => ms / 10,
    });
    const scope = effectScope();
    const playback = scope.run(() => useTimelinePlayback(axis));
    if (!playback) throw new Error("no playback");
    playback.seek(50); // Real timestamp 500.

    axis.value = {
      durationMs: 100,
      toAnchor: (v) => v * 20,
      fromAnchor: (ms) => ms / 20,
    };
    await nextTick();
    expect(playback.positionMs.value).toBe(25);

    playback.play();
    axis.value = {
      durationMs: 200,
      toAnchor: (v) => v * 5,
      fromAnchor: (ms) => ms / 5,
    };
    await nextTick();
    expect(playback.positionMs.value).toBe(100);
    expect(playback.playing.value).toBe(true);
    scope.stop();
  });

  it("stops animating when its scope is disposed", () => {
    const { playback, scope } = setup();
    playback.play();
    scope.stop();
    expect(queued).toHaveLength(0);
  });
});
