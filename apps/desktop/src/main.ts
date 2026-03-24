import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./styles.css";
import "./styles/chart-shared.css";
import { initLogging } from "./utils/logger";

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
  const msg = `[TracePilot] Unhandled error (${info}): ${err instanceof Error ? err.message : String(err)}`;
  console.error(msg, err);
  // Write to backend log file via tauri-plugin-log (works before initLogging)
  import('./utils/logger').then(({ error }) => error(msg)).catch(() => {});
};

app.use(createPinia());
app.use(router);
app.mount("#root");

// Window-level error handlers — catch errors that escape Vue's boundary
window.addEventListener('error', (event) => {
  const msg = `[window.onerror] ${event.error instanceof Error ? event.error.message : String(event.error)}`;
  console.error(msg, event.error);
  import('./utils/logger').then(({ error }) => error(msg)).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = `[unhandledrejection] ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`;
  console.error(msg, event.reason);
  import('./utils/logger').then(({ error }) => error(msg)).catch(() => {});
});

// Init logging AFTER mount — Tauri IPC requires mounted webview
initLogging();
