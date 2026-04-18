/**
 * Composable for deduplicating concurrent async calls.
 *
 * When `run()` is called while a previous call is still pending, the existing
 * promise is returned instead of starting a new one. Once the underlying
 * promise settles (resolve or reject), the slot clears so the next call
 * starts fresh.
 *
 * @example
 * ```typescript
 * const inflight = useInflightPromise<User[]>();
 *
 * async function loadUsers() {
 *   return inflight.run(() => fetchUsers());
 * }
 * ```
 */
export interface UseInflightPromiseReturn<T> {
  /**
   * Start the async factory, or return the currently in-flight promise if one
   * exists. The slot clears automatically once the promise settles.
   */
  run(factory: () => Promise<T>): Promise<T>;

  /**
   * Return the in-flight promise, or `null` if nothing is in flight.
   * Useful for early-return checks before applying side effects.
   */
  current(): Promise<T> | null;

  /**
   * Force-clear the in-flight slot. The next `run()` will start a new call
   * even if a previous one is still pending in the background.
   */
  clear(): void;
}

export function useInflightPromise<T>(): UseInflightPromiseReturn<T> {
  let pending: Promise<T> | null = null;

  function run(factory: () => Promise<T>): Promise<T> {
    if (pending) return pending;
    const promise = factory().finally(() => {
      if (pending === promise) pending = null;
    });
    pending = promise;
    return promise;
  }

  function current(): Promise<T> | null {
    return pending;
  }

  function clear(): void {
    pending = null;
  }

  return { run, current, clear };
}
