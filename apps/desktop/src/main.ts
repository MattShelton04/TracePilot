import { createApp } from "vue";
import { createPinia } from "pinia";
import { toErrorMessage } from "@tracepilot/ui";
import App from "./App.vue";
import router from "./router";
import "./styles.css";
import { initLogging, logError } from "./utils/logger";

// Apply persisted theme before mount to prevent flash.
// Uses a dedicated write-through cache key so we never parse the full config
// blob synchronously on startup.
const cachedTheme = localStorage.getItem("tracepilot-theme");
document.documentElement.setAttribute(
  "data-theme",
  cachedTheme === "light" ? "light" : "dark",
);

const app = createApp(App);

// Global error handler — captures unhandled errors for both devtools AND log file
app.config.errorHandler = (err, _instance, info) => {
  logError(`[TracePilot] Unhandled error (${info}): ${toErrorMessage(err)}`, err);
};

app.use(createPinia());
app.use(router);
app.mount("#root");

// Window-level error handlers — catch errors that escape Vue's boundary
window.addEventListener('error', (event) => {
  logError(`[window.onerror] ${toErrorMessage(event.error)}`, event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  logError(`[unhandledrejection] ${toErrorMessage(event.reason)}`, event.reason);
});

// Init logging AFTER mount — Tauri IPC requires mounted webview
initLogging();
