import { getToolResult } from "@tracepilot/client";
import { reactive, watch } from "vue";
import { useAsyncGuard } from "@/composables/useAsyncGuard";
import { formatObjectResult } from "@/utils/formatResult";
import { logError } from "@/utils/logger";

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
  const guard = useAsyncGuard();

  async function loadFullResult(toolCallId: string) {
    if (
      !toolCallId ||
      fullResults.has(toolCallId) ||
      loadingResults.has(toolCallId) ||
      failedResults.has(toolCallId)
    )
      return;
    const capturedSessionId = sessionId();
    if (!capturedSessionId) return;
    const token = guard.current();
    loadingResults.add(toolCallId);
    try {
      const result = await getToolResult(capturedSessionId, toolCallId);
      if (!guard.isValid(token) || sessionId() !== capturedSessionId) return;
      if (result != null) {
        const formatted = formatObjectResult(result);
        fullResults.set(toolCallId, formatted);
        fullResultData.set(toolCallId, { raw: result, formatted });
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
