/**
 * Normalize a `ToolProgressSummary.partialResult` payload into the string
 * we render in the live conversation feed. Mirrors the inline behaviour
 * previously defined in `ChatViewMode.vue`:
 *
 *  - `null` / `undefined` → empty string (caller filters these out).
 *  - already-`string` payloads are returned verbatim (no trim, no escape).
 *  - everything else is `JSON.stringify(value, null, 2)`; if that throws
 *    (e.g. circular reference) we fall back to `String(value)`.
 *  - if `JSON.stringify` returns `undefined` (which it does for raw
 *    `undefined`, functions, and symbols), we return `""` so callers can
 *    treat "no renderable text" uniformly.
 */
export function normalizeToolPartialOutput(partialResult: unknown): string {
  if (partialResult == null) return "";
  if (typeof partialResult === "string") return partialResult;
  try {
    const json = JSON.stringify(partialResult, null, 2);
    return typeof json === "string" ? json : "";
  } catch {
    return String(partialResult);
  }
}
