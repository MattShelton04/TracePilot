import { type UsePollingControls, type UsePollingOptions, usePolling } from "./usePolling";

/**
 * Options for `useVisibilityGatedPoll` — a subset of `UsePollingOptions`
 * with `intervalMs` hoisted to a positional argument. `pauseWhenHidden` is
 * always on here (that's the whole point of this composable) so it is not
 * exposed.
 */
export type UseVisibilityGatedPollOptions = Omit<
  UsePollingOptions,
  "intervalMs" | "pauseWhenHidden"
>;

/**
 * Visibility-gated polling — pauses while `document.visibilityState === 'hidden'`
 * and resumes on regain. Thin wrapper around {@link usePolling} with the
 * `(fn, intervalMs, options?)` signature preferred for new call-sites.
 *
 * Defaults:
 * - `immediate: true`            — leading-edge first fire
 * - `triggerOnRegain: true`      — catch-up tick on visibility regain
 * - `swallowErrors: true`        — keep the loop alive across transient failures
 *
 * Cleanup is automatic via `onScopeDispose` inside `usePolling`, so the
 * consumer only needs to call `.stop()` when torn down outside of any scope.
 */
export function useVisibilityGatedPoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options: UseVisibilityGatedPollOptions = {},
): UsePollingControls {
  return usePolling(fn, {
    ...options,
    intervalMs,
    pauseWhenHidden: true,
  });
}
