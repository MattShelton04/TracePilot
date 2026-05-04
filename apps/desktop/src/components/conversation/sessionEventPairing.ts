/**
 * Pair `permission.requested` events with their matching
 * `permission.completed` events (by `requestId`) so the conversation view
 * can render them as a single linked permission card.
 *
 * Output ordering: pairs anchor at the position of whichever half appears
 * first in the input list, preserving the chronological flow of the rest
 * of the session events.
 *
 * Tool-call attachment: when `toolCallIds` is provided, pairs whose
 * `toolCallId` matches a tool call rendered in the same turn are *removed*
 * from the timeline `entries` and surfaced via `permissionByToolCallId`
 * instead. The intent is that the conversation view renders the permission
 * status inline on the tool call row (avoiding a separate, redundant card)
 * while pairs that have no matching tool call (e.g. denied-before-start, or
 * cross-turn race) still get a standalone row so we never silently drop a
 * known event.
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

export interface PermissionPair {
  requested?: TurnSessionEvent;
  completed?: TurnSessionEvent;
}

export interface PairPermissionEventsResult {
  entries: SessionEventEntry[];
  /** Permission pairs (keyed by `toolCallId`) that should be rendered on
   *  the corresponding tool call row instead of as a standalone card.
   *  Only populated when `toolCallIds` was supplied. */
  permissionByToolCallId: Map<string, PermissionPair>;
}

function permissionToolCallId(
  requested?: TurnSessionEvent,
  completed?: TurnSessionEvent,
): string | undefined {
  return completed?.toolCallId ?? requested?.toolCallId;
}

export function pairPermissionEvents(
  events: TurnSessionEvent[],
  toolCallIds?: ReadonlySet<string>,
): PairPermissionEventsResult {
  const entries: SessionEventEntry[] = [];
  const indexByRequestId = new Map<string, number>();

  for (let i = 0; i < events.length; i += 1) {
    const evt = events[i];
    if (!evt) continue;
    const isPerm =
      evt.eventType === "permission.requested" || evt.eventType === "permission.completed";

    if (!isPerm) {
      entries.push({
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
        const existing = entries[pos];
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
    if (reqId !== undefined) indexByRequestId.set(reqId, entries.length);
    entries.push(entry);
  }

  const permissionByToolCallId = new Map<string, PermissionPair>();
  if (toolCallIds && toolCallIds.size > 0) {
    // Walk in reverse so splice() doesn't shift indices we still need.
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry?.type !== "permission") continue;
      const tcId = permissionToolCallId(entry.requested, entry.completed);
      if (!tcId || !toolCallIds.has(tcId)) continue;
      // First-write-wins on collision; in practice each toolCallId maps to
      // at most one prompt/response pair per turn.
      if (!permissionByToolCallId.has(tcId)) {
        permissionByToolCallId.set(tcId, {
          requested: entry.requested,
          completed: entry.completed,
        });
      }
      entries.splice(i, 1);
    }
  }

  return { entries, permissionByToolCallId };
}
