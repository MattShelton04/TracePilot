import { reactive, watch } from "vue";
import { getToolArguments } from "@tracepilot/client";

/**
 * Composable for lazy-loading full (un-truncated) tool arguments from the backend.
 *
 * Mirrors the pattern of useToolResultLoader but for arguments.
 * The `get_session_turns` response truncates large string argument values
 * to reduce IPC payload. This composable fetches the originals on demand.
 */
export function useToolArgsLoader(sessionId: () => string | null | undefined) {
  const fullArgs = reactive(new Map<string, unknown>());
  const loadingArgs = reactive(new Set<string>());
  const failedArgs = reactive(new Set<string>());
  let generation = 0;

  async function loadFullArgs(toolCallId: string) {
    if (!toolCallId || fullArgs.has(toolCallId) || loadingArgs.has(toolCallId) || failedArgs.has(toolCallId)) return;
    const capturedSessionId = sessionId();
    if (!capturedSessionId) return;
    const capturedGen = generation;
    loadingArgs.add(toolCallId);
    try {
      const result = await getToolArguments(capturedSessionId, toolCallId);
      if (generation !== capturedGen || sessionId() !== capturedSessionId) return;
      if (result != null) {
        fullArgs.set(toolCallId, result);
      } else {
        failedArgs.add(toolCallId);
      }
    } catch (e) {
      console.error("[TracePilot] Failed to load full args:", e);
      if (generation === capturedGen && sessionId() === capturedSessionId) {
        failedArgs.add(toolCallId);
      }
    } finally {
      if (generation === capturedGen) {
        loadingArgs.delete(toolCallId);
      }
    }
  }

  function retryFullArgs(toolCallId: string) {
    failedArgs.delete(toolCallId);
    loadFullArgs(toolCallId);
  }

  function clear() {
    generation++;
    fullArgs.clear();
    loadingArgs.clear();
    failedArgs.clear();
  }

  watch(sessionId, () => clear());

  return { fullArgs, loadingArgs, failedArgs, loadFullArgs, retryFullArgs, clear };
}
