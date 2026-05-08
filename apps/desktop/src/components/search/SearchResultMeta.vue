<script setup lang="ts">
/**
 * SearchResultMeta — meta info row for a single search hit (the
 * "session-summary · turn · kind · tool · timeline" line shown beneath
 * the snippet in SearchResultCard).
 *
 * Stays purely presentational: emits no events; the parent owns the
 * surrounding click/hover behaviour.
 */
import type { SearchResult } from "@tracepilot/types";
import { computed } from "vue";

const props = defineProps<{
  result: SearchResult;
  /**
   * Total number of events in the session — when supplied, a
   * miniature "timeline position" sparkline is rendered.
   */
  sessionEventCount?: number;
}>();

const timelinePosition = computed(() => {
  if (props.result.eventIndex == null || !props.sessionEventCount || props.sessionEventCount < 2)
    return null;
  return Math.min(1, Math.max(0, props.result.eventIndex / props.sessionEventCount));
});

const truncatedSummary = computed(() => {
  const s = props.result.sessionSummary;
  if (!s) return null;
  return s.length > 50 ? `${s.slice(0, 50)}…` : s;
});
</script>

<template>
  <div class="result-meta">
    <span
      v-if="result.sessionSummary"
      class="result-session-summary"
      :title="result.sessionSummary"
    >
      {{ truncatedSummary }}
    </span>
    <span v-if="result.sessionSummary" class="result-meta-sep">·</span>
    <span v-if="result.turnNumber != null">Turn {{ result.turnNumber }}</span>
    <span v-if="result.turnNumber != null" class="result-meta-sep">·</span>
    <span>{{ result.contentType.replace(/_/g, " ") }}</span>
    <template v-if="result.toolName">
      <span class="result-meta-sep">·</span>
      <span class="tool-name-badge">{{ result.toolName }}</span>
    </template>
    <span
      v-if="timelinePosition != null"
      class="timeline-spark"
      :title="`${Math.round(timelinePosition * 100)}% through session`"
    >
      <span class="timeline-spark-track">
        <span class="timeline-spark-dot" :style="{ left: `${timelinePosition * 100}%` }" />
      </span>
    </span>
    <slot name="trailing" />
  </div>
</template>

<style scoped>
.result-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.result-meta-sep {
  opacity: 0.3;
}
.result-session-summary {
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.tool-name-badge {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.625rem;
  background: var(--neutral-subtle);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.timeline-spark {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
}
.timeline-spark-track {
  position: relative;
  width: 40px;
  height: 4px;
  background: var(--neutral-subtle);
  border-radius: 2px;
}
.timeline-spark-dot {
  position: absolute;
  top: -1px;
  width: 6px;
  height: 6px;
  background: var(--accent-fg);
  border-radius: 50%;
  transform: translateX(-50%);
  transition: left var(--transition-fast);
}
</style>
