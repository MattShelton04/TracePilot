import { type SessionDetail, sourceCapabilities } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import router from "@/router";
import { ROUTE_NAMES } from "../routes";
import {
  isSessionTabHidden,
  mapSessionTabs,
  SESSION_TABS,
  type SessionTab,
  sessionTabRoutes,
} from "../sessionTabs";

/** A source without todos or an Explorer. */
const LIMITED = { ...sourceCapabilities("claudeCode"), hasTodos: false, hasExplorer: false };

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

  it("keeps every tab for Claude Code capabilities", () => {
    expect(mapSessionTabs("router", sourceCapabilities("claudeCode"))).toEqual(
      mapSessionTabs("router"),
    );
  });

  it("leaves out tabs the source cannot fill", () => {
    const tabs = mapSessionTabs("local", LIMITED);
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

describe("tab counts", () => {
  const detail = { id: "s1", turnCount: 3, eventCount: 40 } as SessionDetail;

  it("counts conversation turns and events once the detail loads", () => {
    const counts = Object.fromEntries(
      mapSessionTabs("local", undefined, detail).map((t) => [t.name, t.count]),
    );
    expect(counts).toEqual({
      overview: undefined,
      conversation: 3,
      events: 40,
      todos: undefined,
      metrics: undefined,
      context: undefined,
      explorer: undefined,
      timeline: undefined,
    });
  });

  it("shows no count before the detail loads or when it is not recorded", () => {
    expect(mapSessionTabs("local").some((t) => "count" in t)).toBe(false);
    const unrecorded = mapSessionTabs("local", undefined, { id: "s1" } as SessionDetail);
    expect(unrecorded.find((t) => t.name === "conversation")?.count).toBeUndefined();
  });
});

describe("sessionTabRoutes", () => {
  it("declares one child route per tab, matching the session routes", () => {
    const routes = sessionTabRoutes();
    expect(routes.map((r) => r.name)).toEqual(SESSION_TABS.map((t) => t.routeName));
    for (const [i, route] of routes.entries()) {
      expect(route.path).toBe(EXPECTED_ORDER[i]);
      expect(route.meta).toEqual({ title: SESSION_TABS[i].label, sidebarId: "sessions" });
      expect(route.component).toBe(SESSION_TABS[i].component);
    }

    const session = router.options.routes.find((r) => r.path === "/session/:id");
    const children = (session?.children ?? []).filter((r) => r.name);
    expect(children.map(({ path, name, meta }) => ({ path, name, meta }))).toEqual(
      routes.map(({ path, name, meta }) => ({ path, name, meta })),
    );
  });

  it("gives every tab a lazily loaded component", () => {
    for (const tab of SESSION_TABS) expect(typeof tab.component).toBe("function");
  });
});

describe("isSessionTabHidden", () => {
  it("matches tab names and route names", () => {
    expect(isSessionTabHidden("todos", LIMITED)).toBe(true);
    expect(isSessionTabHidden(ROUTE_NAMES.sessionTodos, LIMITED)).toBe(true);
    expect(isSessionTabHidden(ROUTE_NAMES.sessionExplorer, LIMITED)).toBe(true);
    expect(isSessionTabHidden(ROUTE_NAMES.sessionContext, LIMITED)).toBe(false);
    expect(isSessionTabHidden("conversation", LIMITED)).toBe(false);
  });

  it("hides nothing for Copilot, Claude Code or unknown names", () => {
    expect(isSessionTabHidden("todos", sourceCapabilities("copilot"))).toBe(false);
    expect(isSessionTabHidden("todos", sourceCapabilities("claudeCode"))).toBe(false);
    expect(isSessionTabHidden("not-a-tab", LIMITED)).toBe(false);
  });
});
