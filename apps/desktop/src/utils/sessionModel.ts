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
