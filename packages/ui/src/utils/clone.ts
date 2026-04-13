/**
 * Creates a deep clone of the given value using the structured clone algorithm.
 *
 * This function uses the native `structuredClone()` Web API when available,
 * which is faster and handles more types correctly than JSON-based cloning.
 * Supports most JavaScript types including Date, Map, Set, ArrayBuffer, etc.
 *
 * Falls back to JSON-based cloning for environments without structuredClone
 * support (though this shouldn't be needed with Node 17+ and modern browsers).
 *
 * @security Note: This function does not sanitize sensitive data. Callers should
 * redact secrets (API keys, passwords, tokens) before cloning if needed.
 *
 * @param value - The value to clone
 * @returns A deep clone of the value
 * @throws {DataCloneError} If the value contains types that cannot be cloned (e.g., functions, symbols)
 * @throws {Error} If the value contains circular references or cannot be cloned
 *
 * @example
 * const original = { name: 'Test', config: { enabled: true } };
 * const cloned = deepClone(original);
 * cloned.config.enabled = false;
 * console.log(original.config.enabled); // true (original unchanged)
 */
export function deepClone<T>(value: T): T {
  try {
    if (typeof structuredClone !== "undefined") {
      return structuredClone(value);
    }
  } catch (error) {
    // structuredClone failed - object contains unclonable types
    throw new Error(
      `Failed to clone object: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  // Fallback for older environments (defensive, shouldn't be needed)
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    // JSON fallback failed - likely circular reference or invalid data
    throw new Error(
      `Failed to clone object: ${error instanceof Error ? error.message : "Circular reference or invalid data"}`,
    );
  }
}
