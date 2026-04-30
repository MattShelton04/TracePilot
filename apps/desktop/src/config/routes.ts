/**
 * Canonical registry of Vue Router route names.
 *
 * Single source of truth for the `name:` strings used across `router/index.ts`
 * and every `router.push({ name: "..." })` / `router.replace({ name: "..." })`
 * call site.  Adding a new route = adding one entry here + a matching record
 * in `router/index.ts`; the `RouteName` union then forces every caller to
 * update.
 *
 * See Phase 1B.2 in `docs/tech-debt-plan-revised-2026-04.md`.
 */
export const ROUTE_NAMES = {
  sessions: "sessions",
  sessionOverview: "session-overview",
  sessionConversation: "session-conversation",
  sessionEvents: "session-events",
  sessionTodos: "session-todos",
  sessionMetrics: "session-metrics",
  sessionTokenFlow: "session-token-flow",
  sessionExplorer: "session-explorer",
  sessionTimeline: "session-timeline",
  search: "search",
  analytics: "analytics",
  health: "health",
  tools: "tools",
  code: "code",
  modelComparison: "model-comparison",
  compare: "compare",
  replay: "replay",
  export: "export",
  settings: "settings",
  orchestration: "orchestration",
  worktreeManager: "worktree-manager",
  sessionLauncher: "session-launcher",
  configInjector: "config-injector",
  mcpManager: "mcp-manager",
  mcpServerDetail: "mcp-server-detail",
  skillsManager: "skills-manager",
  skillEditor: "skill-editor",
  notFound: "not-found",
} as const;

export type RouteName = (typeof ROUTE_NAMES)[keyof typeof ROUTE_NAMES];

/**
 * Runtime guard — narrows an arbitrary string to a known route name.
 * Useful when `to.name` comes from `vue-router` and is typed as
 * `RouteRecordName | null | undefined`.
 */
export function isRouteName(value: unknown): value is RouteName {
  if (typeof value !== "string") return false;
  // biome-ignore lint/suspicious/noExplicitAny: narrow reverse-lookup over const-record
  return Object.values(ROUTE_NAMES).includes(value as any);
}
