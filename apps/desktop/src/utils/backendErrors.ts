/**
 * Centralized backend error classification and user-friendly message mapping.
 *
 * The Rust backend sends specific error strings over IPC (e.g. "ALREADY_INDEXING"
 * from `BindingsError::AlreadyIndexing`). FTS5 errors arrive from SQLite as
 * "fts5: syntax error: ...". This module provides type-safe guards and friendly
 * messages, replacing scattered inline string checks throughout the frontend.
 */

/**
 * Check whether an error message indicates an indexing operation is already
 * in progress.
 *
 * Matches the exact `"ALREADY_INDEXING"` sentinel emitted by the Rust backend,
 * plus a loose case-insensitive substring check to guard against future backend
 * changes that might wrap the sentinel in a longer message.
 */
export function isAlreadyIndexingError(error: string): boolean {
  return error === 'ALREADY_INDEXING' || error.toLowerCase().includes('already indexing');
}

/**
 * Check whether an error message indicates an FTS5 search syntax error from
 * SQLite.
 *
 * Only matches the `fts5:` prefix used by SQLite's FTS5 engine — intentionally
 * does **not** match generic "parse error" strings that could originate from
 * JSON / YAML / session parsing elsewhere in the Rust backend.
 */
export function isSearchSyntaxError(error: string): boolean {
  return error.includes('fts5: syntax error') || error.includes('fts5 syntax error');
}

/**
 * Map a raw backend error string to a user-friendly message.
 *
 * Returns the original error string if no mapping matches.
 * Returns `null` if the input is null, undefined, or empty.
 */
export function toFriendlyErrorMessage(error: string | null | undefined): string | null {
  if (!error) return null;

  if (isSearchSyntaxError(error)) {
    return 'Invalid search syntax. Try simpler terms, or use quotes for exact phrases. Operators like AND, OR, NOT must be between search terms.';
  }

  if (isAlreadyIndexingError(error)) {
    return 'Indexing is already in progress. Please wait for the current index to complete.';
  }

  return error;
}
