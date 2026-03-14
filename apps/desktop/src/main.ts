import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "./styles.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "sessions",
      component: () => import("./views/SessionListView.vue"),
    },
    {
      path: "/session/:id",
      name: "session-detail",
      component: () => import("./views/SessionDetailView.vue"),
    },
  ],
});

const app = createApp(App);
app.use(router);
app.mount("#root");
