// README screenshots, captured with the visual harness against the synthetic
// showcase workspace (scripts/visual/showcase). Not part of PR visual CI.
//
//   node scripts/visual/capture.mjs --suite=readme --channel=msedge --docs
//
// `--docs` copies each capture to docs/images/<id>.png.

import { SHOWCASE_NOW } from "./showcase/common.mjs";
import { HERO_SESSION_ID, SEARCH_QUERY, showcaseFixtureId } from "./showcase/index.mjs";

const session = `/session/${HERO_SESSION_ID}`;
const readme = (id, route, ready, extra = {}) => ({
  id: `readme-${id}`,
  route,
  ready,
  fixture: showcaseFixtureId,
  fixedTime: SHOWCASE_NOW,
  // The app's real defaults: Export on, experimental views off unless listed.
  features: ["exportView", ...(extra.features ?? [])],
  state: extra.state ?? "README showcase",
  ...extra,
});

export const readmeCases = [
  readme("session-list", "/", '[data-testid="session-card"]', { command: "list_sessions" }),
  readme("session-overview", `${session}/overview`, ".detail-title"),
  readme("conversation", `${session}/conversation`, ".cv-parallel-header", {
    start: ".detail-title",
    prepare: "actions",
    // Open on the review turn (three parallel agents) just below the toolbar.
    actions: [{ type: "scroll", selector: '[data-turn-idx="8"]', offset: 200 }],
    command: "get_session_turns",
  }),
  readme("timeline", `${session}/timeline`, ".detail-title", { command: "get_session_turns" }),
  readme("agent-messages", `${session}/timeline`, ".detail-title", {
    start: ".detail-title",
    prepare: "actions",
    actions: [{ type: "button", name: "Messages" }],
  }),
  readme("todos", `${session}/todos`, ".detail-title", { command: "get_session_todos" }),
  readme("context", `${session}/context`, ".detail-title", {
    command: "get_session_context_timeline",
  }),
  readme("metrics", `${session}/metrics`, ".detail-title", { command: "get_shutdown_metrics" }),
  readme("session-explorer", `${session}/explorer`, ".fcv__markdown-body", {
    start: ".fb-tree",
    prepare: "open-plan",
    command: "session_read_file",
  }),
  readme("search", `/search?q=${SEARCH_QUERY}`, ".result-card", { command: "search_content" }),
  readme("analytics", "/analytics", "svg", { command: "get_analytics" }),
  readme("tool-analysis", "/tools", "h1", { command: "get_tool_analysis" }),
  readme("code-impact", "/code", "h1", { command: "get_code_impact" }),
  readme("model-comparison", "/models", "h1"),
  readme("orchestration", "/orchestration", "h1"),
  readme("launcher", "/orchestration/launcher", "h1", {
    start: "h1",
    prepare: "actions",
    actions: [
      {
        type: "select",
        label: "Registered or recent repository",
        value: "C:\\code\\acme\\checkout-web",
      },
      { type: "select", label: "Model", option: "Claude Opus 5.5" },
      { type: "button", name: "High" },
      {
        type: "fill",
        label: "Initial Prompt",
        value:
          "Add saved payment methods to checkout. Reuse the PaymentProvider interface, keep card data in Stripe, and add Playwright coverage for returning customers.",
      },
    ],
  }),
  readme("worktrees", "/orchestration/worktrees", ".wt-manager .right-panel", {
    command: "list_worktrees",
  }),
  readme("config-injector", "/orchestration/config", "h1", { features: ["configInjector"] }),
  readme("agents", "/agents", ".agent-card"),
  readme("skills", "/skills", ".skill-card", { command: "skills_usage_summary" }),
];

export function selectReadmeCases(caseIds) {
  const selected = readmeCases.filter((item) => !caseIds || caseIds.includes(item.id));
  const unknown = caseIds?.filter((id) => !readmeCases.some((item) => item.id === id)) ?? [];
  if (unknown.length) throw new Error(`Unknown README case: ${unknown.join(", ")}`);
  return selected;
}
