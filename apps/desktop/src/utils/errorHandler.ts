import type { Ref } from 'vue';
import type { AsyncGuard } from '@/composables/useAsyncGuard';
import { logError, logWarn } from './logger';
import { toErrorMessage } from '@tracepilot/ui';

/**
 * Options for async error handling
 */
export interface AsyncErrorOptions {
  /**
   * Whether to log errors to console and log file.
   * Default: true
   */
  logErrors?: boolean;

  /**
   * Context string for error logging (e.g., function name, operation description).
   * Helps with debugging by providing more context in logs.
   */
  errorContext?: string;
}

/**
 * State refs for async operations with loading and error tracking
 */
export interface AsyncState {
  /**
   * Loading state ref - will be set to true during operation, false after completion or error
   */
  loading?: Ref<boolean>;

  /**
   * Error state ref - will be set to null before operation, error message on failure
   */
  error?: Ref<string | null>;

  /**
   * Optional async guard to prevent stale updates from superseded operations
   */
  guard?: AsyncGuard;
}

/**
 * Standard error handler for async operations with state management.
 *
 * This utility consolidates the common try-catch-finally pattern used throughout
 * the codebase, providing:
 * - Consistent error catching with proper TypeScript typing
 * - Automatic loading state management
 * - Async guard integration for preventing stale updates
 * - Optional error logging with context
 *
 * @example
 * ```typescript
 * const loading = ref(false);
 * const error = ref<string | null>(null);
 * const guard = useAsyncGuard();
 *
 * async function loadData() {
 *   return withAsyncState(
 *     async () => {
 *       const result = await fetchData();
 *       data.value = result;
 *       return result;
 *     },
 *     { loading, error, guard },
 *     { errorContext: 'loadData' }
 *   );
 * }
 * ```
 *
 * @param fn - Async function to execute
 * @param state - State refs for loading, error, and optional guard
 * @param options - Options for error logging
 * @returns Result of fn() or undefined if operation fails or is superseded
 */
export async function withAsyncState<T>(
  fn: () => Promise<T>,
  state: AsyncState,
  options: AsyncErrorOptions = {}
): Promise<T | undefined> {
  const { loading, error, guard } = state;
  const { logErrors = true, errorContext } = options;

  const token = guard?.start();
  if (loading) loading.value = true;
  if (error) error.value = null;

  try {
    const result = await fn();
    // Check if this operation was superseded
    if (guard && token !== undefined && !guard.isValid(token)) {
      return undefined;
    }
    return result;
  } catch (err: unknown) {
    // Check if this operation was superseded
    if (guard && token !== undefined && !guard.isValid(token)) {
      return undefined;
    }

    const message = toErrorMessage(err);
    if (error) error.value = message;

    if (logErrors) {
      const context = errorContext ? `[${errorContext}]` : '';
      logError(`${context} Async operation failed:`, err);
    }

    return undefined;
  } finally {
    // Only update loading state if this operation is still valid
    if (guard && token !== undefined) {
      if (guard.isValid(token)) {
        if (loading) loading.value = false;
      }
    } else if (!guard) {
      if (loading) loading.value = false;
    }
  }
}

/**
 * Wraps an async function with proper error typing and optional logging.
 *
 * This is a simpler version of withAsyncState for cases where you don't need
 * loading state management or async guards - just safe error handling with
 * optional fallback values.
 *
 * @example
 * ```typescript
 * // Returns undefined on error
 * const result = await safeAsync(
 *   () => fetchData(),
 *   { errorContext: 'fetchData' }
 * );
 *
 * // Returns fallback value on error
 * const result = await safeAsync(
 *   () => fetchData(),
 *   { fallback: [], errorContext: 'fetchData' }
 * );
 *
 * // Silent error (no logging)
 * const result = await safeAsync(
 *   () => fetchData(),
 *   { fallback: null, logErrors: false }
 * );
 * ```
 *
 * @param fn - Async function to execute
 * @param options - Options including fallback value and error logging
 * @returns Result of fn(), fallback value, or undefined on error
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  options: AsyncErrorOptions & { fallback?: T } = {}
): Promise<T | undefined> {
  const { fallback, logErrors = true, errorContext } = options;

  try {
    return await fn();
  } catch (err: unknown) {
    if (logErrors) {
      const context = errorContext ? `[${errorContext}]` : '';
      logError(`${context} Operation failed:`, err);
    }
    return fallback;
  }
}

/**
 * Type-safe error catching with proper error typing and optional logging.
 *
 * Use this in catch blocks to extract error messages with consistent typing
 * and optional debug logging.
 *
 * @example
 * ```typescript
 * try {
 *   await operation();
 * } catch (err: unknown) {
 *   error.value = catchError(err, 'operation');
 * }
 * ```
 *
 * @param err - Unknown error from catch block
 * @param context - Optional context for logging (e.g., function name)
 * @returns Formatted error message string
 */
export function catchError(err: unknown, context?: string): string {
  const message = toErrorMessage(err);
  if (context) {
    logWarn(`[${context}]`, err);
  }
  return message;
}

/**
 * Safely wraps a synchronous function with error handling.
 *
 * Useful for operations that might throw but you want to handle gracefully.
 *
 * @example
 * ```typescript
 * const parsed = safeSyncExecute(
 *   () => JSON.parse(rawData),
 *   { fallback: null, errorContext: 'JSON.parse' }
 * );
 * ```
 *
 * @param fn - Synchronous function to execute
 * @param options - Options including fallback value and error logging
 * @returns Result of fn(), fallback value, or undefined on error
 */
export function safeSyncExecute<T>(
  fn: () => T,
  options: AsyncErrorOptions & { fallback?: T } = {}
): T | undefined {
  const { fallback, logErrors = true, errorContext } = options;

  try {
    return fn();
  } catch (err: unknown) {
    if (logErrors) {
      const context = errorContext ? `[${errorContext}]` : '';
      logWarn(`${context} Synchronous operation failed:`, err);
    }
    return fallback;
  }
}
