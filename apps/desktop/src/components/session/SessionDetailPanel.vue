<script setup lang="ts">
/**
 * SessionDetailPanel — shared session detail header, actions & inner tab nav.
 *
 * Used by both:
 *  - SessionDetailView (route-driven, uses Pinia singleton)
 *  - SessionDetailTabView (tab/child-window, uses per-instance composable)
 *
 * The panel owns the session's running state and refreshing; the header
 * ({@link SessionDetailHeader}) and action bar ({@link SessionDetailActions})
 * render from it, and the tab nav renders from the tab registry
 * (`@/config/sessionTabs`). The inner content area is provided via the
 * default slot.
 */
import { getSessionLiveness } from "@tracepilot/client";
import { isNonCopilotSource, type RunStatus, runStatusBadge, sourceLabel } from "@tracepilot/types";
import {
  ErrorAlert,
  LIVE_TOOL_PARTIAL_OUTPUT_KEY,
  MAIN_AGENT_LABEL_KEY,
  PageShell,
  SkeletonLoader,
  TabNav,
  useAsyncGuard,
  useAutoRefresh,
} from "@tracepilot/ui";
import { computed, onMounted, provide, ref, watch } from "vue";
import type { Router } from "vue-router";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import SessionDetailActions from "@/components/session/SessionDetailActions.vue";
import SessionDetailHeader from "@/components/session/SessionDetailHeader.vue";
import { useLivePersistedSync } from "@/composables/useLivePersistedSync";
import { useRunningSessionPoll } from "@/composables/useRunningSessionPoll";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { SESSION_LIVE_STATE_KEY } from "@/composables/useSessionLiveState";
import { useSessionSource } from "@/composables/useSessionSource";
import { mapSessionTabs, type SessionTabMode } from "@/config/sessionTabs";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { isSessionNotFoundError } from "@/utils/backendErrors";
import { logError, logWarn } from "@/utils/logger";
import { normalizeToolPartialOutput } from "@/utils/normalizeToolPartialOutput";

const props = defineProps<{
  store: SessionDetailContext;
  sessionId: string;
  /** Router instance (null in child windows where no router is installed) */
  router?: Router | null;
  /**
   * Inner tab routing mode:
   * - "router"  → tabs use routeName to push routes (SessionDetailView)
   * - "local"   → tabs controlled via v-model (SessionDetailTabView / child window)
   */
  tabMode: SessionTabMode;
  /** Current inner sub-tab name (used when tabMode="local") */
  activeSubTab?: string;
  /** Whether auto-refresh should be enabled (e.g. paused when tab not visible) */
  refreshEnabled?: boolean;
  /**
   * When true, the content area fills the remaining viewport height (no scroll).
   * Used by full-height tabs like the Explorer.
   */
  fillContent?: boolean;
}>();

const emit = defineEmits<{
  "update:activeSubTab": [value: string];
  /** Emits when session running state changes */
  "update:isActive": [value: boolean];
}>();

const prefs = usePreferencesStore();
const resolvedSessionId = computed(() => props.store.detail?.id ?? props.sessionId);

