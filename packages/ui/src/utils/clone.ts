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
 * @param value - The value to clone
 * @returns A deep clone of the value
 * @throws {DataCloneError} If the value contains types that cannot be cloned (e.g., functions, symbols)
 * @throws {Error} If the value contains circular references (in fallback mode)
 *
 * @example
 * const original = { name: 'Test', config: { enabled: true } };
 * const cloned = deepClone(original);
 * cloned.config.enabled = false;
 * console.log(original.config.enabled); // true (original unchanged)
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone !== "undefined") {
    return structuredClone(value);
  }
  // Fallback for older environments (defensive, shouldn't be needed)
  return JSON.parse(JSON.stringify(value)) as T;
}
