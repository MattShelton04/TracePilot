/**
 * Canonical registry of sidebar navigation IDs.
 *
 * Used by `router/index.ts` route meta (`sidebarId`) and by
 * `components/layout/AppSidebar.vue` to match the active route to a
 * sidebar entry.  Single source of truth — the `SidebarId` union is
 * narrowed from this const so any drift surfaces at compile time.
 *
 * See Phase 1B.2 in `docs/tech-debt-plan-revised-2026-04.md`.
 */
export const SIDEBAR_IDS = {
  sessions: "sessions",
  search: "search",
  analytics: "analytics",
  health: "health",
  tools: "tools",
  code: "code",
  models: "models",
  compare: "compare",
  replay: "replay",
  export: "export",
  settings: "settings",
  orchestration: "orchestration",
  worktrees: "worktrees",
  launcher: "launcher",
  configInjector: "config-injector",
  mcp: "mcp",
  skills: "skills",
} as const;

export type SidebarId = (typeof SIDEBAR_IDS)[keyof typeof SIDEBAR_IDS];
