/**
 * Type-safe accessor helpers for TurnToolCall.arguments.
 *
 * `TurnToolCall.arguments` is typed as `unknown` because it maps to
 * Rust's `Option<serde_json::Value>`, which can hold any JSON value.
 * In practice tool arguments are almost always JSON objects, but the
 * helpers below perform runtime narrowing so callers never need raw
 * `as Record<string, unknown>` casts.
 */

import type { TurnToolCall } from "./conversation.js";

/** Convenience alias for the record shape of tool-call arguments. */
export type ToolArgs = Record<string, unknown>;

/**
 * Safely extract tool-call arguments as a plain object.
 *
 * Returns `{}` when the arguments are absent, null, or a non-object
 * JSON value (string, array, number, boolean).  This mirrors the
 * Rust-side `args.as_object().unwrap_or_default()` pattern.
 */
export function getToolArgs(tc: Pick<TurnToolCall, "arguments">): ToolArgs {
  const a = tc.arguments;
  if (a != null && typeof a === "object" && !Array.isArray(a)) {
    return a as ToolArgs;
  }
  return {};
}

/**
 * Safely read a string-valued argument.
 *
 * Returns `fallback` (default `""`) when the key is missing or its
 * value is not a string.
 */
export function toolArgString(args: ToolArgs, key: string, fallback = ""): string {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}
