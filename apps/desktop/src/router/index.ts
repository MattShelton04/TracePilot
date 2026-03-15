import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
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
    component: () => import('../views/HealthScoringView.vue'),
    meta: {
      title: "Health Scoring",
      sidebarId: "health",
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
    },
  },
  {
    path: "/export",
    name: "export",
    component: () => import("@/views/ExportView.vue"),
    meta: {
      title: "Export",
      sidebarId: "export",
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

export default router;
