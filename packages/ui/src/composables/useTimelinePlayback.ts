import { type MaybeRefOrGetter, onScopeDispose, ref, toValue, watch } from "vue";

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
  durationMs: MaybeRefOrGetter<number>,
  options: TimelinePlaybackOptions = {},
) {
  const fullRunMs = (options.fullRunSeconds ?? 20) * 1000;
  const positionMs = ref(toValue(durationMs));
  const playing = ref(false);
  const speed = ref(1);
  let frame = 0;
  let lastFrameAt = 0;

  function stopFrames() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function step(now: number) {
    const duration = toValue(durationMs);
    const elapsed = now - lastFrameAt;
    lastFrameAt = now;
    positionMs.value = Math.min(
      duration,
      positionMs.value + (elapsed * speed.value * duration) / fullRunMs,
    );
    if (positionMs.value >= duration) {
      pause();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  function play() {
    const duration = toValue(durationMs);
    if (duration <= 0) return;
    if (positionMs.value >= duration) positionMs.value = 0;
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
    positionMs.value = Math.min(Math.max(0, ms), toValue(durationMs));
  }

  watch(
    () => toValue(durationMs),
    (duration) => {
      if (!playing.value) positionMs.value = duration;
      else positionMs.value = Math.min(positionMs.value, duration);
    },
  );

  onScopeDispose(stopFrames);

  return { positionMs, playing, speed, play, pause, toggle, seek };
}

export type TimelinePlayback = ReturnType<typeof useTimelinePlayback>;
