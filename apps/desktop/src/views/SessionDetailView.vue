<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { useAutoRefresh } from "@/composables/useAutoRefresh";
import { logError } from "@/utils/logger";
import { usePerfMonitor } from "@/composables/usePerfMonitor";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import { TabNav, Badge, ErrorAlert, SkeletonLoader, useClipboard } from "@tracepilot/ui";
import { resumeSessionInTerminal, isSessionRunning, openInExplorer } from "@tracepilot/client";

const route = useRoute();
const router = useRouter();
const store = useSessionDetailStore();
usePerfMonitor('SessionDetailView');
const prefs = usePreferencesStore();

const sessionId = computed(() => route.params.id as string);
const resolvedSessionId = computed(() => store.detail?.id ?? sessionId.value);
const { copy, copied } = useClipboard();

// Track live "running" state via lock file check
const isSessionActive = ref(false);

// Resume confirmation state for active sessions
const confirmingCopy = ref(false);
const confirmingResume = ref(false);

async function openSessionFolder() {
  const path = `${prefs.sessionStateDir}/${resolvedSessionId.value}`;
  try {
    await openInExplorer(path);
  } catch (e) {
    logError('[sessionDetail] Failed to open folder:', e);
  }
}

async function checkRunning() {
  if (!sessionId.value) {
    isSessionActive.value = false;
    return;
  }
  try {
    isSessionActive.value = await isSessionRunning(sessionId.value);
  } catch (e) {
    isSessionActive.value = false;
    logError('[sessionDetail] Failed to check if session is running:', e);
  }
}

