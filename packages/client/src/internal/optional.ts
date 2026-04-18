/**
 * Convert `undefined` to `null` so the value survives JSON serialization
 * as the Rust-side `Option::None` rather than being stripped by
 * `serde_json` (which treats `undefined` as "absent field").
 *
 * Use this at IPC boundaries where the backend expects `Option<T>`.
 */
export function toRustOptional<T>(value: T | undefined | null): T | null {
  return value ?? null;
}
