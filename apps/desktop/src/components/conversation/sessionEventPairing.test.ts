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

    const out = pairPermissionEvents(events);
    expect(out).toHaveLength(1);
    const first = out[0]!;
    expect(first.type).toBe("permission");
    if (first.type !== "permission") return;
    expect(first.requested?.requestId).toBe("r1");
    expect(first.completed?.resultKind).toBe("approved");
  });

  it("emits a pending pair when only requested is present", () => {
    const out = pairPermissionEvents([
      evt({ eventType: "permission.requested", requestId: "r2", promptKind: "write" }),
    ]);
    expect(out).toHaveLength(1);
    if (out[0]!.type !== "permission") return;
    expect(out[0]!.requested?.requestId).toBe("r2");
    expect(out[0]!.completed).toBeUndefined();
  });

  it("emits a result-only pair when only completed is present", () => {
    const out = pairPermissionEvents([
      evt({
        eventType: "permission.completed",
        requestId: "r3",
        resultKind: "denied-interactively-by-user",
      }),
    ]);
    expect(out).toHaveLength(1);
    if (out[0]!.type !== "permission") return;
    expect(out[0]!.requested).toBeUndefined();
    expect(out[0]!.completed?.resultKind).toBe("denied-interactively-by-user");
  });

  it("preserves non-permission events as plain rows", () => {
    const events: TurnSessionEvent[] = [
      evt({ eventType: "session.error", severity: "error", summary: "boom" }),
      evt({ eventType: "permission.requested", requestId: "r4", promptKind: "shell" }),
      evt({ eventType: "session.warning", severity: "warning", summary: "huh" }),
      evt({ eventType: "permission.completed", requestId: "r4", resultKind: "approved" }),
    ];

    const out = pairPermissionEvents(events);
    // The trailing completed merges into the existing permission entry, so we
    // get: [event, permission, event] (3 entries, not 4).
    expect(out.map((e) => e.type)).toEqual(["event", "permission", "event"]);
    if (out[1]!.type !== "permission") return;
    expect(out[1]!.requested?.requestId).toBe("r4");
    expect(out[1]!.completed?.resultKind).toBe("approved");
  });

  it("does not pair across distinct requestIds", () => {
    const out = pairPermissionEvents([
      evt({ eventType: "permission.requested", requestId: "a", promptKind: "shell" }),
      evt({ eventType: "permission.completed", requestId: "b", resultKind: "approved" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.type === "permission")).toBe(true);
  });

  it("falls back to a unique key when requestId is missing", () => {
    const out = pairPermissionEvents([
      evt({ eventType: "permission.requested" }),
      evt({ eventType: "permission.completed" }),
    ]);
    // Without requestId we cannot safely merge — keep them separate.
    expect(out).toHaveLength(2);
  });
});
