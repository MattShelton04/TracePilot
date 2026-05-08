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
}

const SESSION_TABS: readonly SessionTabDefinition[] = [
  { name: "overview", label: "Overview", routeName: ROUTE_NAMES.sessionOverview },
  { name: "conversation", label: "Conversation", routeName: ROUTE_NAMES.sessionConversation },
  { name: "events", label: "Events", routeName: ROUTE_NAMES.sessionEvents },
  { name: "todos", label: "Todos", routeName: ROUTE_NAMES.sessionTodos },
  { name: "metrics", label: "Metrics", routeName: ROUTE_NAMES.sessionMetrics },
  { name: "explorer", label: "Explorer", routeName: ROUTE_NAMES.sessionExplorer },
  { name: "timeline", label: "Timeline", routeName: ROUTE_NAMES.sessionTimeline },
];

/**
 * Returns the list of session-detail tabs visible in the given
 * {@link SessionTabMode}, preserving the canonical order defined in
 * {@link SESSION_TABS}.
 *
 * The function is pure: each call produces a fresh array of fresh objects
 * so callers may safely mutate the result (e.g. patching `count`).
 */
export function mapSessionTabs(mode: SessionTabMode): SessionTab[] {
  return SESSION_TABS.map((t) => ({
    name: t.name,
    label: t.label,
    routeName: mode === "local" ? t.name : t.routeName,
  }));
}
