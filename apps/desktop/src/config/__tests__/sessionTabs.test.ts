import { describe, expect, it } from "vitest";
import { ROUTE_NAMES } from "../routes";
import { mapSessionTabs, type SessionTab } from "../sessionTabs";

const EXPECTED_ORDER = [
  "overview",
  "conversation",
  "events",
  "todos",
  "metrics",
  "explorer",
  "timeline",
] as const;

describe("mapSessionTabs", () => {
  it("returns tabs in the canonical order for router mode", () => {
    const tabs = mapSessionTabs("router");
    expect(tabs.map((t) => t.name)).toEqual([...EXPECTED_ORDER]);
  });

  it("returns tabs in the canonical order for local mode", () => {
    const tabs = mapSessionTabs("local");
    expect(tabs.map((t) => t.name)).toEqual([...EXPECTED_ORDER]);
  });

  it("uses canonical ROUTE_NAMES for router mode", () => {
    const tabs = mapSessionTabs("router");
    const byName = Object.fromEntries(tabs.map((t) => [t.name, t]));
    expect(byName.overview.routeName).toBe(ROUTE_NAMES.sessionOverview);
    expect(byName.conversation.routeName).toBe(ROUTE_NAMES.sessionConversation);
    expect(byName.events.routeName).toBe(ROUTE_NAMES.sessionEvents);
    expect(byName.todos.routeName).toBe(ROUTE_NAMES.sessionTodos);
    expect(byName.metrics.routeName).toBe(ROUTE_NAMES.sessionMetrics);
    expect(byName.explorer.routeName).toBe(ROUTE_NAMES.sessionExplorer);
    expect(byName.timeline.routeName).toBe(ROUTE_NAMES.sessionTimeline);
  });

  it("mirrors `name` into `routeName` for local mode (no router push)", () => {
    const tabs = mapSessionTabs("local");
    for (const tab of tabs) {
      expect(tab.routeName).toBe(tab.name);
    }
  });

  it("returns fresh arrays/objects on each call (safe to mutate)", () => {
    const a = mapSessionTabs("router");
    const b = mapSessionTabs("router");
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);

    const patched: SessionTab = { ...a[1], label: "Mutated" };
    expect(b[1].label).toBe("Conversation");
    expect(patched.label).toBe("Mutated");
  });
});
