<script setup lang="ts">
import { getToolArgs, toolArgString } from "@tracepilot/types";
import {
  agentStatusFromToolCall,
  formatDuration,
  formatLiveDuration,
  getAgentColor,
  getAgentIcon,
  inferAgentTypeFromToolCall,
} from "@tracepilot/ui";
import { computed, nextTick, ref, watch } from "vue";
import SubagentActivityStream from "@/components/conversation/subagent/SubagentActivityStream.vue";
import SubagentCollapsibleBlock from "@/components/conversation/subagent/SubagentCollapsibleBlock.vue";
import SubagentModelWarning from "@/components/conversation/subagent/SubagentModelWarning.vue";
import SubagentPanelHeader from "@/components/conversation/subagent/SubagentPanelHeader.vue";
import SubagentPanelNav from "@/components/conversation/subagent/SubagentPanelNav.vue";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSubagentActivities } from "@/composables/useSubagentActivities";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();
const renderMd = computed(() => preferences.isFeatureEnabled("renderMarkdown"));

const store = useSessionDetailContext();
const {
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult: handleLoadFullResult,
  retryFullResult: handleRetryResult,
} = useToolResultLoader(() => store.sessionId);

const props = defineProps<{
  subagent: SubagentFullData | null;
  isOpen: boolean;
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  topOffset: number;
}>();

const emit = defineEmits<{
  close: [];
  prev: [];
  next: [];
}>();

const scrollContainer = ref<HTMLElement | null>(null);
const promptExpanded = ref(true);
const resultExpanded = ref(false);

// ── Derived agent metadata ───────────────────────────────────────

const agentType = computed(() =>
  props.subagent ? inferAgentTypeFromToolCall(props.subagent.toolCall) : "task",
);

const agentColor = computed(() => getAgentColor(agentType.value));
const agentIcon = computed(() => getAgentIcon(agentType.value));

const agentLabel = computed(() => {
  if (!props.subagent) return "Subagent";
  return props.subagent.toolCall.agentDisplayName || props.subagent.toolCall.toolName || "Subagent";
});

const status = computed(() =>
  props.subagent ? agentStatusFromToolCall(props.subagent.toolCall) : "completed",
);

const statusText = computed(() => {
  if (status.value === "completed") return "Completed";
  if (status.value === "failed") return "Failed";
  return "Running";
});

const headerDuration = computed(() => {
  const ms = props.subagent?.toolCall.durationMs;
  if (status.value === "in-progress") {
    if (!ms) return "";
    return formatLiveDuration(ms);
  }
  return formatDuration(ms ?? 0);
});

const model = computed(() => {
  if (!props.subagent) return "";
  const args = getToolArgs(props.subagent.toolCall);
  return props.subagent.toolCall.model || toolArgString(args, "model") || "";
});

const requestedModel = computed(() => props.subagent?.toolCall.requestedModel || "");

const modelMismatch = computed(() => {
  const tc = props.subagent?.toolCall;
  return !!tc?.isComplete && !!tc.model && !!tc.requestedModel && tc.model !== tc.requestedModel;
});

const description = computed(() => {
  if (!props.subagent) return "";
  const tc = props.subagent.toolCall;
  const args = getToolArgs(tc);
  return (
    tc.intentionSummary || toolArgString(args, "description") || toolArgString(args, "name") || ""
  );
});

const prompt = computed(() => {
  if (!props.subagent) return "";
  const args = getToolArgs(props.subagent.toolCall);
  return toolArgString(args, "prompt");
});

const resultContent = computed(() => {
  if (!props.subagent) return "";
  return props.subagent.toolCall.resultContent || "";
});

// ── Activity stream ──────────────────────────────────────────────

const subagentRef = computed(() => props.subagent);
const activities = useSubagentActivities(subagentRef);

const agentKey = computed(() => props.subagent?.agentId ?? "");

// ── State reset on subagent change ───────────────────────────────

watch(
  () => props.subagent?.agentId,
  () => {
    promptExpanded.value = true;
    resultExpanded.value = false;
    nextTick(() => {
      scrollContainer.value?.scrollTo({ top: 0 });
    });
  },
);
</script>

<template>
  <!-- Slide-out panel -->
  <Transition name="cv-panel">
    <div
      v-if="isOpen && subagent"
      class="cv-panel"
      :style="{ top: `${topOffset}px` }"
      role="dialog"
      aria-label="Subagent detail panel"
      @keydown.esc="emit('close')"
    >
      <!-- Header -->
      <SubagentPanelHeader
        :subagent="subagent"
        :agent-color="agentColor"
        :agent-icon="agentIcon"
        :agent-label="agentLabel"
        :model="model"
        :header-duration="headerDuration"
        :status="status"
        :status-text="statusText"
        @close="emit('close')"
      />

      <!-- Scrollable body -->
      <div ref="scrollContainer" class="cv-panel-scroll">
        <!-- Model mismatch warning banner -->
        <SubagentModelWarning
          v-if="modelMismatch"
          :requested-model="requestedModel"
          :model="model"
        />

        <!-- Description -->
        <div v-if="description" class="cv-panel-section">
          <div class="cv-panel-section-label">Description</div>
          <p class="cv-panel-description">{{ description }}</p>
        </div>

        <!-- Prompt (expanded by default, collapsible when long) -->
        <SubagentCollapsibleBlock
          v-if="prompt"
          label="Prompt"
          :content="prompt"
          :threshold="300"
          :expanded="promptExpanded"
          variant="prompt"
          :render-markdown="renderMd"
          @update:expanded="promptExpanded = $event"
        />

        <!-- Result / Output (shown before activity stream) -->
        <SubagentCollapsibleBlock
          v-if="resultContent"
          label="Output"
          :content="resultContent"
          :threshold="400"
          :expanded="resultExpanded"
          variant="output"
          :render-markdown="renderMd"
          @update:expanded="resultExpanded = $event"
        />

        <!-- Activity stream -->
        <SubagentActivityStream
          :activities="activities"
          :agent-key="agentKey"
          :render-markdown="renderMd"
          :full-results="fullResults"
          :loading-results="loadingResults"
          :failed-results="failedResults"
          @load-full-result="handleLoadFullResult"
          @retry-full-result="handleRetryResult"
        />
      </div>

      <!-- Navigation footer -->
      <SubagentPanelNav
        :current-index="currentIndex"
        :total-count="totalCount"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="emit('prev')"
        @next="emit('next')"
      />
    </div>
  </Transition>
</template>

<style scoped>
/* ── Panel slide transition ───────────────────────────────────── */

.cv-panel-enter-active,
.cv-panel-leave-active {
  transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
}
.cv-panel-enter-from,
.cv-panel-leave-to {
  transform: translateX(100%);
}

/* ── Panel container ──────────────────────────────────────────── */

.cv-panel {
  position: fixed;
  /* top is set dynamically via :style binding */
  right: 0;
  bottom: 0;
  width: 38%;
  min-width: 380px;
  max-width: 650px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--canvas-subtle);
  border-left: 1px solid var(--border-default);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
  outline: none;
}

@media (max-width: 959px) {
  .cv-panel {
    width: 100%;
    min-width: 0;
    max-width: none;
  }
}

/* ── Scrollable body ──────────────────────────────────────────── */

.cv-panel-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}

/* ── Description section (inline, small) ──────────────────────── */

.cv-panel-section {
  margin-bottom: 16px;
}

.cv-panel-section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.cv-panel-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}
</style>
