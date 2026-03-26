<script setup lang="ts">
/**
 * SessionReplayView — step-by-step replay of a Copilot session.
 *
 * Uses real session data from useSessionDetailStore, transforms ConversationTurns
 * into ReplaySteps, and renders them with rich content (markdown, tool call
 * renderers, agent grouping, reasoning blocks).
 */

import { Badge, EmptyState, ErrorAlert, SessionCard, SkeletonLoader } from '@tracepilot/ui';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ModelSwitchBanner from '@/components/replay/ModelSwitchBanner.vue';
import ReplayEventTicker from '@/components/replay/ReplayEventTicker.vue';
import ReplaySidebar from '@/components/replay/ReplaySidebar.vue';
import ReplayStepContent from '@/components/replay/ReplayStepContent.vue';
import ReplayTransportBar from '@/components/replay/ReplayTransportBar.vue';
import { useReplayController } from '@/composables/useReplayController';
import { useToolResultLoader } from '@/composables/useToolResultLoader';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionDetailStore } from '@/stores/sessionDetail';
import { useSessionsStore } from '@/stores/sessions';
import { turnsToReplaySteps } from '@/utils/replayTransform';

const route = useRoute();
const router = useRouter();
const store = useSessionDetailStore();
const sessionsStore = useSessionsStore();
const preferences = usePreferencesStore();

// Session ID from route
const sessionId = computed(() => route.params.id as string | undefined);

// Recent sessions for empty-state picker (sorted by update, capped at 12)
const recentSessions = computed(() => {
  const all = [...sessionsStore.sessions]
    .filter((s) => (s.turnCount ?? 0) > 0)
    .sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });
  return all.slice(0, 12);
});

function openReplay(id: string) {
  router.push({ name: 'replay', params: { id } });
}

// Tool result lazy loader
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } =
  useToolResultLoader(() => store.sessionId);

// Transform turns into replay steps
const replaySteps = computed(() => turnsToReplaySteps(store.turns));

// O(1) turn lookup by turnIndex (avoids O(N²) .find() in template loop)
const turnsByIndex = computed(() => new Map(store.turns.map((t) => [t.turnIndex, t])));

// Playback controller
const controller = useReplayController(replaySteps, {
  proportionalTiming: false,
  fixedIntervalMs: 1500,
  maxStepDelayMs: 3000,
});

// Current source turn for the active step (sidebar display)

// Collect all events up to current step for the ticker
const tickerEvents = computed(() => {
  const events: Array<{ type: string; label: string; timestamp?: string }> = [];
  for (let i = 0; i <= controller.currentStep.value && i < replaySteps.value.length; i++) {
    const step = replaySteps.value[i];
    if (step.sessionEvents) {
      for (const se of step.sessionEvents) {
        events.push({
          type: se.severity ?? 'info',
          label: `${se.eventType.replace('session.', '')}: ${se.summary}`,
          timestamp: se.timestamp,
        });
      }
    }
  }
  return events;
});

