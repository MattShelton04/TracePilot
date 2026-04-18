/**
 * Centralized backend error classification and user-friendly message mapping.
 *
 * The Rust backend sends structured errors over IPC using the envelope shape
 * `{ code: string, message: string }` (see `crates/tracepilot-tauri-bindings/src/error.rs`).
 * Legacy string errors from older commands are still supported by the substring
 * fallbacks so the frontend works across both shapes during the rollout.
 */

/** Error envelope shape emitted by the Rust backend (structured errors). */
export interface BackendErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

/** Duck-type check for {@link BackendErrorEnvelope}. */
export function isBackendErrorEnvelope(e: unknown): e is BackendErrorEnvelope {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/**
 * Extract the stable backend error code (e.g. `"ALREADY_INDEXING"`) from an
 * error value, or `null` if the value is not a structured backend error.
 *
 * Accepts:
 *   - structured `{ code, message }` envelope (preferred — new commands)
 *   - plain `Error` with `code` property
 *   - unknown (returns null)
 */
export function getErrorCode(e: unknown): string | null {
  if (isBackendErrorEnvelope(e)) return e.code;
  if (typeof e === "object" && e !== null) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/**
 * Check whether an error indicates an indexing operation is already in
 * progress. Prefers the structured `code` field when available; falls back
 * to a case-insensitive substring match on the legacy string shape.
 *
 * Accepts either the raw error object from a backend call or a pre-extracted
 * message string (backward-compatible with the v0.5 call sites).
 */
export function isAlreadyIndexingError(error: unknown): boolean {
  if (getErrorCode(error) === "ALREADY_INDEXING") return true;

  const msg =
    typeof error === "string"
      ? error
      : isBackendErrorEnvelope(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "";

  if (!msg) return false;
  if (msg === "ALREADY_INDEXING") return true;
  const lower = msg.toLowerCase();
  // Match both the legacy wire string ("already indexing") and the
  // current user-facing phrasing emitted by the structured-error envelope
  // ("Indexing is already in progress.") — keeping the frontend robust
  // across the v0.5 → v0.6 error-format transition.
  return lower.includes("already indexing") || lower.includes("already in progress");
}

/**
 * Check whether an error indicates an FTS5 search syntax error from SQLite.
 *
 * Only matches the `fts5:` prefix used by SQLite's FTS5 engine — intentionally
 * does **not** match generic "parse error" strings that could originate from
 * JSON / YAML / session parsing elsewhere in the Rust backend.
 */
export function isSearchSyntaxError(error: unknown): boolean {
  const msg =
    typeof error === "string"
      ? error
      : isBackendErrorEnvelope(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "";
  return msg.includes("fts5: syntax error") || msg.includes("fts5 syntax error");
}

/**
 * Map a raw backend error to a user-friendly message.
 *
 * Returns the original message if no mapping matches.
 * Returns `null` if the input is null, undefined, or empty.
 */
export function toFriendlyErrorMessage(error: unknown): string | null {
  if (error == null) return null;

  if (isSearchSyntaxError(error)) {
    return "Invalid search syntax. Try simpler terms, or use quotes for exact phrases. Operators like AND, OR, NOT must be between search terms.";
  }

  if (isAlreadyIndexingError(error)) {
    return "Indexing is already in progress. Please wait for the current index to complete.";
  }

  const msg =
    typeof error === "string"
      ? error
      : isBackendErrorEnvelope(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

  return msg || null;
}
