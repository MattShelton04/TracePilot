import type { TurnToolCall } from "@tracepilot/types";
import type { RendererShellStatus } from "../components/RendererShell.vue";

/**
 * Call completion is distinct from the state of a process or worker it inspects.
 * A call that never reported a result is `pending` while its session may still
 * finish it, and `unfinished` once the session has ended.
 */
export function toolCallStatus(tc?: TurnToolCall, sessionEnded = false): RendererShellStatus {
  if (!tc) return "success";
  if (tc.cancelled) return "cancelled";
  if (tc.success === false || tc.error) return "error";
  const open = sessionEnded ? "unfinished" : "pending";
  if (tc.isComplete === false) return open;
  if (tc.success === true || tc.isComplete === true) return "success";
  return open;
}

/** Label of a call whose session ended before it reported a result. */
export const UNFINISHED_TOOL_CALL_LABEL = "Did not finish";

/** Tooltip explaining {@link UNFINISHED_TOOL_CALL_LABEL}. */
export const UNFINISHED_TOOL_CALL_HINT = "The session ended before this call reported a result.";

export const TOOL_RESULT_TRUNCATION_SUFFIX = "…[truncated]";

export function isToolResultTruncated(content?: string | null): boolean {
  return content?.endsWith(TOOL_RESULT_TRUNCATION_SUFFIX) ?? false;
}

export function toolResultPreview(content: string, truncated?: boolean): string {
  return truncated && isToolResultTruncated(content)
    ? content.slice(0, -TOOL_RESULT_TRUNCATION_SUFFIX.length)
    : content;
}
