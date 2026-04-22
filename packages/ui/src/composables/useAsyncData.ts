import { type Ref, ref } from "vue";
import { toErrorMessage } from "../utils/formatters";
import { useAsyncGuard } from "./useAsyncGuard";

/**
 * Options for configuring async data fetching behavior.
 */
export interface UseAsyncDataOptions<TData, _TParams extends unknown[]> {
  /** Initial data value before the first fetch. @default null */
  initialData?: TData | null;

  /** Execute the async function immediately on creation. @default false */
  immediate?: boolean;

  /** Transform error into user-friendly message. @default toErrorMessage */
  onError?: (error: unknown) => string;

  /** Callback invoked on successful execution (e.g. toast notifications). */
  onSuccess?: (data: TData) => void;
}

/**
 * Return type for useAsyncData composable.
 */
export interface UseAsyncDataReturn<TData, TParams extends unknown[]> {
  /** Reactive data ref. Null before first successful fetch or after reset. */
  data: Ref<TData | null>;

  /** Reactive loading state. True while async operation is in progress. */
  loading: Ref<boolean>;

  /** Reactive error message. Null when no error. */
  error: Ref<string | null>;

  /** Execute the async function with given parameters. */
  execute: (...params: TParams) => Promise<void>;

  /** Re-execute with the last used parameters. No-op if never called. */
  refresh: () => Promise<void>;

  /** Clear the current error message. */
  clearError: () => void;

  /** Reset all state to initial values. Invalidates in-flight requests. */
  reset: () => void;
}

/**
 * Composable for managing async data fetching with loading, error, and stale-request prevention.
 *
 * ```typescript
 * const { data, loading, error, execute } = useAsyncData(
 *   async (id: string) => fetchUser(id),
 * );
 * await execute('user-123');
 * ```
 *
 * @param asyncFn - Async function to execute
 * @param options - Configuration options
 */
export function useAsyncData<TData, TParams extends unknown[]>(
  asyncFn: (...params: TParams) => Promise<TData>,
  options: UseAsyncDataOptions<TData, TParams> = {},
): UseAsyncDataReturn<TData, TParams> {
  const { initialData = null, immediate = false, onError = toErrorMessage, onSuccess } = options;

  const data = ref<TData | null>(initialData) as Ref<TData | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  const guard = useAsyncGuard();

  let lastParams: TParams | null = null;

  async function execute(...params: TParams): Promise<void> {
    const token = guard.start();
    loading.value = true;
    error.value = null;
    lastParams = params;

    try {
      const result = await asyncFn(...params);
      if (!guard.isValid(token)) return;

      data.value = result;
      onSuccess?.(result);
    } catch (e) {
      if (!guard.isValid(token)) return;
      error.value = onError(e);
    } finally {
      if (guard.isValid(token)) {
        loading.value = false;
      }
    }
  }

  async function refresh(): Promise<void> {
    if (lastParams === null) return;
    await execute(...lastParams);
  }

  function clearError(): void {
    error.value = null;
  }

  function reset(): void {
    guard.invalidate();
    data.value = initialData ?? null;
    loading.value = false;
    error.value = null;
    lastParams = null;
  }

  if (immediate) {
    execute(...([] as unknown as TParams));
  }

  return { data, loading, error, execute, refresh, clearError, reset };
}
