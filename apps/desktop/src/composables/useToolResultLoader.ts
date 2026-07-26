import { getToolResult } from "@tracepilot/client";
import { useAsyncGuard } from "@tracepilot/ui";
import { reactive, watch } from "vue";
import { formatToolResultContent } from "@/utils/formatResult";
import { logError } from "@/utils/logger";

// Tool results are loaded only on demand, so favor fast revisits with a
// generous bound while still preventing an effectively unlimited hidden tab.
export const TOOL_RESULT_CACHE_MAX_ENTRIES = 64;
export const TOOL_RESULT_CACHE_MAX_BYTES = 64 * 1_024 * 1_024;

/**
 * Composable for lazy-loading full (un-truncated) tool results from the backend.
 *
 * Manages loading, caching, and failure state for tool result requests.
 * Auto-clears on session change. Uses {@link useAsyncGuard} to discard
 * in-flight responses that started before the last clear.
 */
export function useToolResultLoader(sessionId: () => string | null | undefined) {
  const fullResults = reactive(new Map<string, string>());
  const fullResultData = reactive(new Map<string, { raw: unknown; formatted: string }>());
  const loadingResults = reactive(new Set<string>());
  const failedResults = reactive(new Set<string>());
  const retainedCosts = new Map<string, number>();
  let retainedBytes = 0;
  const guard = useAsyncGuard();

  function removeCachedResult(toolCallId: string) {
    retainedBytes -= retainedCosts.get(toolCallId) ?? 0;
    retainedCosts.delete(toolCallId);
    fullResults.delete(toolCallId);
    fullResultData.delete(toolCallId);
  }

  function estimateRetainedBytes(raw: unknown, formatted: string) {
    // Formatting already serializes non-content objects. Reuse that measured
    // string length as the raw object's approximate footprint instead of
    // synchronously serializing a potentially multi-megabyte value a second
    // time on the UI thread. Strings have an exact cheap length available.
    const rawChars = typeof raw === "string" ? raw.length : formatted.length;
    return (rawChars + formatted.length) * 2;
  }

  function retainResult(toolCallId: string, raw: unknown, formatted: string) {
    removeCachedResult(toolCallId);
    fullResults.set(toolCallId, formatted);
    fullResultData.set(toolCallId, { raw, formatted });
    const cost = estimateRetainedBytes(raw, formatted);
    retainedCosts.set(toolCallId, cost);
    retainedBytes += cost;

    // Keep one oversized result so the item the user just requested remains
    // displayable; otherwise enforce both the entry and approximate byte caps.
    while (
      fullResults.size > TOOL_RESULT_CACHE_MAX_ENTRIES ||
      (retainedBytes > TOOL_RESULT_CACHE_MAX_BYTES && fullResults.size > 1)
    ) {
      const oldest = fullResults.keys().next().value;
      if (oldest === undefined) break;
      removeCachedResult(oldest);
    }
  }

  async function loadFullResult(toolCallId: string) {
    if (fullResults.has(toolCallId)) {
      const formatted = fullResults.get(toolCallId);
      const data = fullResultData.get(toolCallId);
      if (formatted !== undefined && data !== undefined) {
        fullResults.delete(toolCallId);
        fullResultData.delete(toolCallId);
        fullResults.set(toolCallId, formatted);
        fullResultData.set(toolCallId, data);
      }
      return;
    }
    if (!toolCallId || loadingResults.has(toolCallId) || failedResults.has(toolCallId)) return;
    const capturedSessionId = sessionId();
    if (!capturedSessionId) return;
    const token = guard.current();
    loadingResults.add(toolCallId);
    try {
      const result = await getToolResult(capturedSessionId, toolCallId);
      if (!guard.isValid(token) || sessionId() !== capturedSessionId) return;
      if (result != null) {
        const formatted = formatToolResultContent(result);
        retainResult(toolCallId, result, formatted);
      } else {
        failedResults.add(toolCallId);
      }
    } catch (e) {
      logError("[toolResultLoader] Failed to load full result:", e);
      if (guard.isValid(token) && sessionId() === capturedSessionId) {
        failedResults.add(toolCallId);
      }
    } finally {
      if (guard.isValid(token)) {
        loadingResults.delete(toolCallId);
      }
    }
  }

  /** Remove failure state for a tool call and retry loading. */
  function retryFullResult(toolCallId: string) {
    failedResults.delete(toolCallId);
    loadFullResult(toolCallId);
  }

  function clear() {
    guard.invalidate();
    fullResults.clear();
    fullResultData.clear();
    retainedCosts.clear();
    retainedBytes = 0;
    loadingResults.clear();
    failedResults.clear();
  }

  // Auto-clear when session changes
  watch(sessionId, () => clear());

  return {
    fullResults,
    fullResultData,
    loadingResults,
    failedResults,
    loadFullResult,
    retryFullResult,
    clear,
  };
}
