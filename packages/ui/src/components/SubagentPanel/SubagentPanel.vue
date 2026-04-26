<script setup lang="ts">
// Unified subagent detail body. The host owns the outer chrome (slide vs
// inline transition, scroll container, prev/next nav). Both the conversation
// slide-out and the agent-tree inline panel render this same body so they
// cannot drift.
import { computed, ref, watch } from "vue";
import { getAgentColor, getAgentIcon } from "../../utils/agentTypes";
import { formatDuration, formatLiveDuration } from "../../utils/formatters";
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
  }>(),
  {
    showHeader: true,
  },
);

const emit = defineEmits<{
  close: [];
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [toolCallId: string];
}>();

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

const promptExpanded = ref(true);
const outputExpanded = ref(true);

const descriptionText = computed(() => props.view.intentSummary || props.view.description || "");

watch(
  () => props.view.id,
  () => {
    promptExpanded.value = true;
    outputExpanded.value = true;
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
    @close="emit('close')"
  />

  <div class="sap-body">
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
    />
  </div>
</template>

<style scoped>
.sap-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.sap-section { margin: 0; }
.sap-section-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.sap-description { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; margin: 0; }
.sap-italic { font-style: italic; }
.sap-failure { background: var(--danger-subtle); border: 1px solid color-mix(in srgb, var(--danger-fg) 30%, transparent); border-radius: var(--radius-md); padding: 10px 12px; }
.sap-failure-title { color: var(--danger-fg); }
.sap-failure-body { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; color: var(--danger-fg); white-space: pre-wrap; word-break: break-word; margin: 0; }
</style>
