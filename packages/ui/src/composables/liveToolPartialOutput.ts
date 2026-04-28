import type { ComputedRef, InjectionKey } from "vue";

/**
 * Provides per-toolCallId live partial-output snapshots from the SDK
 * live-state reducer. Consumers (e.g. `ToolCallDetail`) can inject this
 * to surface streaming stdout (shell/powershell) on the in-progress
 * persisted tool call, before its final `result` is loaded.
 *
 * The map is keyed by `toolCallId` and yields the latest accumulated
 * partial output string (already merged by the live-state reducer).
 *
 * The provider should set this to `null` (or simply not provide it) when
 * no live state is available for the current view.
 */
export const LIVE_TOOL_PARTIAL_OUTPUT_KEY: InjectionKey<ComputedRef<Map<string, string>>> =
  Symbol("LiveToolPartialOutput");
