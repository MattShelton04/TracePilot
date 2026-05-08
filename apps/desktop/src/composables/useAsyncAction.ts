import { useToast } from "@tracepilot/ui";
import type { Ref } from "vue";
import { logError } from "@/utils/logger";

/**
 * Options for {@link runUiAction}.
 */
export interface RunUiActionOptions<T> {
  /** The async work to execute. */
  run: () => Promise<T>;
  /**
   * Optional custom error handler. When supplied, the default error toast is
   * suppressed; the handler is responsible for surfacing the failure.
   * The error is always logged via the desktop logger regardless.
   */
  onError?: (e: unknown) => void;
  /** When provided, a success toast is shown with this message after `run` resolves. */
  toastSuccess?: string;
  /**
   * Optional log/toast prefix (e.g. `"[export]"`). Used for consistent log
   * formatting and as the toast title when defaulting the error message.
   */
  errorLabel?: string;
}

/**
 * Wraps a UI action with a consistent try/catch:
 *   - logs failures via {@link logError}
 *   - shows a success toast if `toastSuccess` is provided
 *   - shows an error toast (or defers to `onError` if provided)
 *
 * Returns the resolved value, or `undefined` when the action threw.
 */
export async function runUiAction<T>(options: RunUiActionOptions<T>): Promise<T | undefined> {
  const { run, onError, toastSuccess, errorLabel } = options;
  const { success, error: toastError } = useToast();
  try {
    const result = await run();
    if (toastSuccess) {
      success(toastSuccess);
    }
    return result;
  } catch (e) {
    logError(errorLabel ? `${errorLabel} failed:` : "[runUiAction] failed:", e);
    if (onError) {
      onError(e);
    } else {
      toastError(e instanceof Error ? e.message : "Action failed");
    }
    return undefined;
  }
}

/**
 * Shape of a Pinia/composable store fragment that exposes loading + error refs.
 */
export interface LoadingErrorState {
  loading: Ref<boolean>;
  error: Ref<string | null>;
}

/**
 * Options for {@link withStoreAction}.
 */
export interface WithStoreActionOptions<T> {
  state: LoadingErrorState;
  fn: () => Promise<T>;
}

/**
 * Drives a `{ loading, error }` store action:
 *   - sets `loading=true`, clears `error`
 *   - runs `fn`
 *   - on failure, stores the error message and rethrows-as-undefined
 *   - always resets `loading=false`
 *
 * Returns the resolved value, or `undefined` when the action threw.
 * Use this when call sites already manage their own toasting/notification —
 * for UI-level wrapping with toasts, prefer {@link runUiAction}.
 */
export async function withStoreAction<T>(
  options: WithStoreActionOptions<T>,
): Promise<T | undefined> {
  const { state, fn } = options;
  state.loading.value = true;
  state.error.value = null;
  try {
    return await fn();
  } catch (e) {
    state.error.value = e instanceof Error ? e.message : String(e);
    return undefined;
  } finally {
    state.loading.value = false;
  }
}
