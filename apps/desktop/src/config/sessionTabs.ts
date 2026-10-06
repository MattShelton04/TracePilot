/**
 * Canonical configuration for the inner tabs of the session-detail surface.
 *
 * Replaces the duplicated `routerTabs` / `localTabs` arrays previously
 * hard-coded in {@link ../components/session/SessionDetailPanel.vue}. The
 * tab list, order and labels live here; the panel chooses how to consume
 * the `routeName` based on its `tabMode` prop.
 *
 * See finding A4 in
 * `docs/improvements/repository-improvement-review-2026-05-08/02-findings-master-list.md`.
 */
import type { SourceCapabilities } from "@tracepilot/types";
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
}

interface SessionTabDefinition {
  name: string;
  label: string;
  routeName: RouteName;
  /** The capability a session's source needs for this tab to show. */
  requires?: keyof SourceCapabilities;
}

const SESSION_TABS: readonly SessionTabDefinition[] = [
  { name: "overview", label: "Overview", routeName: ROUTE_NAMES.sessionOverview },
  { name: "conversation", label: "Conversation", routeName: ROUTE_NAMES.sessionConversation },
  { name: "events", label: "Events", routeName: ROUTE_NAMES.sessionEvents },
  { name: "todos", label: "Todos", routeName: ROUTE_NAMES.sessionTodos, requires: "hasTodos" },
  { name: "metrics", label: "Metrics", routeName: ROUTE_NAMES.sessionMetrics },
  {
    name: "context",
    label: "Context",
    routeName: ROUTE_NAMES.sessionContext,
    requires: "hasContextBreakdown",
  },
  {
    name: "explorer",
    label: "Explorer",
    routeName: ROUTE_NAMES.sessionExplorer,
    requires: "hasExplorer",
  },
  { name: "timeline", label: "Timeline", routeName: ROUTE_NAMES.sessionTimeline },
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
 * are left out; without them every tab shows.
 *
 * The function is pure: each call produces a fresh array of fresh objects
 * so callers may safely mutate the result (e.g. patching `count`).
 */
export function mapSessionTabs(mode: SessionTabMode, caps?: SourceCapabilities): SessionTab[] {
  return SESSION_TABS.filter((t) => isTabVisible(t, caps)).map((t) => ({
    name: t.name,
    label: t.label,
    routeName: mode === "local" ? t.name : t.routeName,
  }));
}

/**
 * True when `nameOrRoute` (a tab name or its route name) is a tab the
 * source cannot show. Unknown names are not hidden.
 */
export function isSessionTabHidden(nameOrRoute: string, caps: SourceCapabilities): boolean {
  const tab = SESSION_TABS.find((t) => t.name === nameOrRoute || t.routeName === nameOrRoute);
  return tab != null && !isTabVisible(tab, caps);
}
