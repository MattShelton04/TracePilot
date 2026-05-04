import type { TurnSessionEvent } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { pairPermissionEvents } from "./sessionEventPairing";

function evt(partial: Partial<TurnSessionEvent> & { eventType: string }): TurnSessionEvent {
  return {
    severity: "info",
    summary: "",
    ...partial,
  };
}

describe("pairPermissionEvents", () => {
  it("pairs requested + completed by requestId", () => {
    const events: TurnSessionEvent[] = [
      evt({
        eventType: "permission.requested",
        requestId: "r1",
        promptKind: "shell",
        summary: "Permission requested (shell): Run tests",
      }),
      evt({
        eventType: "permission.completed",
        requestId: "r1",
        resultKind: "approved",
        summary: "Permission result: approved",
      }),
    ];

    const { entries } = pairPermissionEvents(events);
    expect(entries).toHaveLength(1);
    const first = entries[0]!;
    expect(first.type).toBe("permission");
    if (first.type !== "permission") return;
    expect(first.requested?.requestId).toBe("r1");
    expect(first.completed?.resultKind).toBe("approved");
  });

  it("emits a pending pair when only requested is present", () => {
    const { entries } = pairPermissionEvents([
      evt({ eventType: "permission.requested", requestId: "r2", promptKind: "write" }),
    ]);
    expect(entries).toHaveLength(1);
    if (entries[0]!.type !== "permission") return;
    expect(entries[0]!.requested?.requestId).toBe("r2");
    expect(entries[0]!.completed).toBeUndefined();
  });

  it("emits a result-only pair when only completed is present", () => {
    const { entries } = pairPermissionEvents([
      evt({
        eventType: "permission.completed",
        requestId: "r3",
        resultKind: "denied-interactively-by-user",
      }),
    ]);
    expect(entries).toHaveLength(1);
    if (entries[0]!.type !== "permission") return;
    expect(entries[0]!.requested).toBeUndefined();
    expect(entries[0]!.completed?.resultKind).toBe("denied-interactively-by-user");
  });

  it("preserves non-permission events as plain rows", () => {
    const events: TurnSessionEvent[] = [
      evt({ eventType: "session.error", severity: "error", summary: "boom" }),
      evt({ eventType: "permission.requested", requestId: "r4", promptKind: "shell" }),
      evt({ eventType: "session.warning", severity: "warning", summary: "huh" }),
      evt({ eventType: "permission.completed", requestId: "r4", resultKind: "approved" }),
    ];

    const { entries } = pairPermissionEvents(events);
    // The trailing completed merges into the existing permission entry, so we
    // get: [event, permission, event] (3 entries, not 4).
    expect(entries.map((e) => e.type)).toEqual(["event", "permission", "event"]);
    if (entries[1]!.type !== "permission") return;
    expect(entries[1]!.requested?.requestId).toBe("r4");
    expect(entries[1]!.completed?.resultKind).toBe("approved");
  });

  it("does not pair across distinct requestIds", () => {
    const { entries } = pairPermissionEvents([
      evt({ eventType: "permission.requested", requestId: "a", promptKind: "shell" }),
      evt({ eventType: "permission.completed", requestId: "b", resultKind: "approved" }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.type === "permission")).toBe(true);
  });

  it("falls back to a unique key when requestId is missing", () => {
    const { entries } = pairPermissionEvents([
      evt({ eventType: "permission.requested" }),
      evt({ eventType: "permission.completed" }),
    ]);
    // Without requestId we cannot safely merge — keep them separate.
    expect(entries).toHaveLength(2);
  });

  it("attaches paired permissions to matching tool calls and removes them from entries", () => {
    const events: TurnSessionEvent[] = [
      evt({
        eventType: "permission.requested",
        requestId: "r-tc",
        toolCallId: "tc-1",
        promptKind: "shell",
        summary: "Permission requested (shell): Run tests",
      }),
      evt({
        eventType: "permission.completed",
        requestId: "r-tc",
        toolCallId: "tc-1",
        resultKind: "approved",
        summary: "Permission result: approved",
      }),
      evt({
        eventType: "permission.completed",
        requestId: "r-orphan",
        toolCallId: "tc-missing",
        resultKind: "denied-interactively-by-user",
      }),
    ];

    const { entries, permissionByToolCallId } = pairPermissionEvents(events, new Set(["tc-1"]));
    // tc-1 pair extracted; orphan pair (no matching tool call) stays inline.
    expect(entries).toHaveLength(1);
    if (entries[0]!.type !== "permission") return;
    expect(entries[0]!.completed?.toolCallId).toBe("tc-missing");

    const attached = permissionByToolCallId.get("tc-1");
    expect(attached?.requested?.requestId).toBe("r-tc");
    expect(attached?.completed?.resultKind).toBe("approved");
  });

  it("does not extract pairs when no toolCallIds are provided", () => {
    const events: TurnSessionEvent[] = [
      evt({
        eventType: "permission.completed",
        requestId: "r5",
        toolCallId: "tc-X",
        resultKind: "approved",
      }),
    ];
    const { entries, permissionByToolCallId } = pairPermissionEvents(events);
    expect(entries).toHaveLength(1);
    expect(permissionByToolCallId.size).toBe(0);
  });
});
