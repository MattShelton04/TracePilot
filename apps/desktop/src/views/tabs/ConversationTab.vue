<script setup lang="ts">
/**
 * ConversationTab — thin layout shell composing the conversation timeline.
 *
 * The compact and timeline templates live in {@link ConversationTurnList}.
 * The view-mode segmented control lives in {@link ConversationViewSwitcher}.
 * Deep-link scroll-to-turn / scroll-to-event behaviour lives in
 * {@link useConversationDeepLinkScroll}.
 *
 * Per the B2-D2 split: `useToolResultLoader` is instantiated *here* — its
 * in-memory cache must outlive any conditional re-mount of the turn list.
 */
import {
  EmptyState,
  ErrorAlert,
  formatDuration,
  getMainAgentObjective,
  ObjectiveBanner,
  StatCard,
  useConversationSections,
  useSessionTabLoader,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { type RouteLocationNormalizedLoaded, useRoute } from "vue-router";
import ChatViewMode from "@/components/conversation/ChatViewMode.vue";
import ConversationTurnList from "@/components/conversation/ConversationTurnList.vue";
import ConversationViewSwitcher, {
  type ConversationViewMode,
} from "@/components/conversation/ConversationViewSwitcher.vue";
import { useAutoScroll } from "@/composables/useAutoScroll";
import { useConversationDeepLinkScroll } from "@/composables/useConversationDeepLinkScroll";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";

const { isViewer } = useWindowRole();
// useRoute() returns undefined when no router is installed (child windows).
// We provide an empty-query stub to avoid property-access crashes.
const route: Pick<RouteLocationNormalizedLoaded, "query"> = isViewer() ? { query: {} } : useRoute();
const store = useSessionDetailContext();
const preferences = usePreferencesStore();
const expandedToolDetails = useToggleSet<string>();
const expandedReasoning = useToggleSet<string>();
const activeView = ref<ConversationViewMode>("chat");

// Chat view ref for deep-link delegation
const chatViewRef = ref<InstanceType<typeof ChatViewMode> | null>(null);

const {
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult: handleLoadFullResult,
  retryFullResult: handleRetryResult,
} = useToolResultLoader(() => store.sessionId);

// Shared derived data from turns
const { getSections, getArgsSummary, findToolCallIndex, totalToolCalls, totalDurationMs } =
  useConversationSections(() => store.turns);

// Auto-scroll — find this component's own .page-content ancestor (not a sibling tab's)
const scrollContainer = ref<HTMLElement | null>(null);
const conversationRoot = ref<HTMLElement | null>(null);
onMounted(() => {
  scrollContainer.value =
    (conversationRoot.value?.closest(".page-content") as HTMLElement | null) ??
    document.querySelector(".page-content");
});
const { isLockedToBottom, showScrollToTop, hasOverflow, scrollToBottom, scrollToTop } =
  useAutoScroll({
    containerRef: scrollContainer,
    watchSource: () => store.turnsVersion,
    viewModeSource: () => activeView.value,
  });

function handleChatSteeringMessage() {
  nextTick(() => scrollToBottom(false));
}

// Deep-link scroll-to-turn (URL fragment / search navigation).
const { scrollToTurn } = useConversationDeepLinkScroll(conversationRoot);

// Watch for turns to load, then scroll to the target.
let lastScrolledKey: string | null = null;
watch(
  [() => store.turns.length, () => route.query.turn, () => route.query.event],
  ([len, turnParam, eventParam]) => {
    if (!turnParam || len === 0) return;
    const turnIndex = Number(turnParam);
    if (Number.isNaN(turnIndex)) return;
    const eventIndex = eventParam ? Number(eventParam) : null;
    const key = `${turnIndex}-${eventIndex}`;
    if (key === lastScrolledKey) return;
    if (!store.turns.some((t) => t.turnIndex === turnIndex)) return;
    lastScrolledKey = key;

    nextTick(() => {
      // For chat view, delegate to ChatViewMode's revealEvent
      if (activeView.value === "chat" && chatViewRef.value) {
        chatViewRef.value.revealEvent(turnIndex, eventIndex ?? undefined);
        return;
      }

      // Compact/Timeline: use original expand logic
      if (eventIndex != null) {
        const turn = store.turns.find((t) => t.turnIndex === turnIndex);
        if (turn) {
          const tc = turn.toolCalls.find((t) => t.eventIndex === eventIndex);
          if (tc) {
            const idx = findToolCallIndex(turn, tc);
            const prefix = activeView.value === "timeline" ? "tl-" : "compact-";
            const detailKey = `${prefix}${turnIndex}-${idx}`;
            if (!expandedToolDetails.has(detailKey)) expandedToolDetails.toggle(detailKey);
          }
        }
      }
      nextTick(() => scrollToTurn(turnIndex, eventIndex));
    });
  },
  { immediate: true },
);

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadTurns(),
  {
    onClear() {
      expandedToolDetails.clear();
      expandedReasoning.clear();
      lastScrolledKey = null;
    },
  },
);

