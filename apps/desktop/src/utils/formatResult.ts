/**
 * Shared utility for formatting arbitrary result values as readable strings.
 *
 * Consolidates two previously-duplicated functions:
 * - `formatResult()` from useToolResultLoader (smart content extraction, no try-catch)
 * - `formatDetail()` from OverviewTab (try-catch safety, no content extraction)
 *
 * This unified version provides both: smart content extraction for cleaner display
 * of simple content objects, plus try-catch safety for non-serializable values.
 *
 * Mirrors the Rust `extract_result_preview` logic:
 * - String → use directly
 * - Object with only `content` or `detailedContent` string fields → extract plain text
 * - Otherwise → JSON.stringify with pretty formatting
 * - Non-serializable (e.g. circular references, BigInt) → String() fallback
 */
export function formatObjectResult(result: unknown): string {
  if (result === undefined) return "undefined";
  if (typeof result === "string") return result;

  if (result && typeof result === "object" && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    const text =
      (typeof obj.content === "string" && obj.content.trim() ? obj.content : null) ??
      (typeof obj.detailedContent === "string" && obj.detailedContent.trim()
        ? obj.detailedContent
        : null);

    if (text) {
      // If the object only has content/detailedContent (plus optional empty counterpart), show plain text
      const keys = Object.keys(obj).filter(
        (k) => obj[k] != null && obj[k] !== "" && obj[k] !== false,
      );
      const textKeys = new Set(["content", "detailedContent"]);
      if (keys.every((k) => textKeys.has(k))) return text;
    }
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    // Circular references or non-serializable values (e.g. BigInt)
    return String(result);
  }
}
