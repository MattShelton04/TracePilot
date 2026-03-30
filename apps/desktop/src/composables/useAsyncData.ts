import { toErrorMessage } from "@tracepilot/ui";
import { type Ref, ref } from "vue";
import { useAsyncGuard } from "./useAsyncGuard";

/**
 * Options for configuring async data fetching behavior.
 */
export interface UseAsyncDataOptions<TData, TParams extends unknown[]> {
  /**
   * Initial data value before the first fetch.
   * @default null
   */
  initialData?: TData | null;

  /**
   * Whether to execute the async function immediately on mount.
   * When true with no params, executes with empty array.
   * @default false
   */
  immediate?: boolean;

  /**
   * Transform error into user-friendly message.
   * @default toErrorMessage from @tracepilot/ui
   */
  onError?: (error: unknown) => string;

  /**
   * Callback invoked when async operation succeeds.
   * Useful for side effects like toast notifications.
   */
  onSuccess?: (data: TData) => void;

  /**
   * Configuration for automatic retry on failure.
   */
  retry?: {
    /**
     * Maximum number of retry attempts.
     * @default 3
     */
    maxAttempts?: number;

    /**
     * Base delay in milliseconds. Uses exponential backoff.
     * Delay = baseDelay * 2^(retryCount - 1)
     * @default 1000
     */
    delay?: number;
  };

  /**
   * If true, data is reset to null when loading starts.
   * Useful for scenarios where stale data should not be displayed.
   * @default false
   */
  resetOnExecute?: boolean;
}

/**
 * Return type for useAsyncData composable.
 */
export interface UseAsyncDataReturn<TData, TParams extends unknown[]> {
  /**
   * Reactive data ref containing the fetched result.
   * Null before first successful fetch or after reset.
   */
  data: Ref<TData | null>;

  /**
   * Reactive loading state.
   * True while async operation is in progress.
   */
  loading: Ref<boolean>;

  /**
   * Reactive error message.
   * Null when no error, string message when error occurs.
   */
  error: Ref<string | null>;

  /**
   * Execute the async function with given parameters.
   * Automatically manages loading state, error handling, and stale request prevention.
   *
   * @param params - Parameters to pass to the async function
   */
  execute: (...params: TParams) => Promise<void>;

  /**
   * Re-execute the async function with the last used parameters.
   * No-op if execute() has never been called.
   */
  refresh: () => Promise<void>;

  /**
   * Clear the current error message.
   * Does not affect loading or data state.
   */
  clearError: () => void;

  /**
   * Reset all state to initial values.
   * Invalidates any in-flight requests.
   */
  reset: () => void;

  /**
   * Retry the last failed operation.
   * Uses exponential backoff if retry is configured.
   * No-op if no previous execution or max retries exceeded.
   */
  retry: () => Promise<void>;

  /**
   * Whether a retry is available.
   * True if last operation failed and retry attempts remain.
   */
  canRetry: Ref<boolean>;
}

/**
 * Composable for managing async data fetching with loading, error, and retry states.
 *
 * Eliminates boilerplate for common async patterns:
 * - Automatic loading state management
 * - Error handling with customizable transformation
 * - Stale request prevention via useAsyncGuard
 * - Optional retry with exponential backoff
 * - Success callbacks for side effects
 *
 * ## Basic Usage
 *
 * ```typescript
 * const { data, loading, error, execute } = useAsyncData(
 *   async (id: string) => {
 *     return await fetchUser(id);
 *   }
 * );
 *
 * // Later, in a handler
 * await execute('user-123');
 * ```
 *
 * ## Immediate Execution
 *
 * ```typescript
 * const { data, loading, error } = useAsyncData(
 *   async () => await fetchSettings(),
 *   { immediate: true }
 * );
 * ```
 *
 * ## With Retry
 *
 * ```typescript
 * const { data, loading, error, retry, canRetry } = useAsyncData(
 *   fetchData,
 *   {
 *     retry: {
 *       maxAttempts: 3,
 *       delay: 1000, // 1s, 2s, 4s
 *     },
 *   }
 * );
 *
 * if (error.value && canRetry.value) {
 *   await retry();
 * }
 * ```
 *
 * ## With Success Callback
 *
 * ```typescript
 * const { data, execute } = useAsyncData(saveSettings, {
 *   onSuccess: () => {
 *     toastSuccess('Settings saved!');
 *   },
 *   onError: (e) => `Failed to save: ${e}`,
 * });
 * ```
 *
 * @template TData - Type of data returned by the async function
 * @template TParams - Tuple type of parameters accepted by the async function
 *
 * @param asyncFn - Async function to execute
 * @param options - Configuration options
 * @returns Object containing reactive state and control methods
 */