// Auto-scroll conversation to current step
const conversationRef = ref<HTMLElement | null>(null);
watch(
  () => controller.currentStep.value,
  async () => {
    await nextTick();
    if (!conversationRef.value) return;
    const stepEl = conversationRef.value.querySelector(
      `[data-step="${controller.currentStep.value}"]`,
    );
    if (stepEl) {
      stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },
);

// Keyboard shortcut handler (delegated to controller)
function handleKeydown(e: KeyboardEvent) {
  // Don't capture when user is in an input/textarea
  if (
    (e.target as HTMLElement)?.tagName === 'INPUT' ||
    (e.target as HTMLElement)?.tagName === 'TEXTAREA'
  )
    return;
  controller.handleKeydown(e);
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  // Load sessions list for empty-state picker (if not already loaded)
  if (sessionsStore.sessions.length === 0) {
    sessionsStore.fetchSessions();
  }
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

// Data loading with stale-request guard
const initialLoading = ref(false);
let loadToken = 0;

async function loadSession(id: string) {
  const token = ++loadToken;
  initialLoading.value = true;
  try {
    await store.loadDetail(id);
    if (token !== loadToken) return;
    await Promise.all([store.loadTurns(), store.loadTodos(), store.loadShutdownMetrics()]);
  } finally {
    if (token === loadToken) {
      initialLoading.value = false;
    }
  }
}

function retryLoadTurns() {
  store.loaded.delete('turns');
  store.loadTurns();
}

// Watch for route changes
watch(
  sessionId,
  (id) => {
    if (id) loadSession(id);
  },
  { immediate: true },
);

// Cap visible future skeletons
const MAX_FUTURE_SKELETONS = 5;
const visibleSteps = computed(() => {
  const current = controller.currentStep.value;
  return replaySteps.value.filter((s) => s.index <= current + MAX_FUTURE_SKELETONS);
});

// Summary stats
const totalToolCalls = computed(() =>
  replaySteps.value.reduce((s, st) => s + (st.richToolCalls?.length ?? 0), 0),
);
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">

      <!-- ═════════════ NO SESSION ID → RECENT SESSIONS PICKER ═════════════ -->
      <template v-if="!sessionId">
        <header class="replay-header">
          <div class="header-left">
            <h1>Session Replay</h1>
            <span class="header-subtitle">Step through any Copilot session operation by operation</span>
          </div>
        </header>

        <div class="picker-hint">
          <span class="hint-icon">💡</span>
          <span>You can also open replay from any session's detail page using the <strong>Replay</strong> button.</span>
        </div>

        <!-- Recent sessions grid -->
        <div v-if="sessionsStore.loading" class="loading-state">
          <SkeletonLoader :lines="4" />
        </div>
        <template v-else-if="recentSessions.length > 0">
          <h2 class="picker-section-title">Recent Sessions</h2>
          <div class="picker-grid">
            <SessionCard
              v-for="s in recentSessions"
              :key="s.id"
              :session="s"
              @select="openReplay"
            />
          </div>
        </template>
        <EmptyState
          v-else
          icon="📭"
          title="No sessions found"
          description="No indexed sessions with conversation data. Run a Copilot session first, then come back here."
        />
      </template>

      <!-- ═════════════ LOADING ═════════════ -->
      <template v-else-if="initialLoading">
        <header class="replay-header">
          <div class="header-left">
            <h1>Session Replay</h1>
          </div>
        </header>
        <div class="loading-state">
          <SkeletonLoader :lines="8" />
        </div>
      </template>

      <!-- ═════════════ ERROR ═════════════ -->
      <template v-else-if="store.error">
        <header class="replay-header">
          <div class="header-left">
            <h1>Session Replay</h1>
          </div>
        </header>
        <ErrorAlert :message="store.error" />
      </template>

      <!-- ═════════════ TURNS LOAD ERROR ═════════════ -->
      <template v-else-if="store.turnsError">
        <header class="replay-header">
          <div class="header-left">
            <h1>Session Replay</h1>
            <span class="header-subtitle">{{ store.detail?.id ?? sessionId }}</span>
          </div>
        </header>
        <ErrorAlert
          :message="store.turnsError"
          variant="inline"
          :retryable="true"
          class="mb-4"
          @retry="retryLoadTurns"
        />
      </template>

      <!-- ═════════════ NO TURNS ═════════════ -->
      <template v-else-if="replaySteps.length === 0">
        <header class="replay-header">
          <div class="header-left">
            <h1>Session Replay</h1>
            <span class="header-subtitle">{{ store.detail?.id }}</span>
          </div>
        </header>
        <EmptyState
          icon="📭"
          title="No conversation data"
          description="This session has no conversation turns to replay."
        />
      </template>

      <!-- ═════════════ MAIN REPLAY ═════════════ -->
      <template v-else>
        <!-- Header -->
        <header class="replay-header">
          <div class="header-left">
            <h1>Session Replay</h1>
            <div class="header-badges">
              <Badge v-if="store.detail?.repository" variant="accent">{{ store.detail.repository }}</Badge>
              <Badge v-if="store.detail?.branch" variant="success">{{ store.detail.branch }}</Badge>
              <Badge variant="neutral">{{ replaySteps.length }} turns</Badge>
              <Badge v-if="totalToolCalls" variant="warning">{{ totalToolCalls }} tool calls</Badge>
            </div>
          </div>
          <button class="back-btn" @click="router.push({ name: 'session-overview', params: { id: sessionId } })" title="Back to session detail">
            ← Detail
          </button>
        </header>

        <!-- Transport Bar -->
        <ReplayTransportBar
          :current-step="controller.currentStep.value"
          :total-steps="controller.totalSteps.value"
          :is-playing="controller.isPlaying.value"
          :speed="controller.speed.value"
          :elapsed-formatted="controller.formattedElapsed.value"
          :total-formatted="controller.formattedTotal.value"
          :scrubber-percent="controller.scrubberPercent.value"
          @play="controller.play()"
          @pause="controller.pause()"
          @next="controller.nextStep()"
          @prev="controller.prevStep()"
          @set-speed="controller.setSpeed($event)"
          @scrub-click="controller.onScrubberClick($event)"
        />

        <!-- Main Split Layout -->
        <div class="replay-layout">
          <!-- Left: Conversation Pane -->
          <div ref="conversationRef" class="replay-conversation">
            <template v-for="(step, idx) in visibleSteps" :key="step.index">
              <!-- Model switch banner -->
              <ModelSwitchBanner
                v-if="step.modelSwitchFrom && step.model"
                :previous-model="step.modelSwitchFrom"
                :new-model="step.model"
              />

              <!-- Step content -->
              <div :data-step="step.index">
                <ReplayStepContent
                  v-if="turnsByIndex.get(step.turnIndex)"
                  :step="step"
                  :turn="turnsByIndex.get(step.turnIndex)!"
                  :all-turns="store.turns"
                  :is-current="step.index === controller.currentStep.value"
                  :is-past="step.index < controller.currentStep.value"
                  :is-future="step.index > controller.currentStep.value"
                  :full-results="fullResults"
                  :loading-results="loadingResults"
                  :failed-results="failedResults"
                  :is-rich-enabled="preferences.isRichRenderingEnabled"
                  @load-full-result="loadFullResult($event)"
                  @retry-full-result="retryFullResult($event)"
                />

                <!-- Skeleton placeholder for far-future steps -->
                <div
                  v-if="step.index > controller.currentStep.value"
                  class="future-skeleton"
                  :style="{ opacity: Math.max(0.08, 0.3 - (step.index - controller.currentStep.value) * 0.05) }"
                />
              </div>
            </template>
          </div>

          <!-- Right: Sidebar -->
          <ReplaySidebar
            :step="controller.currentStepData.value"
            :steps="replaySteps"
            :current-step-index="controller.currentStep.value"
            :total-steps="controller.totalSteps.value"
            :detail="store.detail"
            :shutdown-metrics="store.shutdownMetrics"
            @go-to-step="controller.goToStep($event)"
          />
        </div>

        <!-- Event Ticker -->
        <ReplayEventTicker
          v-if="tickerEvents.length > 0"
          :steps="replaySteps"
          :current-step="controller.currentStep.value"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Header ────────────────────────────────────────────────── */
.replay-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}
.header-left { display: flex; flex-direction: column; gap: 6px; }
.replay-header h1 {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}
.header-subtitle {
  color: var(--text-tertiary);
  font-size: 0.8rem;
}
.header-badges { display: flex; gap: 6px; flex-wrap: wrap; }

.back-btn {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-overlay);
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 120ms;
  white-space: nowrap;
}
.back-btn:hover {
  border-color: var(--accent-fg);
  color: var(--text-primary);
}

