// Every named desktop route has an entry. These are browser fixture states,
// never evidence that Rust, the SDK, native dialogs or external services work.
const session = "/session/sess-auth-refactor";
export const cases = [
  { id: "sessions", route: "/", ready: '[data-testid="session-card"]', state: "populated" },
  ...[
    "overview",
    "conversation",
    "events",
    "todos",
    "metrics",
    "context",
    "explorer",
    "timeline",
  ].map((tab) => ({
    id: `session-${tab}`,
    route: `${session}/${tab}`,
    ready: tab === "explorer" ? ".fb-tree" : ".detail-title",
    state: "populated",
  })),
  {
    id: "session-explorer-file",
    route: `${session}/explorer`,
    start: ".fb-tree",
    prepare: "open-plan",
    ready: ".fcv__markdown-body",
    command: "session_read_file",
    state: "synthetic plan.md selected in the file reader",
  },
  {
    id: "search",
    route: "/search",
    ready: ".search-view",
    state: "empty search prompt; indexed fixtures",
  },
  {
    id: "search-results",
    route: "/search?q=auth",
    ready: ".result-card",
    command: "search_content",
    state: "populated search results",
  },
  {
    id: "analytics",
    route: "/analytics",
    ready: "svg",
    command: "get_analytics",
    state: "populated",
  },
  { id: "tools", route: "/tools", ready: "h1", command: "get_tool_analysis", state: "populated" },
  { id: "code", route: "/code", ready: "h1", command: "get_code_impact", state: "populated" },
  { id: "model-comparison", route: "/models", ready: "h1", state: "populated" },
  { id: "compare", route: "/compare", ready: "h1", state: "session picker" },
  {
    id: "compare-populated",
    route: "/compare",
    start: ".selector-row",
    prepare: "compare-sessions",
    ready: ".delta-table",
    command: "get_shutdown_metrics",
    state: "two synthetic sessions compared; zero file-count baseline",
  },
  {
    id: "replay",
    route: "/replay/sess-auth-refactor",
    ready: "h1",
    state: "Experimental · explicitly enabled; populated paused replay",
    features: ["sessionReplay"],
  },
  {
    id: "export",
    route: "/export",
    ready: "h1",
    features: ["exportView"],
    state: "Experimental · explicitly enabled; session picker",
  },
  {
    id: "export-preview",
    route: "/export?sessionId=sess-auth-refactor&preset=minimal-team-log",
    ready: ".preview-footer",
    command: "preview_export",
    state: "Experimental · explicitly enabled; selected session and populated Markdown preview",
    features: ["exportView"],
  },
  { id: "settings", route: "/settings", ready: ".settings-root", state: "configured defaults" },
  {
    id: "settings-pricing",
    route: "/settings",
    ready: ".settings-root",
    scrollText: "AI Credit Tracking",
    state: "configured pricing",
  },
  {
    id: "orchestration",
    route: "/orchestration",
    ready: "h1",
    state: "SDK disabled; fixture sessions",
  },
  {
    id: "worktree-manager",
    route: "/orchestration/worktrees",
    ready: ".wt-manager .right-panel",
    command: "list_worktrees",
    state: "populated fixture repositories",
  },
  {
    id: "session-launcher",
    route: "/orchestration/launcher",
    ready: "h1",
    state: "launch form; no process launched",
  },
  {
    id: "config-injector",
    route: "/orchestration/config",
    ready: "h1",
    state: "Experimental · explicitly enabled; fixture configuration",
    features: ["configInjector"],
  },
  {
    id: "mcp-manager",
    route: "/mcp",
    ready: ".mcp-server-card, .server-card",
    features: ["mcpServers"],
    state: "Experimental · explicitly enabled; populated",
  },
  {
    id: "mcp-server-detail",
    route: "/mcp/visual-files",
    ready: ".detail-server-name",
    state: "Experimental · explicitly enabled; configured; no network health check",
    features: ["mcpServers"],
  },
  { id: "skills-manager", route: "/skills", ready: ".skill-card", state: "populated" },
  {
    id: "skill-editor",
    route: "/skills/visual-review",
    ready: ".editor-body",
    state: "populated synthetic skill",
  },
  {
    id: "cli-context",
    route: "/cli-context",
    ready: "h1",
    state: "Experimental · explicitly enabled; no captured external context",
    features: ["exactContextCapture"],
  },
  { id: "not-found", route: "/visual-route-does-not-exist", ready: "h2", state: "not found" },
];
export const viewport = { width: 1440, height: 960 };
export const fixedTime = "2026-03-20T12:00:00.000Z";

export function selectCases(shard = "1/1") {
  const [index, total] = shard.split("/").map(Number);
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    index < 1 ||
    index > total ||
    total > 8
  ) {
    throw new Error(`Invalid shard: ${shard}`);
  }
  return cases.filter((_, i) => i % total === index - 1);
}
