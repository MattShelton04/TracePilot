import type { TurnToolCall } from "@tracepilot/types";
import type { RendererShellStatus } from "../components/RendererShell.vue";

/** Call completion is distinct from the state of a process or worker it inspects. */
export function toolCallStatus(tc?: TurnToolCall): RendererShellStatus {
  if (!tc) return "success";
  if (tc.cancelled) return "cancelled";
  if (tc.success === false || tc.error) return "error";
  if (tc.isComplete === false) return "pending";
  if (tc.success === true || tc.isComplete === true) return "success";
  return "pending";
}

export const TOOL_RESULT_TRUNCATION_SUFFIX = "…[truncated]";

export function isToolResultTruncated(content?: string | null): boolean {
  return content?.endsWith(TOOL_RESULT_TRUNCATION_SUFFIX) ?? false;
}

export function toolResultPreview(content: string, truncated?: boolean): string {
  return truncated && isToolResultTruncated(content)
    ? content.slice(0, -TOOL_RESULT_TRUNCATION_SUFFIX.length)
    : content;
}
