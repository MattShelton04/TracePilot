/**
 * Pair `permission.requested` events with their matching
 * `permission.completed` events (by `requestId`) so the conversation view
 * can render them as a single linked permission card.
 *
 * Output ordering: pairs anchor at the position of whichever half appears
 * first in the input list, preserving the chronological flow of the rest
 * of the session events.
 */
import type { TurnSessionEvent } from "@tracepilot/types";

export type SessionEventEntry =
  | { type: "event"; event: TurnSessionEvent; key: string }
  | {
      type: "permission";
      requested?: TurnSessionEvent;
      completed?: TurnSessionEvent;
      key: string;
    };

export function pairPermissionEvents(events: TurnSessionEvent[]): SessionEventEntry[] {
  const result: SessionEventEntry[] = [];
  const indexByRequestId = new Map<string, number>();

  for (let i = 0; i < events.length; i += 1) {
    const evt = events[i];
    if (!evt) continue;
    const isPerm =
      evt.eventType === "permission.requested" || evt.eventType === "permission.completed";

    if (!isPerm) {
      result.push({
        type: "event",
        event: evt,
        key: `evt-${i}-${evt.eventType}-${evt.timestamp ?? ""}`,
      });
      continue;
    }

    const reqId = evt.requestId;
    if (reqId !== undefined) {
      const pos = indexByRequestId.get(reqId);
      if (pos !== undefined) {
        const existing = result[pos];
        if (existing && existing.type === "permission") {
          if (evt.eventType === "permission.requested") {
            existing.requested = evt;
          } else {
            existing.completed = evt;
          }
        }
        continue;
      }
    }

    const entry: SessionEventEntry = {
      type: "permission",
      key: `perm-${reqId ?? `idx-${i}`}`,
      requested: evt.eventType === "permission.requested" ? evt : undefined,
      completed: evt.eventType === "permission.completed" ? evt : undefined,
    };
    if (reqId !== undefined) indexByRequestId.set(reqId, result.length);
    result.push(entry);
  }

  return result;
}