/* ── Loading / Empty ───────────────────────────────────────── */
.loading-state { padding: 40px 0; }

/* ── Session Picker (empty state) ─────────────────────────── */
.picker-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 20px;
}
.hint-icon { font-size: 1rem; flex-shrink: 0; }
.picker-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin: 0 0 12px;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.picker-grid :deep(.card) {
  cursor: pointer;
}
.picker-grid :deep(.flex.flex-wrap) {
  gap: 4px;
  margin-bottom: 8px;
}
.picker-grid :deep(.flex.items-center.gap-3) {
  margin-top: 4px;
}

/* ── Layout ────────────────────────────────────────────────── */
.replay-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 20px;
  min-height: 0;
  margin-top: 12px;
}

@media (max-width: 900px) {
  .replay-layout {
    grid-template-columns: 1fr;
  }
}

/* ── Conversation Pane ─────────────────────────────────────── */
.replay-conversation {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  padding-right: 8px;
  scroll-behavior: smooth;
}
.replay-conversation::-webkit-scrollbar { width: 6px; }
.replay-conversation::-webkit-scrollbar-track { background: transparent; }
.replay-conversation::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }

/* ── Future skeleton placeholder ───────────────────────────── */
.future-skeleton {
  height: 60px;
  border-radius: var(--radius-md);
  background: linear-gradient(
    90deg,
    var(--canvas-subtle) 25%,
    var(--canvas-inset) 50%,
    var(--canvas-subtle) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 2s infinite;
  border: 1px solid var(--border-muted);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .future-skeleton { animation: none; }
}
</style>
