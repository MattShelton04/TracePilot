import type { Ref } from "vue";
import { toErrorMessage } from "../utils/formatters";

/**
 * Minimal async-guard contract used by {@link runAction}.
 * Compatible with the `useAsyncGuard()` composable in `@tracepilot/desktop`.
 */
export interface AsyncGuardLike {
  start(): number;
  isValid(token: number): boolean;
}

/**
 * Options for a guarded query/load action.
 *
 * Wraps the common store pattern:
 *   loading = true → call API → onSuccess → loading = false
 * with optional stale-request guard support.
 */
export interface RunActionOptions<T> {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  guard?: AsyncGuardLike;
  action: () => Promise<T>;
  onSuccess: (result: T) => void;
}

/**
 * Execute a guarded query/load action that manages loading + error state.
 *
 * ```ts
 * await runAction({
 *   loading, error, guard: loadGuard,
 *   action: () => skillsListAll(repoRoot),
 *   onSuccess: (result) => { skills.value = result; },
 * });
 * ```
 */
export async function runAction<T>(opts: RunActionOptions<T>): Promise<void> {
  const token = opts.guard?.start();

  opts.loading.value = true;
  opts.error.value = null;

  try {
    const result = await opts.action();

    if (token !== undefined && !opts.guard!.isValid(token)) return;
    opts.onSuccess(result);
  } catch (e) {
    if (token !== undefined && !opts.guard!.isValid(token)) return;
    opts.error.value = toErrorMessage(e);
  } finally {
    if (token === undefined || opts.guard!.isValid(token)) {
      opts.loading.value = false;
    }
  }
}

/**
 * Execute a mutation (create/update/delete) that manages error state.
 *
 * Returns the action's result on success, or `null` on failure.
 * The caller handles any reload or local-state patch inside `action`.
 *
 * ```ts
 * // mutation + reload
 * const dir = await runMutation(error, async () => {
 *   const d = await skillsCreate(name, desc, body);
 *   await loadSkills();
 *   return d;
 * });
 *
 * // mutation + local patch
 * const ok = await runMutation(error, async () => {
 *   await skillsDelete(dir);
 *   skills.value = skills.value.filter(s => s.directory !== dir);
 *   return true as const;
 * });
 * ```
 */
export async function runMutation<T>(
  error: Ref<string | null>,
  action: () => Promise<T>,
): Promise<T | null> {
  error.value = null;
  try {
    return await action();
  } catch (e) {
    error.value = toErrorMessage(e);
    return null;
  }
}
