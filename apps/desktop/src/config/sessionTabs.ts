/**
 * The registry of the session-detail surface's inner tabs.
 *
 * Each entry declares a tab once: its label, route, the lazy component that
 * fills it, the source capability it needs and the count its nav item shows.
 * The tab nav ({@link ../components/session/SessionDetailPanel.vue}), the
 * tab-window view ({@link ../views/SessionDetailTabView.vue}) and the
 * session routes ({@link sessionTabRoutes}) render from it, so a new tab is
 * one entry here plus its component file.
 */
import type { SessionDetail, SourceCapabilities } from "@tracepilot/types";
import type { Component } from "vue";
import type { RouteRecordRaw } from "vue-router";
import { ROUTE_NAMES, type RouteName } from "./routes";

/**
 * How the session-detail panel routes between inner tabs.
 *
 *  - `"router"` — tabs push named routes via vue-router (full window).
 *  - `"local"`  — tabs are controlled via `v-model` (child / tab window
 *                 where no router is installed).
 */
export type SessionTabMode = "router" | "local";

export interface SessionTab {
  /** Stable identifier; also used as the local-mode tab key. */
  name: string;
  /** Human-readable label rendered in the tab nav. */
  label: string;
  /**
   * In router mode this is the canonical {@link RouteName} the tab pushes
   * to; in local mode it mirrors {@link name} so callers can treat the
   * shape uniformly.
   */
  routeName: string;
  /** The count shown beside the label, for tabs that count something. */
  count?: number;
}

export interface SessionTabDefinition {
  name: string;
  label: string;
  routeName: RouteName;
  /** Loads the component that fills the tab (code-split per tab). */
  component: () => Promise<Component>;
  /** The capability a session's source needs for this tab to show. */
  requires?: keyof SourceCapabilities;
  /** The count the tab's nav item shows for a loaded session. */
  count?: (detail: SessionDetail) => number | null | undefined;
}

/** The tabs, in the order the nav shows them. */
export const SESSION_TABS: readonly SessionTabDefinition[] = [
  {
    name: "overview",
    label: "Overview",
    routeName: ROUTE_NAMES.sessionOverview,
    component: () => import("@/views/tabs/OverviewTab.vue"),
  },
  {
    name: "conversation",
    label: "Conversation",
    routeName: ROUTE_NAMES.sessionConversation,
    component: () => import("@/views/tabs/ConversationTab.vue"),
    count: (detail) => detail.turnCount,
  },
  {
    name: "events",
    label: "Events",
    routeName: ROUTE_NAMES.sessionEvents,
    component: () => import("@/views/tabs/EventsTab.vue"),
    count: (detail) => detail.eventCount,
  },
  {
    name: "todos",
    label: "Todos",
    routeName: ROUTE_NAMES.sessionTodos,
    component: () => import("@/views/tabs/TodosTab.vue"),
    requires: "hasTodos",
  },
  {
    name: "metrics",
    label: "Metrics",
    routeName: ROUTE_NAMES.sessionMetrics,
    component: () => import("@/views/tabs/MetricsTab.vue"),
  },
  // Sources without a layer breakdown still chart their recorded input totals.
  {
    name: "context",
    label: "Context",
    routeName: ROUTE_NAMES.sessionContext,
    component: () => import("@/views/tabs/ContextTab.vue"),
  },
  {
    name: "explorer",
    label: "Explorer",
    routeName: ROUTE_NAMES.sessionExplorer,
    component: () => import("@/views/tabs/ExplorerTab.vue"),
    requires: "hasExplorer",
  },
  {
    name: "timeline",
    label: "Timeline",
    routeName: ROUTE_NAMES.sessionTimeline,
    component: () => import("@/views/SessionTimelineView.vue"),
  },
];

/** The tab a session falls back to when the requested one is hidden. */
export const DEFAULT_SESSION_TAB = "overview";

function isTabVisible(tab: SessionTabDefinition, caps?: SourceCapabilities): boolean {
  return !caps || !tab.requires || caps[tab.requires];
}

/**
 * Returns the list of session-detail tabs visible in the given
 * {@link SessionTabMode}, preserving the canonical order defined in
 * {@link SESSION_TABS}. With `caps`, tabs the session's source cannot fill
 * are left out; without them every tab shows. With `detail`, tabs that
 * count something carry its count.
 *
 * The function is pure: each call produces a fresh array of fresh objects
 * so callers may safely mutate the result.
 */
export function mapSessionTabs(
  mode: SessionTabMode,
  caps?: SourceCapabilities,
  detail?: SessionDetail | null,
): SessionTab[] {
  return SESSION_TABS.filter((t) => isTabVisible(t, caps)).map((t) => {
    const tab: SessionTab = {
      name: t.name,
      label: t.label,
      routeName: mode === "local" ? t.name : t.routeName,
    };
    if (detail && t.count) tab.count = t.count(detail) ?? undefined;
    return tab;
  });
}

/**
 * True when `nameOrRoute` (a tab name or its route name) is a tab the
 * source cannot show. Unknown names are not hidden.
 */
export function isSessionTabHidden(nameOrRoute: string, caps: SourceCapabilities): boolean {
  const tab = SESSION_TABS.find((t) => t.name === nameOrRoute || t.routeName === nameOrRoute);
  return tab != null && !isTabVisible(tab, caps);
}

/** The `/session/:id` child routes, one per tab, in nav order. */
export function sessionTabRoutes(): RouteRecordRaw[] {
  return SESSION_TABS.map((t) => ({
    path: t.name,
    name: t.routeName,
    component: t.component,
    meta: { title: t.label, sidebarId: "sessions" },
  }));
}
