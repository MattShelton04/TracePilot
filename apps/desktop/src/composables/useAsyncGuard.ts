/**
 * Composable for preventing stale async writes when operations can be superseded.
 *
 * Common pattern: User triggers action A, then quickly action B.
 * Without guards, B might complete first, then A overwrites with stale data.
 *
 * This composable provides a simple generation-based token system to prevent
 * stale updates from earlier requests.
 *
 * @example
 * ```typescript
 * const guard = useAsyncGuard();
 *
 * async function loadData(id: string) {
 *   const token = guard.start();
 *   const data = await fetchData(id);
 *   if (!guard.isValid(token)) return; // Stale request, abort
 *   state.value = data;
 * }
 * ```
 */

/**
 * Token returned by guard.start().
 * Tracks a specific async operation generation.
 */
export type AsyncGuardToken = number;

/**
 * Async guard interface for preventing stale async writes.
 */
export interface AsyncGuard {
  /**
   * Start a new async operation, invalidating all previous tokens.
   *
   * @returns Token to check later with isValid()
   *
   * @example
   * ```typescript
   * const token = guard.start();
   * const data = await fetchData();
   * if (!guard.isValid(token)) return;
   * state.value = data;
   * ```
   */
  start(): AsyncGuardToken;

  /**
   * Check if a token is still valid (no newer operations have started).
   *
   * @param token - Token from guard.start()
   * @returns true if this is still the latest operation, false if superseded
   *
   * @example
   * ```typescript
   * if (!guard.isValid(token)) {
   *   console.log('Request was superseded, ignoring result');
   *   return;
   * }
   * ```
   */
  isValid(token: AsyncGuardToken): boolean;

  /**
   * Invalidate all tokens without starting a new operation.
   * Useful for cleanup/reset scenarios.
   *
   * @example
   * ```typescript
   * function reset() {
   *   guard.invalidate();
   *   state.value = null;
   * }
   * ```
   */
  invalidate(): void;

  /**
   * Get current generation for debugging.
   * Only available in development builds.
   *
   * @internal
   */
  _debug?(): { generation: number };
}

/**
 * Creates an async request guard for preventing stale async writes.
 *
 * ## When to Use
 * - User-triggered actions that can be rapidly repeated (session switching, search)
 * - Pagination or filtering that updates the same state
 * - Any async operation where completion order matters
 *
 * ## When NOT to Use
 * - One-time initialization
 * - Independent operations that don't share state
 * - Operations where all results should be kept (e.g., loading multiple independent resources)
 *
 * ## Multiple Guards
 * Use separate guard instances for independent concerns:
 * ```typescript
 * const sessionGuard = useAsyncGuard(); // For session switching
 * const eventsGuard = useAsyncGuard();  // For events pagination
 * ```
 *
 * ## Error Handling
 * Guards work the same in error paths:
 * ```typescript
 * try {
 *   const data = await fetchData();
 *   if (!guard.isValid(token)) return;
 *   state.value = data;
 * } catch (e) {
 *   if (!guard.isValid(token)) return; // Don't show stale errors
 *   error.value = String(e);
 * }
 * ```
 *
 * @returns AsyncGuard instance with start(), isValid(), and invalidate() methods
 */
export function useAsyncGuard(): AsyncGuard {
  let generation = 0;

  const guard: AsyncGuard = {
    start(): AsyncGuardToken {
      return ++generation;
    },

    isValid(token: AsyncGuardToken): boolean {
      return token === generation;
    },

    invalidate(): void {
      generation++;
    },
  };

  // Add debug helper in development
  if (import.meta.env.DEV) {
    guard._debug = () => ({ generation });
  }

  return guard;
}
