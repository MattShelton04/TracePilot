import type { TurnSessionEvent } from "@tracepilot/types";

/** Session events whose summary names a model, as the backend writes them. */
const MODEL_SUMMARY_EVENTS: ReadonlySet<string> = new Set([
  "session.start",
  "session.resume",
  "session.model_change",
]);

const CLAUDE_MODEL_ID = /\bclaude-[a-z0-9][\w.-]*/gi;

/**
 * A session event's summary with the models it names shown as elsewhere in
 * the session (`Session started (model: claude-opus-5-5)` reads
 * `claude-opus-5.5` for Claude Code). `nameModel` is the session's model
 * namer, which leaves every other source's ids as recorded.
 */
export function sessionEventSummary(
  event: Pick<TurnSessionEvent, "eventType" | "summary">,
  nameModel: (model: string) => string,
): string {
  if (!MODEL_SUMMARY_EVENTS.has(event.eventType)) return event.summary;
  return event.summary.replace(CLAUDE_MODEL_ID, (id) => nameModel(id));
}
