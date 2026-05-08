import { effectScope, getCurrentScope, isRef, onScopeDispose, type Ref, ref, watch } from "vue";

/**
 * Source for a numeric option that may be a literal, a ref, or a getter.
 * Reactive sources (ref / getter) are tracked so the timer rearms when
 * the interval changes.
 */
export type IntervalSource = number | Ref<number> | (() => number);

/**
 * Source for the optional `enabled` predicate. When the predicate returns
 * `false` the timer keeps ticking but `fn` is never invoked — pause without
 * resetting state.
 */
export type EnabledSource = Ref<boolean> | (() => boolean);

export interface UseIntervalRefreshOptions {
  /** When true, `fn` is invoked once immediately on `start()`. Defaults to false. */
  immediate?: boolean;
  /** Optional gate: when present and falsy, ticks are skipped without firing `fn`. */
  enabled?: EnabledSource;
}

export interface UseIntervalRefreshControls {
  /** Begin ticking. No-op if already running. */
  start(): void;
  /** Stop ticking and clear the underlying timer. */
  stop(): void;
  /** Stop and start again, picking up any new reactive interval value. */
  restart(): void;
  /** True while the composable owns an active timer. */
  isRunning: Ref<boolean>;
}

function toGetter<T>(src: T | Ref<T> | (() => T)): () => T {
  if (typeof src === "function") {
    return src as () => T;
  }
  if (isRef(src)) {
    return () => src.value;
  }
  return () => src as T;
}

/**
 * Reactive interval-refresh composable.
 *
 * - Auto-cleanup on `onScopeDispose` (so it works inside both `setup()` and
 *   any active `effectScope`).
 * - Reactive interval changes restart the timer in-place.
 * - `enabled=false` (or returning false) pauses without firing `fn` — no
 *   timer churn, just a guarded no-op.
 * - Concurrent invocations are guarded: if the previous `fn()` returned a
 *   Promise that has not settled, the next tick is skipped entirely.
 */
export function useIntervalRefresh(
  fn: () => void | Promise<void>,
  intervalMs: IntervalSource,
  opts: UseIntervalRefreshOptions = {},
): UseIntervalRefreshControls {
  const intervalGetter = toGetter<number>(intervalMs);
  const enabledGetter: () => boolean =
    opts.enabled === undefined ? () => true : toGetter<boolean>(opts.enabled);
  const immediate = opts.immediate ?? false;

  let timer: ReturnType<typeof setInterval> | null = null;
  let pending = false;
  const isRunning = ref(false);

  const tick = (): void => {
    if (!enabledGetter()) {
      return;
    }
    if (pending) {
      return;
    }
    let result: void | Promise<void>;
    try {
      result = fn();
    } catch {
      return;
    }
    if (
      result !== undefined &&
      result !== null &&
      typeof (result as Promise<void>).then === "function"
    ) {
      pending = true;
      Promise.resolve(result as Promise<void>).then(
        () => {
          pending = false;
        },
        () => {
          pending = false;
        },
      );
    }
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const armTimer = (): void => {
    clearTimer();
    const ms = intervalGetter();
    timer = setInterval(tick, ms);
  };

  const start = (): void => {
    if (isRunning.value) {
      return;
    }
    isRunning.value = true;
    if (immediate) {
      tick();
    }
    armTimer();
  };

  const stop = (): void => {
    if (!isRunning.value && timer === null) {
      return;
    }
    isRunning.value = false;
    clearTimer();
  };

  const restart = (): void => {
    stop();
    start();
  };

  watch(
    () => intervalGetter(),
    () => {
      if (isRunning.value) {
        armTimer();
      }
    },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop();
    });
  }

  return { start, stop, restart, isRunning };
}

/**
 * Re-export Vue's `effectScope` for convenience in tests; not part of the
 * documented public API.
 * @internal
 */
export { effectScope };
