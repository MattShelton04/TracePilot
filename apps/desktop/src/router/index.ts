import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import { usePreferencesStore } from "@/stores/preferences";
import { logError } from "@/utils/logger";
import type {} from "./types";

// Lazy-loaded view imports for code splitting
const SessionListView = () => import("@/views/SessionListView.vue");
const SessionDetailView = () => import("@/views/SessionDetailView.vue");
const NotFoundView = () => import("@/views/NotFoundView.vue");

// Detail tab components
const OverviewTab = () => import("@/views/tabs/OverviewTab.vue");
const ConversationTab = () => import("@/views/tabs/ConversationTab.vue");
const EventsTab = () => import("@/views/tabs/EventsTab.vue");
const TodosTab = () => import("@/views/tabs/TodosTab.vue");
const MetricsTab = () => import("@/views/tabs/MetricsTab.vue");
const TokenFlowTab = () => import("@/views/tabs/TokenFlowTab.vue");

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "sessions",
    component: SessionListView,
    meta: {
      title: "Sessions",
      sidebarId: "sessions",
    },
  },
  {
    path: "/session/:id",
    name: "session-detail",
    component: SessionDetailView,
    meta: {
      title: "Session Detail",
      sidebarId: "sessions",
    },
    children: [
      {
        path: "",
        redirect: (to) => ({ name: "session-overview", params: to.params }),
      },
      {
        path: "overview",
        name: "session-overview",
        component: OverviewTab,
        meta: { title: "Overview", sidebarId: "sessions" },
      },
      {
        path: "conversation",
        name: "session-conversation",
        component: ConversationTab,
        meta: { title: "Conversation", sidebarId: "sessions" },
      },
      {
        path: "events",
        name: "session-events",
        component: EventsTab,
        meta: { title: "Events", sidebarId: "sessions" },
      },
      {
        path: "todos",
        name: "session-todos",
        component: TodosTab,
        meta: { title: "Todos", sidebarId: "sessions" },
      },
      {
        path: "metrics",
        name: "session-metrics",
        component: MetricsTab,
        meta: { title: "Metrics", sidebarId: "sessions" },
      },
      {
        path: "token-flow",
        name: "session-token-flow",
        component: TokenFlowTab,
        meta: { title: "Token Flow", sidebarId: "sessions" },
      },
      {
        path: "timeline",
        name: "session-timeline",
        component: () => import("@/views/SessionTimelineView.vue"),
        meta: {
          title: "Timeline",
          sidebarId: "sessions",
        },
      },
    ],
  },
  // === New top-level routes (all stubs initially) ===
  {
    path: "/search",
    name: "search",
    component: () => import("@/views/SessionSearchView.vue"),
    meta: {
      title: "Session Search",
      sidebarId: "search",
    },
  },
  {
    path: "/analytics",
    name: "analytics",
    component: () => import("@/views/AnalyticsDashboardView.vue"),
    meta: {
      title: "Analytics Dashboard",
      sidebarId: "analytics",
    },
  },
  {
    path: "/health",
    name: "health",
    component: () => import("@/views/HealthScoringView.vue"),
    meta: {
      title: "Health Scoring",
      sidebarId: "health",
      featureFlag: "healthScoring",
    },
  },
  {
    path: "/tools",
    name: "tools",
    component: () => import("@/views/ToolAnalysisView.vue"),
    meta: {
      title: "Tool Analysis",
      sidebarId: "tools",
    },
  },
  {
    path: "/code",
    name: "code",
    component: () => import("@/views/CodeImpactView.vue"),
    meta: {
      title: "Code Impact",
      sidebarId: "code",
    },
  },
  {
    path: "/models",
    name: "model-comparison",
    component: () => import("@/views/ModelComparisonView.vue"),
    meta: {
      title: "Model Comparison",
      sidebarId: "models",
    },
  },
  {
    path: "/compare",
    name: "compare",
    component: () => import("@/views/SessionComparisonView.vue"),
    meta: {
      title: "Session Comparison",
      sidebarId: "compare",
    },
  },
  {
    path: "/replay/:id?",
    name: "replay",
    component: () => import("@/views/SessionReplayView.vue"),
    meta: {
      title: "Session Replay",
      sidebarId: "replay",
      featureFlag: "sessionReplay",
    },
  },
  {
    path: "/export",
    name: "export",
    component: () => import("@/views/ExportView.vue"),
    meta: {
      title: "Export",
      sidebarId: "export",
      featureFlag: "exportView",
    },
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("@/views/SettingsView.vue"),
    meta: {
      title: "Settings",
      sidebarId: "settings",
    },
  },
  // === Orchestration routes ===
  {
    path: "/orchestration",
    name: "orchestration",
    component: () => import("@/views/orchestration/OrchestrationHomeView.vue"),
    meta: {
      title: "Orchestration",
      sidebarId: "orchestration",
    },
  },
  {
    path: "/orchestration/worktrees",
    name: "worktree-manager",
    component: () => import("@/views/orchestration/WorktreeManagerView.vue"),
    meta: {
      title: "Worktree Manager",
      sidebarId: "worktrees",
    },
  },
  {
    path: "/orchestration/launcher",
    name: "session-launcher",
    component: () => import("@/views/orchestration/SessionLauncherView.vue"),
    meta: {
      title: "Session Launcher",
      sidebarId: "launcher",
    },
  },
  {
    path: "/orchestration/config",
    name: "config-injector",
    component: () => import("@/views/orchestration/ConfigInjectorView.vue"),
    meta: {
      title: "Config Injector",
      sidebarId: "config-injector",
    },
  },
  // === MCP Server Management ===
  {
    path: "/mcp",
    name: "mcp-manager",
    component: () => import("@/views/mcp/McpManagerView.vue"),
    meta: {
      title: "MCP Servers",
      sidebarId: "mcp",
      featureFlag: "mcpServers",
    },
  },
  {
    path: "/mcp/:name",
    name: "mcp-server-detail",
    component: () => import("@/views/mcp/McpServerDetailView.vue"),
    meta: {
      title: "MCP Server Detail",
      sidebarId: "mcp",
      featureFlag: "mcpServers",
    },
  },
  // === Skills routes ===
  {
    path: "/skills",
    name: "skills-manager",
    component: () => import("@/views/skills/SkillsManagerView.vue"),
    meta: {
      title: "Skills",
      sidebarId: "skills",
      featureFlag: "skills",
    },
  },
  {
    path: "/skills/:name",
    name: "skill-editor",
    component: () => import("@/views/skills/SkillEditorView.vue"),
    meta: {
      title: "Skill Editor",
      sidebarId: "skills",
      featureFlag: "skills",
    },
  },
  // ── AI Tasks ─────────────────────────────────────────────────────────────────
  {
    path: "/tasks",
    name: "tasks",
    component: () => import("@/views/tasks/TaskDashboardView.vue"),
    meta: {
      title: "AI Tasks",
      sidebarId: "ai-tasks",
      featureFlag: "aiTasks",
    },
  },
  {
    path: "/tasks/new",
    name: "task-create",
    component: () => import("@/views/tasks/TaskCreateView.vue"),
    meta: {
      title: "Create Task",
      sidebarId: "ai-tasks",
      featureFlag: "aiTasks",
    },
  },
  {
    path: "/tasks/:taskId",
    name: "task-detail",
    component: () => import("@/views/tasks/TaskDetailView.vue"),
    meta: {
      title: "Task Detail",
      sidebarId: "ai-tasks",
      featureFlag: "aiTasks",
    },
  },
  {
    path: "/tasks/monitor",
    name: "task-monitor",
    component: () => import("@/views/tasks/OrchestratorMonitorView.vue"),
    meta: {
      title: "Orchestrator Monitor",
      sidebarId: "ai-tasks",
      featureFlag: "aiTasks",
    },
  },
  {
    path: "/tasks/presets",
    name: "task-presets",
    component: () => import("@/views/tasks/PresetManagerView.vue"),
    meta: {
      title: "Task Presets",
      sidebarId: "ai-tasks",
      featureFlag: "aiTasks",
    },
  },
  // 404 catch-all — must be last
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: NotFoundView,
    meta: { title: "Not Found" },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// Gate feature-flagged routes (await hydration so deep-links aren't incorrectly blocked)
router.beforeEach(async (to) => {
  const flag = to.meta?.featureFlag as string | undefined;
  if (flag) {
    const prefs = usePreferencesStore();
    await prefs.whenReady;
    if (!prefs.isFeatureEnabled(flag)) {
      return { name: "sessions" };
    }
  }
});

// Handle lazy-load chunk failures (e.g., network errors, stale deploys)
// Guard against infinite reload loops with a sessionStorage timestamp
router.onError((error, to) => {
  if (
    error.message?.includes("Failed to fetch dynamically imported module") ||
    error.message?.includes("Loading chunk") ||
    error.message?.includes("Loading CSS chunk")
  ) {
    const key = "chunk-reload-ts";
    const last = Number(sessionStorage.getItem(key) || 0);
    const now = Date.now();
    if (now - last > 10_000) {
      sessionStorage.setItem(key, String(now));
      logError(`[router] Chunk load failed for ${to.fullPath}, reloading…`, error);
      window.location.reload();
    } else {
      logError(
        `[router] Chunk load failed for ${to.fullPath}, skipping reload (already retried recently)`,
        error,
      );
      router.replace({ name: "sessions" });
    }
  }
});

export default router;
