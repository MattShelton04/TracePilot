import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

// Apply persisted theme before mount to prevent flash.
// Uses a dedicated write-through cache key so we never parse the full config
// blob synchronously on startup.
const cachedTheme = localStorage.getItem("tracepilot-theme");
document.documentElement.setAttribute(
  "data-theme",
  cachedTheme === "light" ? "light" : "dark",
);

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#root");
