<script setup lang="ts">
// Unified subagent detail body. The host owns the outer chrome (slide vs
// inline transition, scroll container, prev/next nav). Both the conversation
// slide-out and the agent-tree inline panel render this same body so they
// cannot drift.
import { computed, nextTick, ref, useSlots, watch } from "vue";
import { getAgentColor, getAgentIcon } from "../../utils/agentTypes";
import { formatDuration, formatLiveDuration } from "../../utils/formatters";
import { getSubagentObjective } from "../../utils/objective";
import ObjectiveBanner from "../ObjectiveBanner.vue";
import SubagentActivityStream from "./SubagentActivityStream.vue";
import SubagentCollapsibleBlock from "./SubagentCollapsibleBlock.vue";
import SubagentModelWarning from "./SubagentModelWarning.vue";
import SubagentPanelHeader from "./SubagentPanelHeader.vue";
import type { SubagentView } from "./types";

const props = withDefaults(
  defineProps<{
    view: SubagentView;
    /** Live duration ms — supplied by host to drive ticking timers; falls back to view.durationMs. */
    liveDurationMs?: number;
    renderMarkdown: boolean;
    isRichRenderingEnabled?: (toolName: string) => boolean;
    fullResults: Map<string, string>;
    loadingResults: Set<string>;
    failedResults: Set<string>;
    /** When false, the host renders its own header. Default true. */
    showHeader?: boolean;
    /** When true, applies `position: sticky` to the header so it pins to the
     *  top of the nearest scrolling ancestor. Only set this when the host
     *  wraps the panel in its own scroll container (e.g. the conversation
     *  slide-out). Default false to preserve agent-tree inline behavior. */
    stickyHeader?: boolean;
  }>(),
  {
    showHeader: true,
    stickyHeader: false,
  },
);

const emit = defineEmits<{
  close: [];
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [toolCallId: string];
}>();

const slots = useSlots();
const agentColor = computed(() => getAgentColor(props.view.type));
const agentIcon = computed(() => getAgentIcon(props.view.type));

const status = computed(() => props.view.status);
const statusText = computed(() => {
  if (status.value === "completed") return "Completed";
  if (status.value === "failed") return "Failed";
  return "Running";
});

const headerDuration = computed(() => {
  const ms = props.liveDurationMs ?? props.view.durationMs;
  if (status.value === "in-progress") return ms ? formatLiveDuration(ms) : "";
  return formatDuration(ms ?? 0);
});

const promptExpanded = ref(false);
const outputExpanded = ref(false);
const bodyEl = ref<HTMLElement | null>(null);

const descriptionText = computed(() => props.view.intentSummary || props.view.description || "");

const currentObjective = computed(() => getSubagentObjective(props.view.activities));

const objectiveStatus = computed<"running" | "completed" | "failed" | "idle">(() => {
  switch (status.value) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return currentObjective.value ? "running" : "idle";
  }
});

function revealObjective(info: { eventIndex?: number; toolCallId?: string }) {
  const root = bodyEl.value;
  if (!root) return;

  const selector =
    info.eventIndex != null
      ? `[data-sap-event-idx="${info.eventIndex}"]`
      : info.toolCallId
        ? `[data-sap-tool-call-id="${CSS.escape(info.toolCallId)}"]`
        : null;
  if (!selector) return;

  const target = root.querySelector<HTMLElement>(selector);
  if (!target) return;

  nextTick(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("sap-reveal-highlight");
    window.setTimeout(() => target.classList.remove("sap-reveal-highlight"), 1800);
  });
}

watch(
  () => props.view.id,
  () => {
    promptExpanded.value = false;
    outputExpanded.value = false;
  },
);
</script>

<template>
  <SubagentPanelHeader
    v-if="showHeader"
    :view="view"
    :agent-color="agentColor"
    :agent-icon="agentIcon"
    :header-duration="headerDuration"
    :status-text="statusText"
    :class="{ 'sap-header-sticky': stickyHeader }"
    @close="emit('close')"
  />

  <div ref="bodyEl" class="sap-body">
    <SubagentModelWarning
      v-if="view.modelSubstituted && view.requestedModel && view.model"
      :requested-model="view.requestedModel"
      :model="view.model"
    />

    <div v-if="descriptionText" class="sap-section">
      <div class="sap-section-label">Description</div>
      <p class="sap-description">{{ descriptionText }}</p>
    </div>

    <div v-if="view.isCrossTurnParent && view.sourceTurnIndex != null" class="sap-section">
      <div class="sap-section-label">Source</div>
      <p class="sap-description sap-italic">Launched in turn {{ view.sourceTurnIndex }}</p>
    </div>

    <SubagentCollapsibleBlock
      v-if="view.prompt"
      label="Prompt"
      :content="view.prompt"
      :threshold="300"
      :expanded="promptExpanded"
      :render-markdown="renderMarkdown"
      @update:expanded="promptExpanded = $event"
    />

    <div v-if="view.status === 'failed' && view.error" class="sap-section sap-failure">
      <div class="sap-section-label sap-failure-title">❌ Failure Reason</div>
      <pre class="sap-failure-body">{{ view.error }}</pre>
    </div>

    <SubagentCollapsibleBlock
      v-if="view.output"
      label="Output"
      :content="view.output"
      :threshold="600"
      :expanded="outputExpanded"
      :render-markdown="renderMarkdown"
      @update:expanded="outputExpanded = $event"
    />

    <SubagentActivityStream
      v-if="view.activities.length > 0"
      :activities="view.activities"
      :agent-key="view.id"
      :render-markdown="renderMarkdown"
      :full-results="fullResults"
      :loading-results="loadingResults"
      :failed-results="failedResults"
      :is-rich-rendering-enabled="isRichRenderingEnabled"
      @load-full-result="emit('load-full-result', $event)"
      @retry-full-result="emit('retry-full-result', $event)"
      @select-subagent="emit('select-subagent', $event)"
    >
      <template v-if="slots.tool" #tool="slotProps">
        <slot name="tool" v-bind="slotProps" />
      </template>
    </SubagentActivityStream>

    <ObjectiveBanner
      v-if="currentObjective"
      class="sap-objective sap-objective-footer"
      scope="subagent"
      :objective="currentObjective"
      :status="objectiveStatus"
      :accent-color="agentColor"
      @reveal="revealObjective"
    />
  </div>
</template>

<style scoped>
.sap-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.sap-objective {
  align-self: center;
  margin-bottom: 2px;
}
.sap-objective-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin-top: 4px;
}
:deep(.sap-reveal-highlight) {
  animation: sapRevealFlash 1.8s ease-out;
}
@keyframes sapRevealFlash {
  0%,
  45% {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-emphasis, #58a6ff) 65%, transparent);
    background: color-mix(in srgb, var(--accent-emphasis, #58a6ff) 14%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
.sap-section { margin: 0; }
.sap-section-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.sap-description { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; margin: 0; }
.sap-italic { font-style: italic; }
.sap-failure { background: var(--danger-subtle); border: 1px solid color-mix(in srgb, var(--danger-fg) 30%, transparent); border-radius: var(--radius-md); padding: 10px 12px; }
.sap-failure-title { color: var(--danger-fg); }
.sap-failure-body { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; color: var(--danger-fg); white-space: pre-wrap; word-break: break-word; margin: 0; }
</style>