const isSessionActive = ref(false);
/** What the running process is doing, for sources that record it. */
const runStatus = ref<RunStatus | null>(null);
const sdk = useSdkStore();
const { source, capabilities } = useSessionSource(
  () => props.sessionId,
  () => props.store.detail,
);
const sourceName = computed(() => sourceLabel(source.value));
provide(MAIN_AGENT_LABEL_KEY, sourceName);
provide(
  SESSION_LIVE_STATE_KEY,
  computed(() => ({ running: isSessionActive.value, status: runStatus.value })),
);
// Every tool-detail surface (including compact, waterfall and swimlanes) can
// display partial output for persisted in-flight calls in this session.
provide(
  LIVE_TOOL_PARTIAL_OUTPUT_KEY,
  computed(() => {
    const output = new Map<string, string>();
    for (const tool of sdk.sessionStatesById[props.sessionId]?.tools ?? []) {
      if (!tool.toolCallId || tool.partialResult == null) continue;
      const text = normalizeToolPartialOutput(tool.partialResult);
      if (text) output.set(tool.toolCallId, text);
    }
    return output;
  }),
);
useLivePersistedSync({
  sessionId: () => props.sessionId,
  refresh: () => props.store.refreshAll(),
  enabled: () => props.refreshEnabled ?? true,
});
/** Header badge: "Live" when TracePilot is attached or can attach (ADR-0016). */
const liveBadge = computed(() => {
  const sid = props.sessionId;
  const host = sid ? sdk.liveHostsById[sid] : undefined;
  if (sid && (sdk.isAttached(sid) || host?.attached)) {
    return { label: "Live", title: "TracePilot is streaming this session live" };
  }
  if (host?.state === "attachable") {
    return { label: "Live", title: "Running in a terminal TracePilot can stream live" };
  }
  return (
    runStatusBadge(runStatus.value, source.value) ?? {
      label: "Active",
      title: "Session is currently active",
    }
  );
});
/** Waiting for input reads apart from working; streaming wins over both. */
const isWaiting = computed(() => runStatus.value === "waiting" && liveBadge.value.label !== "Live");

// The backend locates the folder through the session's provider; sources keep
// their files in different places, so never rebuild it from a configured path.
const sessionFolder = computed(() => props.store.detail?.folder ?? null);

/**
 * The open session's files were removed (for example, a temporary session was
 * cleaned up). Auto-refresh pauses instead of failing every interval; a manual
 * refresh checks again and resumes it if the session reappears.
 */
const sessionMissing = ref(false);
/** The newest liveness check wins; a session switch drops any in flight. */
const runningGuard = useAsyncGuard();

async function checkRunning() {
  const token = runningGuard.start();
  if (!props.sessionId) {
    isSessionActive.value = false;
    runStatus.value = null;
    return;
  }
  try {
    const liveness = await getSessionLiveness(props.sessionId);
    if (!runningGuard.isValid(token)) return;
    isSessionActive.value = liveness.state === "running";
    runStatus.value = liveness.state === "running" ? liveness.status : null;
    sessionMissing.value = false;
    emit("update:isActive", isSessionActive.value);
  } catch (e) {
    if (!runningGuard.isValid(token)) return;
    isSessionActive.value = false;
    runStatus.value = null;
    if (isSessionNotFoundError(e)) {
      if (!sessionMissing.value) {
        logWarn("[sessionDetail] Session no longer exists; pausing auto-refresh:", e);
      }
      sessionMissing.value = true;
      return;
    }
    logError("[sessionDetail] Failed to check if session is running:", e);
  }
}

// Copilot sessions refresh from the live stream above; sources TracePilot
// cannot stream refresh on a timer while they run, and stop once idle.
const runningPollActive = computed(
  () =>
    isSessionActive.value &&
    isNonCopilotSource(source.value) &&
    (props.refreshEnabled ?? true) &&
    !sessionMissing.value,
);

/** Set by the Refresh button so its refresh reloads everything. */
let fullRefreshRequested = false;

/**
 * Auto-refresh skips an idle session's sections whose source is unchanged.
 * A running session reloads everything: Copilot keeps its plan and
 * checkpoints outside the source version, and writes them while it runs.
 */
function refreshSessionData() {
  const full = fullRefreshRequested || isSessionActive.value;
  fullRefreshRequested = false;
  return full ? props.store.refreshAll() : props.store.refreshIfSourceChanged();
}

