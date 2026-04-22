import { enablePerfTracing } from "@tracepilot/client";
import { ensureMarkdownReady, toErrorMessage } from "@tracepilot/ui";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { resolveWindowRole, useWindowRole } from "./composables/useWindowRole";
import { STORAGE_KEYS } from "./config/storageKeys";
import { runStorageKeyMigrations } from "./config/storageKeysMigration";
import router from "./router";
import "./styles.css";
import { initLogging, logError } from "./utils/logger";

// Expose `window.__TRACEPILOT_IPC_PERF__` for e2e automation and devtools
// access to the IPC perf ring buffer. Explicit opt-in (Wave 60) — the client
// package no longer installs this hook as a module side-effect.
enablePerfTracing();

// Run any pending localStorage key migrations before the cached-theme read
// or any store setup so all downstream code sees canonical keys.
runStorageKeyMigrations();

// Apply persisted theme before mount to prevent flash.
// Uses a dedicated write-through cache key so we never parse the full config
// blob synchronously on startup.
const VALID_THEMES = ["dark", "light"];
const cachedTheme = localStorage.getItem(STORAGE_KEYS.theme);
document.documentElement.setAttribute(
  "data-theme",
  cachedTheme && VALID_THEMES.includes(cachedTheme) ? cachedTheme : "dark",
);

// Eagerly load markdown parser so MarkdownContent renders instantly (no layout shift).
// Fire-and-forget: the ~150KB async import runs in parallel with app boot and resolves
// before Vue navigates to any route with markdown content. MarkdownContent has a reactive
// mdReady guard as a safety net if the import hasn't resolved yet.
ensureMarkdownReady();

// Resolve window role early so child windows can mount a lightweight shell
resolveWindowRole().then(async () => {
  const { isViewer, viewerSessionId } = useWindowRole();

  if (isViewer()) {
    // Child viewer window — mount lightweight shell without router or full app chrome
    const { default: ChildApp } = await import("./ChildApp.vue");
    const childApp = createApp(ChildApp, {
      sessionId: viewerSessionId.value ?? "",
    });
    childApp.config.errorHandler = (err, _instance, info) => {
      logError(`[TracePilot:viewer] Unhandled error (${info}): ${toErrorMessage(err)}`, err);
    };
    childApp.use(createPinia());
    childApp.mount("#root");
  } else {
    // Main window — full app with router, sidebar, setup wizard, etc.
    const app = createApp(App);
    app.config.errorHandler = (err, _instance, info) => {
      logError(`[TracePilot] Unhandled error (${info}): ${toErrorMessage(err)}`, err);
    };
    app.use(createPinia());
    app.use(router);
    app.mount("#root");
  }

  // Init logging AFTER mount — Tauri IPC requires mounted webview
  initLogging();
});

// Window-level error handlers — catch errors that escape Vue's boundary
window.addEventListener("error", (event) => {
  logError(`[window.onerror] ${toErrorMessage(event.error)}`, event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  logError(`[unhandledrejection] ${toErrorMessage(event.reason)}`, event.reason);
});

// Dev-only: observe long tasks (>50ms main-thread blocks)
if (import.meta.env.DEV) {
  import("./utils/longTaskObserver").then((m) => m.startLongTaskObserver());
}
