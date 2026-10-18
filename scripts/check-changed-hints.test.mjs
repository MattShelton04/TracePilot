import assert from "node:assert/strict";
import { test } from "node:test";
import {
  e2eHints,
  e2eReferences,
  isLabel,
  parseRoutes,
  removedLabels,
  visualCaseIds,
  visualHints,
} from "./check-changed-hints.mjs";

const diff = [
  "diff --git a/apps/desktop/src/views/tabs/TodosTab.vue b/apps/desktop/src/views/tabs/TodosTab.vue",
  "--- a/apps/desktop/src/views/tabs/TodosTab.vue",
  "+++ b/apps/desktop/src/views/tabs/TodosTab.vue",
  "@@ -10,4 +10,4 @@",
  '-      <button type="button" class="view-toggle">List</button>',
  '+      <button type="button" class="view-toggle">Rows</button>',
  "-      <span>{{ count }} total events</span>",
  "+      <span>{{ count }} events</span>",
  '-    <div data-testid="session-grid">',
  '+    <div data-testid="session-grid" class="grid">',
  "-      Expand every row",
  "diff --git a/packages/ui/src/labels.ts b/packages/ui/src/labels.ts",
  "--- a/packages/ui/src/labels.ts",
  "+++ b/packages/ui/src/labels.ts",
  "@@ -1,2 +1,2 @@",
  '-export const EMPTY = "No matching sessions";',
  '+export const EMPTY = "Nothing matches";',
  '-import { thing } from "./thing";',
  "diff --git a/apps/desktop/src/views/__tests__/TodosTab.test.ts b/apps/desktop/src/views/__tests__/TodosTab.test.ts",
  "@@ -1 +1 @@",
  '-  expect(text).toBe("Release history");',
  "diff --git a/crates/x/src/lib.rs b/crates/x/src/lib.rs",
  "@@ -1 +1 @@",
  '-  "Release notes"',
].join("\n");

const specs = [
  {
    path: "tests/e2e/journeys.spec.mjs",
    text: [
      'await page.getByRole("button", { name: "List", exact: true }).click();',
      `await expect(page.getByText(\`\${n} total events\`)).toBeVisible();`,
      'await expect(page.getByText("No matching sessions")).toBeVisible();',
      'page.getByTestId("session-grid");',
      'page.getByText("Release history");',
    ].join("\n"),
  },
  { path: "tests/e2e/analytics.spec.mjs", text: 'page.getByRole("link", { name: "Listing" });' },
];

test("labels are visible text or test ids, never code-ish fragments", () => {
  for (const text of ["List", "Expand all", "What's new", "session-grid", "No matching sessions"])
    assert.ok(isLabel(text), text);
  for (const text of ["div", "click", "sessionId", "./thing", "@/views/X.vue", `a \${b}`, "1234"])
    assert.ok(!isLabel(text), text);
});

test("removed labels come from frontend sources and ignore text the diff adds back", () => {
  assert.deepEqual(removedLabels(diff), [
    "Expand every row",
    "List",
    "No matching sessions",
    "total events",
  ]);
});

test("e2e hints name the spec files that reference removed text", () => {
  assert.deepEqual(e2eReferences(diff, specs), [
    ["tests/e2e/journeys.spec.mjs", ["List", "No matching sessions", "total events"]],
  ]);
  const [hint] = e2eHints(diff, specs);
  assert.match(hint, /^e2e: tests\/e2e\/journeys\.spec\.mjs references removed text "List"/);
  assert.match(hint, /pnpm test:e2e/);
});

test("text that still exists elsewhere in the frontend is not reported", () => {
  const present = new Set(["List", "No matching sessions", "total events"]);
  assert.deepEqual(
    e2eHints(diff, specs, (text) => present.has(text)),
    [],
  );
});