// While the running poll owns refreshing, auto-refresh waits, so the two
// never both reload the session; it resumes once the session goes idle.
const { refreshing, refresh: refreshNow } = useAutoRefresh({
  onRefresh: async () => {
    await Promise.all([refreshSessionData(), checkRunning()]);
  },
  enabled: computed(
    () =>
      prefs.autoRefreshEnabled &&
      (props.refreshEnabled ?? true) &&
      !sessionMissing.value &&
      !runningPollActive.value,
  ),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

useRunningSessionPoll({
  active: () => runningPollActive.value,
  refresh: () => Promise.all([props.store.refreshIfSourceChanged(), checkRunning()]),
});

/** A manual refresh: reloads every loaded section. */
async function refresh() {
  if (refreshing.value) return;
  fullRefreshRequested = true;
  await refreshNow();
}

defineExpose({ isSessionActive, refresh });

const tabs = computed(() => mapSessionTabs(props.tabMode, capabilities.value, props.store.detail));

function onSubTabChange(tab: string) {
  emit("update:activeSubTab", tab);
}

// Start loading immediately (synchronously, before children mount).
// loadDetail is async internally but guards against redundant calls.
props.store.loadDetail(props.sessionId);

onMounted(async () => {
  await checkRunning();
});

// When the underlying session changes (e.g. tab switches that reuse the panel),
// re-load detail data and re-check running state.
watch(
  () => props.sessionId,
  (newId) => {
    isSessionActive.value = false;
    runStatus.value = null;
    sessionMissing.value = false;
    props.store.loadDetail(newId);
    checkRunning();
  },
);

const showPromptCache = computed(() => prefs.isFeatureEnabled("promptCacheInsights"));

// Registered after the detail watcher so the session id is already current.
watch(
  [() => props.sessionId, showPromptCache],
  ([, enabled]) => {
    if (enabled) void props.store.loadPromptCache();
  },
  { immediate: true },
);
</script>

<template>
  <PageShell class="session-detail-page" :class="{ 'explorer-mode': fillContent }">
    <!-- Loading state -->
    <div v-if="store.loading" style="padding-top: 8px;">
      <SkeletonLoader variant="text" :count="1" />
      <SkeletonLoader variant="badge" :count="3" />
    </div>

    <!-- Error state -->
    <ErrorAlert v-if="store.error" :message="store.error" />

    <!-- Session header + tabs + content -->
    <template v-if="store.detail">
      <SessionDetailHeader
        :detail="store.detail"
        :source="source"
        :source-name="sourceName"
        :active="isSessionActive"
        :waiting="isWaiting"
        :live-badge="liveBadge"
      />

      <SessionDetailActions
        :session-id="sessionId"
        :resolved-session-id="resolvedSessionId"
        :router="router"
        :source="source"
        :capabilities="capabilities"
        :folder="sessionFolder"
        :cwd="store.detail.cwd ?? null"
        :active="isSessionActive"
        :refreshing="refreshing"
        :show-prompt-cache="showPromptCache"
        :prompt-cache="store.promptCache"
        @refresh="refresh"
      />

      <!-- Inner tab nav -->
      <TabNav
        v-if="tabMode === 'local'"
        :tabs="tabs"
        :model-value="activeSubTab"
        @update:model-value="onSubTabChange"
      />
      <TabNav v-else :tabs="tabs" />

      <div class="detail-tab-content" data-testid="session-detail-content">
        <ErrorBoundary>
          <slot />
        </ErrorBoundary>
      </div>
    </template>
  </PageShell>
</template>

<style scoped>
/*
 * Short tabs (Todos, Explorer) and long ones keep one width, so the header
 * and tabs don't shift when switching between them. Scoped to session detail:
 * other pages don't switch like this and keep their full width.
 */
.session-detail-page {
  scrollbar-gutter: stable;
}

/*
 * The action bar's root: pinned under the breadcrumb as the page scrolls.
 * Intentional styling, keep it: `top: 0` pins the bar inside .page-content's
 * padding, so it floats below the breadcrumb with a gap rather than flush
 * against it, and the translucent blurred surface is part of that look (it
 * is on the backdrop-filter allow-list for this reason).
 */
.detail-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
  position: sticky;
  top: 0;
  z-index: 60;
  background: rgba(24, 24, 27, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  /* SessionDetailActions compacts its labels when the bar is narrow. */
  container: detail-actions / inline-size;
}

:root[data-theme="light"] .detail-actions {
  background: rgba(255, 255, 255, 0.75);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.05);
}
.detail-tab-content {
  padding-top: 4px;
}
</style>
