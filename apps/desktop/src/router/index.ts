import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "sessions",
      component: () => import("@/views/SessionListView.vue"),
    },
    {
      path: "/session/:id",
      name: "session-detail",
      redirect: { name: "session-overview" },
      component: () => import("@/views/SessionDetailView.vue"),
      children: [
        { path: "", name: "session-overview", component: () => import("@/views/tabs/OverviewTab.vue") },
        { path: "conversation", name: "session-conversation", component: () => import("@/views/tabs/ConversationTab.vue") },
        { path: "events", name: "session-events", component: () => import("@/views/tabs/EventsTab.vue") },
        { path: "todos", name: "session-todos", component: () => import("@/views/tabs/TodosTab.vue") },
        { path: "metrics", name: "session-metrics", component: () => import("@/views/tabs/MetricsTab.vue") },
      ],
    },
  ],
});

export default router;
