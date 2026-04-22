import { describe, expect, it } from "vitest";
import {
  getErrorCode,
  isAlreadyIndexingError,
  isBackendErrorEnvelope,
  isSearchSyntaxError,
  toFriendlyErrorMessage,
} from "../../utils/backendErrors";

// ── isBackendErrorEnvelope / getErrorCode ────────────────────

describe("isBackendErrorEnvelope", () => {
  it("accepts valid envelope", () => {
    expect(isBackendErrorEnvelope({ code: "X", message: "y" })).toBe(true);
  });
  it("rejects strings / nulls / Errors", () => {
    expect(isBackendErrorEnvelope("ALREADY_INDEXING")).toBe(false);
    expect(isBackendErrorEnvelope(null)).toBe(false);
    expect(isBackendErrorEnvelope(new Error("x"))).toBe(false);
  });
});

describe("getErrorCode", () => {
  it("extracts code from structured envelope", () => {
    expect(getErrorCode({ code: "ALREADY_INDEXING", message: "busy" })).toBe("ALREADY_INDEXING");
  });
  it("returns null for plain strings", () => {
    expect(getErrorCode("ALREADY_INDEXING")).toBeNull();
  });
  it("returns null for null/undefined", () => {
    expect(getErrorCode(null)).toBeNull();
    expect(getErrorCode(undefined)).toBeNull();
  });
});

// ── isAlreadyIndexingError ───────────────────────────────────

describe("isAlreadyIndexingError", () => {
  it('matches the exact "ALREADY_INDEXING" sentinel from the Rust backend', () => {
    expect(isAlreadyIndexingError("ALREADY_INDEXING")).toBe(true);
  });

  it('matches case-insensitive "already indexing" substring', () => {
    expect(isAlreadyIndexingError("already indexing")).toBe(true);
    expect(isAlreadyIndexingError("Already Indexing")).toBe(true);
  });

  it("matches when embedded in a longer message", () => {
    expect(isAlreadyIndexingError("Error: already indexing sessions")).toBe(true);
  });

  it("rejects unrelated error messages", () => {
    expect(isAlreadyIndexingError("Session not found")).toBe(false);
    expect(isAlreadyIndexingError("Database error")).toBe(false);
    expect(isAlreadyIndexingError("INDEX_FAILED")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAlreadyIndexingError("")).toBe(false);
  });

  // ── Structured envelope form (new in Phase 1A.5) ──
  it("matches the structured envelope with code=ALREADY_INDEXING", () => {
    expect(
      isAlreadyIndexingError({
        code: "ALREADY_INDEXING",
        message: "Indexing is already in progress.",
      }),
    ).toBe(true);
  });
  it("also matches the current backend message via the substring fallback", () => {
    // Defence in depth: even without the envelope (e.g. error re-thrown as
    // a plain string after `toErrorMessage`), the friendly phrasing must
    // still be detected so concurrent-reindex dedupe keeps working.
    expect(isAlreadyIndexingError("Indexing is already in progress.")).toBe(true);
  });
  it("ignores non-ALREADY_INDEXING envelope codes when the message is unrelated", () => {
    expect(isAlreadyIndexingError({ code: "VALIDATION", message: "bad input" })).toBe(false);
  });
  it("honours the legacy substring fallback for VALIDATION envelopes carrying a matching phrase", () => {
    // Historically the backend sometimes surfaced the raw literal
    // `"ALREADY_INDEXING"` as a validation error. The fallback still
    // catches those; but code === "VALIDATION" alone is NOT treated as
    // ALREADY_INDEXING (see the test directly above).
    expect(isAlreadyIndexingError({ code: "VALIDATION", message: "already indexing" })).toBe(true);
  });
});

// ── isSearchSyntaxError ──────────────────────────────────────

describe("isSearchSyntaxError", () => {
  it("matches FTS5 syntax errors from SQLite", () => {
    expect(isSearchSyntaxError('fts5: syntax error near "AND"')).toBe(true);
    expect(isSearchSyntaxError("fts5: syntax error")).toBe(true);
  });

  it("matches variant without colon", () => {
    expect(isSearchSyntaxError("fts5 syntax error")).toBe(true);
  });

  it('does NOT match generic "parse error" strings from other backends', () => {
    expect(isSearchSyntaxError("parse error")).toBe(false);
    expect(isSearchSyntaxError("JSON parse error: unexpected token")).toBe(false);
    expect(isSearchSyntaxError("YAML parse error: invalid syntax")).toBe(false);
  });

  it("rejects unrelated error messages", () => {
    expect(isSearchSyntaxError("ALREADY_INDEXING")).toBe(false);
    expect(isSearchSyntaxError("Database error")).toBe(false);
    expect(isSearchSyntaxError("")).toBe(false);
  });
});

// ── toFriendlyErrorMessage ───────────────────────────────────

describe("toFriendlyErrorMessage", () => {
  it("returns null for null input", () => {
    expect(toFriendlyErrorMessage(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(toFriendlyErrorMessage(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toFriendlyErrorMessage("")).toBeNull();
  });

  it("maps FTS5 syntax errors to friendly search syntax message", () => {
    const result = toFriendlyErrorMessage('fts5: syntax error near "AND"');
    expect(result).toContain("Invalid search syntax");
    expect(result).toContain("quotes for exact phrases");
  });

  it("maps ALREADY_INDEXING to friendly indexing message", () => {
    const result = toFriendlyErrorMessage("ALREADY_INDEXING");
    expect(result).toContain("Indexing is already in progress");
  });

  it("returns original error string for unknown patterns", () => {
    expect(toFriendlyErrorMessage("Something went wrong")).toBe("Something went wrong");
    expect(toFriendlyErrorMessage("Database error: disk full")).toBe("Database error: disk full");
  });

  it('does NOT match generic "parse error" as search syntax', () => {
    expect(toFriendlyErrorMessage("parse error")).toBe("parse error");
  });

  it("prioritizes search syntax check over indexing check", () => {
    // Ensure the ordering is correct — search syntax errors checked first
    const result = toFriendlyErrorMessage("fts5: syntax error");
    expect(result).toContain("Invalid search syntax");
  });
});
