import { reactive, watch } from "vue";
import { getToolResult } from "@tracepilot/client";
import { logError } from "@/utils/logger";

/**
 * Composable for lazy-loading full (un-truncated) tool results from the backend.
 *
 * Manages loading, caching, and failure state for tool result requests.
 * Auto-clears on session change. Uses a generation counter to discard
 * in-flight responses that started before the last clear.
 */
/**
 * Extract readable text from a tool result value.
 * Mirrors the Rust `extract_result_preview` logic:
 * - String → use directly
 * - Object with `content` or `detailedContent` string field (and no other
 *   meaningful fields) → extract that text
 * - Otherwise → JSON.stringify for full fidelity
 */
function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    const text =
      (typeof obj.content === "string" && obj.content.trim() ? obj.content : null) ??
      (typeof obj.detailedContent === "string" && obj.detailedContent.trim() ? obj.detailedContent : null);
    if (text) {
      // If the object only has content/detailedContent (plus optional empty counterpart), show plain text
      const keys = Object.keys(obj).filter(
        (k) => obj[k] != null && obj[k] !== "" && obj[k] !== false,
      );
      const textKeys = new Set(["content", "detailedContent"]);
      if (keys.every((k) => textKeys.has(k))) return text;
    }
  }
  return JSON.stringify(result, null, 2);
}

export function useToolResultLoader(sessionId: () => string | null | undefined) {
  const fullResults = reactive(new Map<string, string>());
  const fullResultData = reactive(new Map<string, { raw: unknown; formatted: string }>());
  const loadingResults = reactive(new Set<string>());
  const failedResults = reactive(new Set<string>());
  let generation = 0;

  async function loadFullResult(toolCallId: string) {
    if (!toolCallId || fullResults.has(toolCallId) || loadingResults.has(toolCallId) || failedResults.has(toolCallId)) return;
    const capturedSessionId = sessionId();
    if (!capturedSessionId) return;
    const capturedGen = generation;
    loadingResults.add(toolCallId);
    try {
      const result = await getToolResult(capturedSessionId, toolCallId);
      if (generation !== capturedGen || sessionId() !== capturedSessionId) return;
      if (result != null) {
        const formatted = formatResult(result);
        fullResults.set(toolCallId, formatted);
        fullResultData.set(toolCallId, { raw: result, formatted });
      } else {
        failedResults.add(toolCallId);
      }
    } catch (err: unknown) {
      logError("[toolResultLoader] Failed to load full result:", e);
      if (generation === capturedGen && sessionId() === capturedSessionId) {
        failedResults.add(toolCallId);
      }
    } finally {
      if (generation === capturedGen) {
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
    generation++;
    fullResults.clear();
    fullResultData.clear();
    loadingResults.clear();
    failedResults.clear();
  }

  // Auto-clear when session changes
  watch(sessionId, () => clear());

  return { fullResults, fullResultData, loadingResults, failedResults, loadFullResult, retryFullResult, clear };
}