export function useAsyncData<TData, TParams extends unknown[]>(
  asyncFn: (...params: TParams) => Promise<TData>,
  options: UseAsyncDataOptions<TData, TParams> = {},
): UseAsyncDataReturn<TData, TParams> {
  const {
    initialData = null,
    immediate = false,
    onError = toErrorMessage,
    onSuccess,
    retry: retryOptions,
    resetOnExecute = false,
  } = options;

  // Reactive state
  const data = ref<TData | null>(initialData) as Ref<TData | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  const guard = useAsyncGuard();

  // Internal state for retry and refresh
  let lastParams: TParams | null = null;
  let retryCount = 0;
  let lastError: unknown = null;

  const canRetry = ref(false);

  /**
   * Core execution logic.
   * Manages loading state, async guard, error handling, and callbacks.
   */
  async function execute(...params: TParams): Promise<void> {
    const token = guard.start();
    loading.value = true;
    error.value = null;
    lastParams = params;
    lastError = null;

    if (resetOnExecute) {
      data.value = null;
    }

    try {
      const result = await asyncFn(...params);

      // Check if this request was superseded
      if (!guard.isValid(token)) return;

      data.value = result;
      retryCount = 0;
      canRetry.value = false;

      // Invoke success callback if provided
      onSuccess?.(result);
    } catch (e) {
      // Check if this request was superseded
      if (!guard.isValid(token)) return;

      lastError = e;
      error.value = onError(e);

      // Determine if retry is available
      const maxRetries = retryOptions?.maxAttempts ?? 3;
      canRetry.value = retryOptions !== undefined && retryCount < maxRetries;
    } finally {
      // Only update loading if this is still the latest request
      if (guard.isValid(token)) {
        loading.value = false;
      }
    }
  }

  /**
   * Re-execute with the last parameters.
   */
  async function refresh(): Promise<void> {
    if (lastParams === null) return;
    await execute(...lastParams);
  }

  /**
   * Retry the last failed operation with exponential backoff.
   */
  async function retry(): Promise<void> {
    if (!retryOptions || !lastParams || !lastError) {
      return;
    }

    const maxRetries = retryOptions.maxAttempts ?? 3;
    if (retryCount >= maxRetries) {
      return;
    }

    retryCount++;

    // Exponential backoff: delay * 2^(retryCount - 1)
    const baseDelay = retryOptions.delay ?? 1000;
    const delay = baseDelay * 2 ** (retryCount - 1);

    await new Promise((resolve) => setTimeout(resolve, delay));
    await execute(...lastParams);
  }

  /**
   * Clear the error message without affecting other state.
   */
  function clearError(): void {
    error.value = null;
    canRetry.value = false;
  }

  /**
   * Reset all state to initial values and invalidate in-flight requests.
   */
  function reset(): void {
    guard.invalidate();
    data.value = initialData ?? null;
    loading.value = false;
    error.value = null;
    lastParams = null;
    lastError = null;
    retryCount = 0;
    canRetry.value = false;
  }

  // Handle immediate execution
  if (immediate) {
    // For immediate execution with params, user should call execute() manually
    // This handles the common case of zero-param functions
    execute(...([] as unknown as TParams));
  }

  return {
    data,
    loading,
    error,
    execute,
    refresh,
    clearError,
    reset,
    retry,
    canRetry,
  };
}
