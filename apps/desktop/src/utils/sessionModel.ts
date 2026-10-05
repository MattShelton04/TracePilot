import type { SessionDetail } from "@tracepilot/types";

/**
 * The model a session is on. The backend derives it from the event log, so
 * running, crashed and resumed sessions have one; the shutdown record is the
 * fallback for payloads that predate that field.
 */
export function sessionModel(
  detail: Pick<SessionDetail, "currentModel" | "shutdownMetrics"> | null | undefined,
): string | null {
  return detail?.currentModel || detail?.shutdownMetrics?.currentModel || null;
}

/** The main agent's reasoning effort the session is on, when one is set. */
export function sessionEffort(
  detail: Pick<SessionDetail, "currentReasoningEffort"> | null | undefined,
): string | null {
  return detail?.currentReasoningEffort || null;
}

/** Badge text for a reasoning effort, e.g. "high effort". */
export function effortLabel(effort: string): string {
  return `${effort} effort`;
}