function retryLoadTurns() {
  store.loaded.delete("turns");
  store.loadTurns();
}

// ── Persistent objective banner ─────────────────────────────────────────
// Latest report_intent across the main agent's tool calls, regardless of
// turn — gives the user a stable "what is the agent currently aiming at?"
// indicator that complements the inline pill rendering inside the chat.

const sessionObjective = computed(() => getMainAgentObjective(store.turns));

const sessionObjectiveStatus = computed<"running" | "completed" | "idle">(() => {
  if (store.detail?.shutdownMetrics) return "completed";
  if (store.turns.length === 0) return "idle";
  return "running";
});

function revealObjective(info: { eventIndex?: number; toolCallId?: string }) {
  // Find the owning turn and reveal via the active view.
  const turn = store.turns.find((t) =>
    t.toolCalls.some(
      (tc) =>
        (info.eventIndex != null && tc.eventIndex === info.eventIndex) ||
        (info.toolCallId != null && tc.toolCallId === info.toolCallId),
    ),
  );
  if (!turn) return;
  if (activeView.value === "chat" && chatViewRef.value) {
    chatViewRef.value.revealEvent(turn.turnIndex, info.eventIndex);
    return;
  }
  scrollToTurn(turn.turnIndex, info.eventIndex ?? null);
}

function richEnabledFor(toolName: string): boolean {
  return preferences.isRichRenderingEnabled(toolName);
}
</script>

<template>
  <div ref="conversationRoot">
    <!-- Error alert for failed turn loading -->
    <ErrorAlert
      v-if="store.turnsError"
      :message="store.turnsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadTurns"
    />

    <!-- Mini stat row -->
    <div class="grid-3 mb-4">
      <StatCard :value="store.turns.length" label="Turns" color="accent" mini />
      <StatCard :value="totalToolCalls" label="Tool Calls" color="accent" mini />
      <StatCard :value="formatDuration(totalDurationMs)" label="Total Time" color="done" mini />
    </div>

    <!-- View mode toggle -->
    <ConversationViewSwitcher v-model="activeView" />

    <EmptyState v-if="store.turns.length === 0 && !store.turnsError" message="No conversation turns found." />

    <!-- ═══════════════ CHAT VIEW ═══════════════ -->
    <ChatViewMode
      v-else-if="activeView === 'chat'"
      ref="chatViewRef"
      :objective="sessionObjective"
      :objective-status="sessionObjectiveStatus"
      @message-sent="handleChatSteeringMessage"
      @reveal-objective="revealObjective"
    />

    <!-- ═══════════════ COMPACT / TIMELINE VIEWS ═══════════════ -->
    <ConversationTurnList
      v-else
      :turns="store.turns"
      :view-mode="activeView"
      :get-sections="getSections"
      :get-args-summary="getArgsSummary"
      :find-tool-call-index="findToolCallIndex"
      :expanded-tool-details="expandedToolDetails"
      :expanded-reasoning="expandedReasoning"
      :full-results="fullResults"
      :loading-results="loadingResults"
      :failed-results="failedResults"
      :rich-enabled-for="richEnabledFor"
      @load-full-result="handleLoadFullResult"
      @retry-full-result="handleRetryResult"
    />

    <ObjectiveBanner
      v-if="activeView !== 'chat' && sessionObjective"
      class="conv-objective-strip"
      scope="session"
      :objective="sessionObjective"
      :status="sessionObjectiveStatus"
      @reveal="revealObjective"
    />

    <!-- Floating scroll buttons -->
    <Transition name="fab">
      <div v-if="hasOverflow && (!isLockedToBottom || showScrollToTop)" class="scroll-fab-group">
        <button
          v-if="showScrollToTop"
          class="scroll-fab"
          aria-label="Scroll to top"
          title="Jump to top"
          @click="scrollToTop()"
        >
          ↑
        </button>
        <button
          v-if="!isLockedToBottom"
          class="scroll-fab scroll-fab--primary"
          aria-label="Scroll to bottom"
          title="Jump to bottom"
          @click="scrollToBottom()"
        >
          ↓
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.conv-objective-strip {
  position: sticky;
  bottom: 12px;
  z-index: 8;
  margin: 12px auto 0;
}

/* Floating scroll buttons */
.scroll-fab-group {
  position: fixed;
  bottom: 28px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: var(--z-fab, 55);
}

.scroll-fab {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-default);
  background: var(--canvas-overlay);
  color: var(--text-secondary);
  font-size: 1.125rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
}

.scroll-fab:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-accent);
}

.scroll-fab:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.scroll-fab--primary {
  background: var(--accent-emphasis);
  color: white;
  border-color: transparent;
}

.scroll-fab--primary:hover {
  opacity: 0.9;
  box-shadow: var(--shadow-glow-accent);
}

/* FAB group transition */
.fab-enter-active,
.fab-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(8px);
}
</style>
