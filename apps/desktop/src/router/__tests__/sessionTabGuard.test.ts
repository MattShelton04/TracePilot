import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteLocationNormalized } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useSessionsStore } from "@/stores/sessions";
import { hiddenSessionTabRedirect, sessionTabGuard } from "../sessionTabGuard";

function sessionRoute(name: string, id = "s-1"): RouteLocationNormalized {
  return {
    name,
    params: { id },
    matched: [{ path: "/session/:id" }],
  } as unknown as RouteLocationNormalized;
}

describe("hiddenSessionTabRedirect", () => {
  it("sends a hidden tab to the overview", () => {
    expect(hiddenSessionTabRedirect(sessionRoute(ROUTE_NAMES.sessionTodos), "claudeCode")).toEqual({
      name: ROUTE_NAMES.sessionOverview,
      params: { id: "s-1" },
    });
  });

  it("lets visible tabs, Copilot sessions and unknown sources through", () => {
    const todos = sessionRoute(ROUTE_NAMES.sessionTodos);
    expect(hiddenSessionTabRedirect(sessionRoute(ROUTE_NAMES.sessionMetrics), "claudeCode")).toBe(
      undefined,
    );
    expect(hiddenSessionTabRedirect(todos, "copilot")).toBeUndefined();
    expect(hiddenSessionTabRedirect(todos, undefined)).toBeUndefined();
  });
});

describe("sessionTabGuard", () => {
  beforeEach(() => setupPinia());

  function seed(sessions: Partial<SessionListItem>[]) {
    useSessionsStore().sessions = sessions.map(
      (s) => ({ isRunning: false, ...s }) as SessionListItem,
    );
  }

  it("redirects a deep link using the loaded session list", () => {
    seed([{ id: "s-1", source: "claudeCode" }]);
    expect(sessionTabGuard(sessionRoute(ROUTE_NAMES.sessionExplorer))).toEqual({
      name: ROUTE_NAMES.sessionOverview,
      params: { id: "s-1" },
    });
  });

  it("keeps a known Claude Code source when the loaded detail omits it", () => {
    seed([{ id: "s-1", source: "claudeCode" }]);
    const detailStore = useSessionDetailStore();
    detailStore.$patch({ detail: { id: "s-1", hasPlan: false, hasCheckpoints: false } });
    expect(detailStore.detail?.id).toBe("s-1");
    expect(sessionTabGuard(sessionRoute(ROUTE_NAMES.sessionTodos))).toEqual({
      name: ROUTE_NAMES.sessionOverview,
      params: { id: "s-1" },
    });
  });

  it("treats a list item without a source as Copilot", () => {
    seed([{ id: "s-1" }]);
    expect(sessionTabGuard(sessionRoute(ROUTE_NAMES.sessionExplorer))).toBeUndefined();
  });

  it("ignores sessions it has not loaded and routes outside session detail", () => {
    seed([]);
    expect(sessionTabGuard(sessionRoute(ROUTE_NAMES.sessionTodos))).toBeUndefined();
    const other = { name: "search", params: {}, matched: [] } as unknown as RouteLocationNormalized;
    expect(sessionTabGuard(other)).toBeUndefined();
  });
});
