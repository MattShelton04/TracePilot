/**
 * Thin re-export shim — the canonical implementation lives in `@tracepilot/ui`.
 *
 * New code should import directly from `@tracepilot/ui`. This module is kept
 * so existing `@/composables/useCachedFetch` call sites keep compiling until a
 * follow-up wave migrates them.
 */
export {
  useCachedFetch,
  type CachedFetchOptions,
  type CachedFetchResult,
} from "@tracepilot/ui";
