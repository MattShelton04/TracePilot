import { type MaybeRefOrGetter, onScopeDispose, ref, toValue, watch } from "vue";

/** Optional mapping from the drawn axis to a stable clock (for collapsed idle gaps). */
export interface TimelinePlaybackAxis {
  durationMs: number;
  toAnchor(visualMs: number): number;
  fromAnchor(anchorMs: number): number;
}

export interface TimelinePlaybackOptions {
  /** Seconds a full run takes at 1× speed, whatever the session's length. */
  fullRunSeconds?: number;
}

/**
 * A playhead over a timeline of `durationMs`: play, pause, scrub and speed.
 *
 * Playback compresses the session to `fullRunSeconds` at 1×, so a
 * two-minute session and a two-hour one both replay in a watchable time.
 * The playhead rests at the end, so views show the whole session until the
 * user plays or scrubs.
 */
export function useTimelinePlayback(
  axis: MaybeRefOrGetter<number | TimelinePlaybackAxis>,
  options: TimelinePlaybackOptions = {},
) {
  const fullRunMs = (options.fullRunSeconds ?? 20) * 1000;
  const durationOf = (value: number | TimelinePlaybackAxis) =>
    typeof value === "number" ? value : value.durationMs;
  const duration = () => durationOf(toValue(axis));
  const positionMs = ref(duration());
  const playing = ref(false);
  const speed = ref(1);
  let followingEnd = true;
  let frame = 0;
  let lastFrameAt = 0;

  function stopFrames() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function step(now: number) {
    const end = duration();
    const elapsed = now - lastFrameAt;
    lastFrameAt = now;
    positionMs.value = Math.min(end, positionMs.value + (elapsed * speed.value * end) / fullRunMs);
    if (positionMs.value >= end) {
      followingEnd = true;
      pause();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  function play() {
    const end = duration();
    if (end <= 0) return;
    if (positionMs.value >= end) positionMs.value = 0;
    followingEnd = false;
    playing.value = true;
    lastFrameAt = performance.now();
    stopFrames();
    frame = requestAnimationFrame(step);
  }

  function pause() {
    playing.value = false;
    stopFrames();
  }

  function toggle() {
    if (playing.value) pause();
    else play();
  }

  function seek(ms: number) {
    const end = duration();
    positionMs.value = Math.min(Math.max(0, ms), end);
    followingEnd = positionMs.value >= end;
  }

  watch(
    () => toValue(axis),
    (next, previous) => {
      const end = durationOf(next);
      if (followingEnd) {
        positionMs.value = end;
        return;
      }
      const anchor =
        typeof previous === "number" ? positionMs.value : previous.toAnchor(positionMs.value);
      const mapped = typeof next === "number" ? anchor : next.fromAnchor(anchor);
      positionMs.value = Math.min(Math.max(0, mapped), end);
    },
    { flush: "sync" },
  );

  onScopeDispose(stopFrames);

  return { positionMs, playing, speed, play, pause, toggle, seek };
}

export type TimelinePlayback = ReturnType<typeof useTimelinePlayback>;
