<script setup lang="ts">
/**
 * ChildApp.vue — Lightweight shell for viewer (child) windows.
 *
 * Unlike the main App.vue, this does NOT include:
 *   - Sidebar, breadcrumbs, search palette
 *   - Setup wizard, indexing screen
 *   - Update checker, What's New modal
 *   - Alert watcher (main window only)
 *   - Router (not needed — single session view)
 *
 * It renders a single SessionDetailTabView for the session ID
 * encoded in the window label (e.g. "viewer-abc12345").
 */
import { ErrorAlert, PageShell, ToastContainer } from "@tracepilot/ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
import SessionDetailTabView from "@/views/SessionDetailTabView.vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { logError } from "@/utils/logger";

const props = defineProps<{
  sessionId: string;
}>();

const prefs = usePreferencesStore();
const sessionsStore = useSessionsStore();

const error = ref<string | null>(null);
const ready = ref(false);
const activeSubTab = ref("overview");

const sessionLabel = computed(() => {
  const session = sessionsStore.sessions.find((s) => s.id === props.sessionId);
  return session?.summary ?? `Session ${props.sessionId.slice(0, 8)}`;
});

onMounted(async () => {
  if (!props.sessionId) {
    error.value = "No session ID provided. Close this window and try again.";
    return;
  }

  try {
    await sessionsStore.fetchSessions();
    await prefs.hydrate();
    ready.value = true;

    // Update the native window title with the session name
    updateWindowTitle();
  } catch (e) {
    logError("[ChildApp] Failed to initialize:", e);
    error.value = "Failed to load session data.";
  }
});

// Notify main window when this popup closes so it can update monitored set.
// Uses synchronous event emission for reliability — async imports may not
// complete before the webview tears down during native window close.
import { emit } from "@tauri-apps/api/event";

onUnmounted(() => {
  emit("popup-session-closed", { sessionId: props.sessionId }).catch(() => {});
});

async function updateWindowTitle() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const label = sessionLabel.value;
    await getCurrentWindow().setTitle(`TracePilot — ${label}`);
  } catch { /* best-effort — title bar still shows label in-app */ }
}

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}
</script>

<template>
  <div class="child-app" :data-theme="prefs.theme">
    <!-- Ambient background -->
    <div class="child-bg" aria-hidden="true">
      <div class="child-dot-grid" />
    </div>

    <div class="child-layout">
      <!-- Compact title bar -->
      <div class="child-titlebar">
        <span class="child-titlebar-label">{{ sessionLabel }}</span>
        <button class="child-titlebar-close" title="Close window" @click="closeWindow">×</button>
      </div>

      <!-- Content -->
      <div class="child-content">
        <ErrorAlert v-if="error" :message="error" />
        <div v-else-if="!ready" class="child-loading">Loading session…</div>
        <SessionDetailTabView
          v-else
          :session-id="sessionId"
          :active-sub-tab="activeSubTab"
          @update:active-sub-tab="activeSubTab = $event"
        />
      </div>
    </div>

    <ToastContainer />
  </div>
</template>

<style scoped>
.child-app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--canvas-default);
  color: var(--text-primary);
}

.child-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.child-dot-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 24px 24px;
}

.child-layout {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.child-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.child-titlebar-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80%;
}

.child-titlebar-close {
  -webkit-app-region: no-drag;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.child-titlebar-close:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.child-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.child-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: 14px;
}
</style>
