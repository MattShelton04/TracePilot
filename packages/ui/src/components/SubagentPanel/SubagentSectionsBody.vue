<script setup lang="ts">
// Sections body — agent-tree style sectioned layout. Description / Source /
// Prompt / Failure / Output prefix the activity stream, which carries
// tool calls + reasoning interleaved chronologically (by event index when
// available, falling back to positional order). The activity stream no
// longer renders final messages — those go in the Output section above.
import { computed } from "vue";
import MarkdownContent from "../MarkdownContent.vue";
import SubagentActivityStream from "./SubagentActivityStream.vue";
import type { SubagentView } from "./types";

const props = defineProps<{
  view: SubagentView;
  /** Live duration ms for in-progress nodes (host computes; falls back to view.durationMs). */
  liveDurationMs?: number;
  renderMarkdown: boolean;
  isRichRenderingEnabled?: (toolName: string) => boolean;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [toolCallId: string];
}>();

// Prefer the joined child messages (full content) over the parent tool's
// often-truncated `resultContent`. Falls back to `resultContent` for older
// sessions where messages are unavailable.
const outputContent = computed(() => {
  const joined = props.view.messages.filter((m) => m && m.trim().length > 0).join("\n\n");
  if (joined) return joined;
  return props.view.resultContent ?? "";
});
</script>

<template>
  <div class="sap-sections">
    <!-- Description -->
    <div v-if="view.description" class="sap-section">
      <div class="sap-section-label">Description</div>
      <p class="sap-description">{{ view.description }}</p>
    </div>

    <!-- Cross-turn source -->
    <div v-if="view.isCrossTurnParent && view.sourceTurnIndex != null" class="sap-section">
      <div class="sap-section-label">Source</div>
      <p class="sap-description sap-italic">Launched in turn {{ view.sourceTurnIndex }}</p>
    </div>

    <!-- Prompt -->
    <div v-if="view.prompt" class="sap-section">
      <div class="sap-section-label">Prompt</div>
      <MarkdownContent :content="view.prompt" :render="renderMarkdown" max-height="200px" />
    </div>

    <!-- Failure -->
    <div v-if="view.status === 'failed' && view.error" class="sap-section sap-failure detail-failure">
      <div class="sap-section-label sap-failure-title">❌ Failure Reason</div>
      <pre class="sap-failure-body detail-failure-body">{{ view.error }}</pre>
    </div>

    <!-- Output (final messages joined; rendered above the activity stream) -->
    <div v-if="outputContent" class="sap-section">
      <div class="sap-section-label">Output</div>
      <div class="sap-output">
        <MarkdownContent :content="outputContent" :render="renderMarkdown" />
      </div>
    </div>

    <!-- Activity (tool calls interleaved with reasoning, ordered by event index) -->
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
.sap-sections { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.sap-section { padding: 0; margin: 0; }
.sap-section-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.sap-description { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; margin: 0; }
.sap-italic { font-style: italic; }

.sap-failure { background: var(--danger-subtle); border: 1px solid color-mix(in srgb, var(--danger-fg) 30%, transparent); border-radius: var(--radius-md); padding: 10px 12px; }
.sap-failure-title { color: var(--danger-fg); }
.sap-failure-body { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; color: var(--danger-fg); white-space: pre-wrap; word-break: break-word; margin: 0; }
.sap-output { font-size: 0.8125rem; color: var(--text-primary); line-height: 1.55; padding: 10px 12px; background: var(--canvas-inset); border: 1px solid var(--border-muted); border-radius: var(--radius-md); }
.sap-output :deep(.markdown-content) { font-size: inherit; line-height: inherit; }
</style>