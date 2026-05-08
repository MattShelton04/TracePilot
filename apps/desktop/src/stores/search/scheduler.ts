export interface SearchSchedulerOptions {
  /** Debounce window for typing-driven scheduling, in milliseconds. */
  delay: number;
  /** Action to execute when the timer (or immediate flush) fires. */
  run: () => void | Promise<void>;
  /**
   * Coalescer for the immediate (non-debounced) path. Defaults to
   * `queueMicrotask`. The Pinia store wires this to Vue's `nextTick` so
   * synchronous filter mutations collapse into a single search.
   */
  immediate?: (cb: () => void) => void;
}

export interface SearchScheduler {
  /**
   * Schedule a run. When `debounce` is true the call is delayed by `delay`ms
   * and any pending debounced run is replaced. When false the run is queued
   * via the immediate coalescer.
   */
  schedule(debounce: boolean): void;
  /** Cancel any pending debounced run. */
  clear(): void;
  /** True while a debounce timer is pending (for tests/debugging). */
  isPending(): boolean;
}

const defaultImmediate = (cb: () => void) => {
  if (typeof queueMicrotask === "function") queueMicrotask(cb);
  else Promise.resolve().then(cb);
};

/**
 * Single-channel debounce/queue factory for the search store.
 *
 * Centralises the "typing → debounce → run" and "filter click → flush → run"
 * paths so the Pinia store's `scheduleSearch` becomes a thin wrapper that
 * only owns hydration/page-watcher concerns.
 */
export function createSearchScheduler(opts: SearchSchedulerOptions): SearchScheduler {
  const immediate = opts.immediate ?? defaultImmediate;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(debounce: boolean) {
    clear();
    if (debounce) {
      timer = setTimeout(() => {
        timer = null;
        void opts.run();
      }, opts.delay);
    } else {
      immediate(() => {
        void opts.run();
      });
    }
  }

  return {
    schedule,
    clear,
    isPending: () => timer !== null,
  };
}
