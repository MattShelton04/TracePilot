/**
 * Thin re-export shim — the canonical implementation lives in `@tracepilot/ui`.
 *
 * New code should import directly from `@tracepilot/ui`. This module is kept
 * so existing `@/composables/useAsyncData` call sites keep compiling until a
 * follow-up wave migrates them.
 */
export {
  useAsyncData,
  type UseAsyncDataOptions,
  type UseAsyncDataReturn,
} from "@tracepilot/ui";