const router = `
const SessionListView = () => import("@/views/SessionListView.vue");
const SessionDetailView = () => import("@/views/SessionDetailView.vue");
const NotFoundView = () => import("@/views/NotFoundView.vue");
const routes = [
  { path: "/", name: "sessions", component: SessionListView, meta: { title: "Sessions" } },
  {
    path: "/session/:id",
    component: SessionDetailView,
    children: [{ path: "", redirect: (to) => ({ name: "x" }) }, ...sessionTabRoutes()],
  },
  { path: "/compare", name: "compare", component: () => import("@/views/SessionComparisonView.vue") },
  { path: "/replay/:id?", component: () => import("@/views/SessionReplayView.vue") },
  { path: "/orchestration", component: () => import("@/views/orchestration/OrchestrationHomeView.vue") },
  { path: "/orchestration/worktrees", component: () => import("@/views/orchestration/WorktreeManagerView.vue") },
  { path: "/:pathMatch(.*)*", name: "not-found", component: NotFoundView },
];`;
const tabs = `
export const SESSION_TABS = [
  { name: "overview", label: "Overview", component: () => import("@/views/tabs/OverviewTab.vue") },
  { name: "todos", label: "Todos", requires: "hasTodos", component: () => import("@/views/tabs/TodosTab.vue") },
];`;
const routes = parseRoutes(router, tabs);
const cases = [
  { id: "sessions", route: "/" },
  { id: "session-overview", route: "/session/s1/overview" },
  { id: "session-todos", route: "/session/s1/todos" },
  { id: "compare", route: "/compare" },
  { id: "compare-populated", route: "/compare?a=1&b=2" },
  { id: "replay", route: "/replay/s1" },
  { id: "orchestration", route: "/orchestration" },
  { id: "worktree-manager", route: "/orchestration/worktrees" },
  { id: "not-found", route: "/visual-route-does-not-exist" },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `rich-tool-${i}`,
    group: "rich-tools",
    route: "/session/s2/conversation",
  })),
];
const ids = (paths, read) => visualCaseIds(paths, { cases, routes, read });

test("routes come from the router and the session-tab registry", () => {
  assert.deepEqual(
    routes.map((route) => [route.path, route.view.replace("apps/desktop/src/views/", "")]),
    [
      ["/", "SessionListView.vue"],
      ["/session/:id", "SessionDetailView.vue"],
      ["/compare", "SessionComparisonView.vue"],
      ["/replay/:id?", "SessionReplayView.vue"],
      ["/orchestration", "orchestration/OrchestrationHomeView.vue"],
      ["/orchestration/worktrees", "orchestration/WorktreeManagerView.vue"],
      ["/:pathMatch(.*)*", "NotFoundView.vue"],
      ["/session/:id/overview", "tabs/OverviewTab.vue"],
      ["/session/:id/todos", "tabs/TodosTab.vue"],
    ],
  );
});

test("a changed route view maps to the cases that render it, query routes included", () => {
  assert.deepEqual(ids(["apps/desktop/src/views/SessionComparisonView.vue"]), [
    "compare",
    "compare-populated",
  ]);
  assert.deepEqual(ids(["apps/desktop/src/views/SessionReplayView.vue"]), ["replay"]);
  assert.deepEqual(ids(["apps/desktop/src/views/tabs/TodosTab.vue"]), ["session-todos"]);
  assert.deepEqual(ids(["apps/desktop/src/views/NotFoundView.vue"]), ["not-found"]);
  assert.deepEqual(ids(["apps/desktop/src/views/orchestration/WorktreeManagerView.vue"]), [
    "worktree-manager",
  ]);
});

test("files below a view map through their folder or the views that import them", () => {
  assert.deepEqual(ids(["apps/desktop/src/views/orchestration/home/HeroStats.vue"]), [
    "orchestration",
  ]);
  assert.deepEqual(ids(["apps/desktop/src/views/tabs/overview/KpisSection.vue"]), [
    "session-overview",
  ]);
  const read = (view) => (view.endsWith("SessionListView.vue") ? "import SessionCard from" : "");
  assert.deepEqual(ids(["apps/desktop/src/views/SessionCard.vue"], read), ["sessions"]);
  assert.deepEqual(ids(["apps/desktop/src/views/__tests__/SessionReplayView.test.ts"]), []);
  assert.deepEqual(ids(["apps/desktop/src/components/Foo.vue"]), []);
});

test("visual hints select single cases, or the whole section when many change", () => {
  const sectionOf = (item) => item.group ?? "overview";
  const hints = (paths) => visualHints(paths, { cases, routes, sectionOf });
  assert.deepEqual(hints(["apps/desktop/src/views/SessionComparisonView.vue"]), [
    "visual: changed views render in 2 capture case(s): node scripts/visual/capture.mjs --case=compare,compare-populated (setup: docs/visual-regression.md#local-use-and-adding-cases).",
  ]);
  const detail = hints(["apps/desktop/src/views/SessionDetailView.vue"]);
  assert.equal(detail.length, 2);
  assert.match(detail[0], /--case=session-overview,session-todos /);
  assert.match(detail[1], /in 8 capture case\(s\): .*--group=rich-tools /);
  const router = hints(["apps/desktop/src/router/index.ts"]);
  assert.match(router[0], /--group=overview /);
  assert.deepEqual(hints(["apps/desktop/src/router/__tests__/router.test.ts"]), []);
});