const { refreshing, refresh } = useAutoRefresh({
  onRefresh: async () => {
    await Promise.all([store.refreshAll(), checkRunning()]);
  },
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

async function copyResumeCommand() {
  if (isSessionActive.value && !confirmingCopy.value) {
    confirmingCopy.value = true;
    return;
  }
  confirmingCopy.value = false;
  const text = `${prefs.cliCommand} --resume ${resolvedSessionId.value}`;
  await copy(text);
}

function cancelCopy() {
  confirmingCopy.value = false;
}

async function resumeInTerminal() {
  if (isSessionActive.value && !confirmingResume.value) {
    confirmingResume.value = true;
    return;
  }
  confirmingResume.value = false;
  try {
    await resumeSessionInTerminal(resolvedSessionId.value, prefs.cliCommand);
  } catch (e) {
    logError('[sessionDetail] Failed to open terminal:', e);
  }
}

function cancelResume() {
  confirmingResume.value = false;
}

const tabs = computed(() => [
  { name: "overview", routeName: "session-overview", label: "Overview" },
  { name: "conversation", routeName: "session-conversation", label: "Conversation", count: store.detail?.turnCount ?? undefined },
  { name: "events", routeName: "session-events", label: "Events", count: store.detail?.eventCount ?? undefined },
  { name: "todos", routeName: "session-todos", label: "Todos" },
  { name: "metrics", routeName: "session-metrics", label: "Metrics" },
  { name: "token-flow", routeName: "session-token-flow", label: "Token Flow" },
  { name: "timeline", routeName: "session-timeline", label: "Timeline" },
]);

const currentModel = computed(() =>
  store.detail?.shutdownMetrics?.currentModel ?? "",
);

onMounted(async () => {
  store.loadDetail(sessionId.value);
  await checkRunning();
});

watch(sessionId, async (newId) => {
  confirmingCopy.value = false;
  confirmingResume.value = false;
  if (newId) {
    store.loadDetail(newId);
    await checkRunning();
  }
});

// Clear confirmation state when session becomes inactive
watch(isSessionActive, (active) => {
  if (!active) {
    confirmingCopy.value = false;
    confirmingResume.value = false;
  }
});

// Note: we intentionally do NOT call store.reset() on unmount.
// The store handles re-initialization when switching sessions via loadDetail(newId).
// Calling reset() on unmount causes race conditions when navigating between
// views that share the session detail store (e.g., Detail ↔ Replay).
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">

      <!-- Loading state -->
      <div v-if="store.loading" style="padding-top: 8px;">
        <SkeletonLoader variant="text" :count="1" />
        <SkeletonLoader variant="badge" :count="3" />
      </div>

      <!-- Error state -->
      <ErrorAlert v-if="store.error" :message="store.error" />

      <!-- Session header + tabs + content -->
      <template v-if="store.detail">
        <h1 class="detail-title">
          <Transition name="active-indicator">
            <span v-if="isSessionActive" class="active-indicator-group">
              <span class="active-dot" title="Session is currently active" />
            </span>
          </Transition>
          {{ store.detail.summary || 'Untitled Session' }}
          <Transition name="active-indicator">
            <span v-if="isSessionActive" class="active-indicator-group">
              <Badge variant="success" class="active-badge-inline">● Active</Badge>
            </span>
          </Transition>
        </h1>
        <div class="detail-badges">
          <Badge v-if="store.detail.repository" variant="accent">{{ store.detail.repository }}</Badge>
          <Badge v-if="store.detail.branch" variant="success">{{ store.detail.branch }}</Badge>
          <Badge v-if="currentModel" variant="done">{{ currentModel }}</Badge>
          <Badge variant="neutral">{{ store.detail.hostType || 'cli' }}</Badge>
        </div>

        <div class="detail-actions">
          <div class="detail-actions-left">
            <template v-if="confirmingCopy">
              <span class="resume-warning">⚠ Session is active elsewhere</span>
              <button class="resume-btn resume-btn--confirm" @click="copyResumeCommand">
                Copy Anyway
              </button>
              <button class="resume-btn resume-btn--cancel" @click="cancelCopy">Cancel</button>
            </template>
            <button
              v-else
              class="resume-btn"
              @click="copyResumeCommand"
              :title="`Copy: ${prefs.cliCommand} --resume ${sessionId}`"
            >
              {{ copied ? '✓ Copied!' : '📋 Copy Resume Command' }}
            </button>

            <template v-if="confirmingResume">
              <span class="resume-warning">⚠ Session is active elsewhere</span>
              <button class="resume-btn resume-btn--confirm" @click="resumeInTerminal">
                Resume Anyway
              </button>
              <button class="resume-btn resume-btn--cancel" @click="cancelResume">Cancel</button>
            </template>
            <button
              v-else
              class="resume-btn"
              @click="resumeInTerminal"
              :title="`Resume session ${sessionId} in a new terminal`"
            >
              ▶ Resume in Terminal
            </button>

            <button
              v-if="prefs.isFeatureEnabled('sessionReplay')"
              class="resume-btn"
              @click="router.push({ name: 'replay', params: { id: sessionId } })"
              title="Open session in step-by-step replay view"
            >
              🎬 Replay
            </button>

            <button
              class="resume-btn"
              @click="openSessionFolder"
              title="Open session state folder in file explorer"
            >
              📂 Open Folder
            </button>
          </div>

          <div class="detail-actions-right">
            <RefreshToolbar
              :refreshing="refreshing"
              :auto-refresh-enabled="prefs.autoRefreshEnabled"
              :interval-seconds="prefs.autoRefreshIntervalSeconds"
              @refresh="refresh"
              @update:auto-refresh-enabled="prefs.autoRefreshEnabled = $event"
              @update:interval-seconds="prefs.autoRefreshIntervalSeconds = $event"
            />
          </div>
        </div>

        <TabNav :tabs="tabs" />

        <div class="detail-tab-content">
          <router-view :key="`${sessionId}-${String(route.name)}`" />
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
.detail-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.active-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  margin-left: 2px;
  animation: pulse-active 2s ease-in-out infinite;
  overflow: visible;
  position: relative;
}

@keyframes pulse-active {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.85); }
}

.active-badge-inline {
  font-size: 0.6875rem;
  flex-shrink: 0;
}

/* Animate active indicator in/out */
.active-indicator-group {
  display: inline-flex;
  align-items: center;
}
.active-indicator-enter-active,
.active-indicator-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.active-indicator-enter-from {
  opacity: 0;
  transform: scale(0);
}
.active-indicator-leave-to {
  opacity: 0;
  transform: scale(0);
}

.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  min-width: 0;
}
.detail-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(24, 24, 27, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

:root[data-theme="light"] .detail-actions {
  background: rgba(255, 255, 255, 0.75);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.05);
}
.detail-actions-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.detail-actions-right {
  display: flex;
  align-items: center;
  margin-left: auto;
}
.resume-warning {
  font-size: 0.75rem;
  color: var(--warning-fg, #d29922);
  font-weight: 500;
}
.resume-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.resume-btn:hover {
  background: var(--neutral-subtle);
  border-color: var(--border-accent);
}
.resume-btn--confirm {
  color: var(--warning-fg, #d29922);
  border-color: var(--warning-fg, #d29922);
}
.resume-btn--confirm:hover {
  background: rgba(210, 153, 34, 0.1);
}
.resume-btn--cancel {
  color: var(--text-secondary);
}
.detail-tab-content {
  padding-top: 4px;
}
</style>
