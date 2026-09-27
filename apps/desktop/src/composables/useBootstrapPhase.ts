import { checkConfigExists, getConfig } from "@tracepilot/client";
import { effectScope, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { registerNotificationClickHandler } from "@/composables/useAlertDispatcher";
import { useAlertWatcher } from "@/composables/useAlertWatcher";
import { initAppVersion, useAppVersion } from "@/composables/useAppVersion";
import { runUpdateCheck } from "@/composables/useUpdateCheck";
import { useWhatsNew } from "@/composables/useWhatsNew";
import { resolveWindowRole, useWindowRole } from "@/composables/useWindowRole";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { logError, logInfo } from "@/utils/logger";

export type AppPhase = "loading" | "setup" | "indexing" | "app";

export function useBootstrapPhase() {
  const router = useRouter();
  const sessionsStore = useSessionsStore();
  const prefsStore = usePreferencesStore();
  const { appVersion } = useAppVersion();
  const { isMain } = useWindowRole();
  const { openWhatsNew } = useWhatsNew();

  const phase = ref<AppPhase>("loading");
  const expectedSessionCount = ref(0);
  // Capture ownership during setup: Vue loses the active scope after an await.
  // This child scope stops with the component, even before alerts have started.
  const bootstrapScope = effectScope();
  let alertInitDone = false;

  /** Idempotent: start alert watcher + notification handler (main only) */
  function initAlertSystem() {
    if (!bootstrapScope.active || !isMain() || alertInitDone) return;

    try {
      bootstrapScope.run(() => useAlertWatcher(router));
      registerNotificationClickHandler(async (sessionId) => {
        await pushRoute(router, ROUTE_NAMES.sessionConversation, {
          params: { id: sessionId },
        });
      });
      alertInitDone = true;
      logInfo("[app] Alert system initialized successfully");
    } catch (e) {
      logError("[app] Alert system initialization failed:", e);
    }
  }

  async function checkVersionChange() {
    const current = appVersion.value;
    if (current === "dev") return;

    const previous = prefsStore.lastSeenVersion;
    if (previous && previous !== current) {
      await openWhatsNew(previous, current);
      if (!bootstrapScope.active) return;
    }
    prefsStore.lastSeenVersion = current;
  }

  function onSetupSaved(sessionCount: number) {
    if (!bootstrapScope.active) return;
    expectedSessionCount.value = sessionCount;
    phase.value = "indexing";
    // Config.toml now exists — re-hydrate preferences so the auto-save watcher
    // is armed and any preference changes made in this session will persist.
    prefsStore.hydrate();
    // Indexing is triggered by the loading screen component itself
    // after it registers its event listeners (prevents race condition).
  }

  async function onIndexingComplete() {
    if (!bootstrapScope.active) return;
    // Mark setup as fully complete so interrupted indexing won't restart setup
    try {
      await prefsStore.updateConfigFields({ general: { setupComplete: true } });
    } catch (e) {
      logError("[app] Failed to save setupComplete flag:", e);
    }
    if (!bootstrapScope.active) return;
    phase.value = "app";
    sessionsStore.fetchSessions();
    initAlertSystem();
  }

  onMounted(async () => {
    // Resolve window role before any role-gated logic
    await resolveWindowRole();
    if (!bootstrapScope.active) return;

    // Initialize app version from Tauri runtime (or 'dev' in browser mode)
    await initAppVersion();
    if (!bootstrapScope.active) return;

    try {
      const exists = await checkConfigExists();
      if (!bootstrapScope.active) return;
      if (exists) {
        // Check if setup was completed — if not, the user interrupted the
        // setup wizard during indexing.  Restart the entire setup flow.
        const cfg = await getConfig();
        if (!bootstrapScope.active) return;
        if (!cfg.general.setupComplete) {
          phase.value = "setup";
          return;
        }

        phase.value = "app";
        await sessionsStore.fetchSessions();
        if (!bootstrapScope.active) return;
        // Signal that the app is fully initialized for automation (CDP / Playwright).
        // Placed here (not main.ts) so it fires only after config + setup checks pass.
        (window as unknown as Record<string, unknown>).__TRACEPILOT_READY__ = true;
        // Wait for preferences to load from config.toml before using config-backed values
        await prefsStore.whenReady;
        if (!bootstrapScope.active) return;

        // Start alert watchers in their component-owned scope (main window only).
        initAlertSystem();

        // Post-load hooks: version change detection + update check
        await checkVersionChange();
        if (!bootstrapScope.active) return;
        if (prefsStore.checkForUpdates) {
          runUpdateCheck();
        }
      } else {
        phase.value = "setup";
      }
    } catch {
      if (!bootstrapScope.active) return;
      phase.value = "app";
      sessionsStore.fetchSessions();
      // Keep live SDK alerts available even when reading config fails.
      initAlertSystem();
      (window as unknown as Record<string, unknown>).__TRACEPILOT_READY__ = true;
    }
  });

  return {
    phase,
    expectedSessionCount,
    onSetupSaved,
    onIndexingComplete,
  };
}
