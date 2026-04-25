<script setup lang="ts">
// Dispatcher: renders either a chronological activity stream (display="stream",
// used by the conversation slide-out) or a sectioned report (display="sections",
// used by the agent-tree inline panel). The host owns the outer chrome
// (slide vs inline transition, scroll container, prev/next nav).
import { computed, ref, watch } from "vue";
import { getAgentColor, getAgentIcon } from "../../utils/agentTypes";
import { formatDuration, formatLiveDuration } from "../../utils/formatters";
import SubagentActivityStream from "./SubagentActivityStream.vue";
import SubagentCollapsibleBlock from "./SubagentCollapsibleBlock.vue";
import SubagentModelWarning from "./SubagentModelWarning.vue";
import SubagentPanelHeader from "./SubagentPanelHeader.vue";
import SubagentSectionsBody from "./SubagentSectionsBody.vue";
import type { SubagentPanelDisplay, SubagentView } from "./types";

const props = withDefaults(
  defineProps<{
    view: SubagentView;
    display: SubagentPanelDisplay;
    /** Live duration ms — supplied by host to drive ticking timers; falls back to view.durationMs. */
    liveDurationMs?: number;
    renderMarkdown: boolean;
    isRichRenderingEnabled?: (toolName: string) => boolean;
    fullResults: Map<string, string>;
    loadingResults: Set<string>;
    failedResults: Set<string>;
    /** When true (stream mode), the standard panel header is shown. Default true. */
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

// Local state — collapsibles in stream mode. Keyed by view.id so they reset on switch.
const promptExpanded = ref(true);
const resultExpanded = ref(false);

watch(
  () => props.view.id,
  () => {
    promptExpanded.value = true;
    resultExpanded.value = false;
  },
);
</script>

<template>
  <!-- Stream display: header + scrollable body with description / prompt / output / activity -->
  <template v-if="display === 'stream'">
    <SubagentPanelHeader
      v-if="showHeader"
      :view="view"
      :agent-color="agentColor"
      :agent-icon="agentIcon"
      :header-duration="headerDuration"
      :status-text="statusText"
      @close="emit('close')"
    />

    <div class="sap-stream-body">
      <SubagentModelWarning
        v-if="view.modelSubstituted && view.requestedModel && view.model"
        :requested-model="view.requestedModel"
        :model="view.model"
      />

      <div v-if="view.intentSummary || view.description" class="sap-section">
        <div class="sap-section-label">Description</div>
        <p class="sap-description">{{ view.intentSummary || view.description }}</p>
      </div>

      <SubagentCollapsibleBlock
        v-if="view.prompt"
        label="Prompt"
        :content="view.prompt"
        :threshold="300"
        :expanded="promptExpanded"
        variant="prompt"
        :render-markdown="renderMarkdown"
        @update:expanded="promptExpanded = $event"
      />

      <div v-if="view.status === 'failed' && view.error" class="sap-section sap-failure">
        <div class="sap-section-label sap-failure-title">❌ Failure Reason</div>
        <pre class="sap-failure-body">{{ view.error }}</pre>
      </div>

      <SubagentCollapsibleBlock
        v-if="view.resultContent"
        label="Output"
        :content="view.resultContent"
        :threshold="400"
        :expanded="resultExpanded"
        variant="output"
        :render-markdown="renderMarkdown"
        @update:expanded="resultExpanded = $event"
      />

      <SubagentActivityStream
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

  <!-- Sections display: header (optional) + sectioned report -->
  <template v-else>
    <SubagentPanelHeader
      v-if="showHeader"
      :view="view"
      :agent-color="agentColor"
      :agent-icon="agentIcon"
      :header-duration="headerDuration"
      :status-text="statusText"
      @close="emit('close')"
    />
    <SubagentSectionsBody
      :view="view"
      :live-duration-ms="liveDurationMs"
      :render-markdown="renderMarkdown"
      :is-rich-rendering-enabled="isRichRenderingEnabled"
      :full-results="fullResults"
      :loading-results="loadingResults"
      :failed-results="failedResults"
      @load-full-result="emit('load-full-result', $event)"
      @retry-full-result="emit('retry-full-result', $event)"
      @select-subagent="emit('select-subagent', $event)"
    />
  </template>
</template>

<style scoped>
.sap-stream-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.sap-section { margin: 0; }
.sap-section-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.sap-description { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; margin: 0; }
.sap-failure { background: var(--danger-subtle); border: 1px solid color-mix(in srgb, var(--danger-fg) 30%, transparent); border-radius: var(--radius-md); padding: 10px 12px; }
.sap-failure-title { color: var(--danger-fg); }
.sap-failure-body { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; color: var(--danger-fg); white-space: pre-wrap; word-break: break-word; margin: 0; }
</style>
