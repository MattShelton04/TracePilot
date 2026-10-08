import { sourceCapabilities } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { ROUTE_NAMES } from "../routes";
import { isSessionTabHidden, mapSessionTabs, type SessionTab } from "../sessionTabs";

const EXPECTED_ORDER = [
  "overview",
  "conversation",
  "events",
  "todos",
  "metrics",
  "context",
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
    expect(byName.context.routeName).toBe(ROUTE_NAMES.sessionContext);
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

  it("keeps every tab for Copilot capabilities", () => {
    expect(mapSessionTabs("router", sourceCapabilities("copilot"))).toEqual(
      mapSessionTabs("router"),
    );
  });

  it("leaves out tabs the source cannot fill", () => {
    const tabs = mapSessionTabs("local", sourceCapabilities("claudeCode"));
    expect(tabs.map((t) => t.name)).toEqual([
      "overview",
      "conversation",
      "events",
      "metrics",
      "context",
      "timeline",
    ]);
  });
});

describe("isSessionTabHidden", () => {
  const claude = sourceCapabilities("claudeCode");

  it("matches tab names and route names", () => {
    expect(isSessionTabHidden("todos", claude)).toBe(true);
    expect(isSessionTabHidden(ROUTE_NAMES.sessionExplorer, claude)).toBe(true);
    expect(isSessionTabHidden(ROUTE_NAMES.sessionContext, claude)).toBe(false);
    expect(isSessionTabHidden("conversation", claude)).toBe(false);
  });

  it("hides nothing for Copilot or for unknown names", () => {
    expect(isSessionTabHidden("todos", sourceCapabilities("copilot"))).toBe(false);
    expect(isSessionTabHidden("not-a-tab", claude)).toBe(false);
  });
});
