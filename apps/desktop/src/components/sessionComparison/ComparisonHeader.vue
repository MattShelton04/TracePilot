<script setup lang="ts">
import {
  isNonCopilotSource,
  modelDisplayName,
  type SessionSource,
  sourceLabel,
} from "@tracepilot/types";
import { Badge, EmptyState, ErrorAlert, formatDuration, SkeletonLoader } from "@tracepilot/ui";
import { computed } from "vue";
import SessionPicker from "@/components/SessionPicker.vue";
import {
  exitBadgeVariant,
  exitLabel,
  sessionLabel,
  useSessionComparisonContext,
} from "@/composables/useSessionComparison";
import { sessionDurationMs } from "@/composables/useSessionMetrics";
import { DURATION_HINTS } from "@/utils/sessionDurations";
import { sessionModel } from "@/utils/sessionModel";

const comp = useSessionComparisonContext();

const sourceA = computed(() => comp.dataA.detail?.source);
const sourceB = computed(() => comp.dataB.detail?.source);
// Each side names its source once a non-Copilot session is involved, so a
// Copilot-only comparison looks as it always has.
const showSources = computed(
  () => isNonCopilotSource(sourceA.value) || isNonCopilotSource(sourceB.value),
);

function sourceVariant(source: SessionSource | undefined): "claude" | "neutral" {
  return isNonCopilotSource(source) ? "claude" : "neutral";
}
</script>

<template>
  <!-- Page Title -->
  <div class="mb-4">
    <h1 class="page-title">Compare Sessions</h1>
    <p class="page-subtitle">Rich side-by-side session analysis with metric deltas and visual comparisons</p>
  </div>

  <!-- Session Selector -->
  <div class="selector-row">
    <SessionPicker
      class="comp-picker"
      :sessions="comp.sessionOptions"
      :selected-id="comp.selectedA"
      :disabled="comp.loading"
      label="Session A"
      placeholder="Search for session A…"
      @select="comp.selectedA = $event"
    />
    <span class="vs-label">vs</span>
    <SessionPicker
      class="comp-picker"
      :sessions="comp.sessionOptions"
      :selected-id="comp.selectedB"
      :disabled="comp.loading"
      label="Session B"
      placeholder="Search for session B…"
      @select="comp.selectedB = $event"
    />
    <button
      class="compare-btn"
      type="button"
      :disabled="!comp.canCompare"
      @click="comp.runComparison"
    >
      Compare
    </button>
  </div>

  <!-- Error -->
  <ErrorAlert v-if="comp.error" :message="comp.error" />

  <!-- Loading -->
  <div v-if="comp.loading" class="loading-area">
    <SkeletonLoader variant="card" :count="2" />
    <SkeletonLoader variant="text" :count="9" />
  </div>

  <!-- Empty state -->
  <EmptyState
    v-else-if="!comp.compared"
    title="Select Two Sessions"
    description="Pick two sessions above and click Compare to see a side-by-side analysis."
  >
    <template #icon>⚖️</template>
  </EmptyState>

  <!-- Summary Cards -->
  <div v-else class="summary-pair">
    <div class="summary-card session-a">
      <div class="summary-label">Session A</div>
      <div class="session-name">{{ sessionLabel(comp.dataA.detail) }}</div>
      <div class="summary-meta">
        <Badge v-if="showSources" :variant="sourceVariant(sourceA)" title="Session source">{{ sourceLabel(sourceA) }}</Badge>
        <Badge v-if="comp.dataA.detail?.repository" variant="accent">{{ comp.dataA.detail.repository }}</Badge>
        <Badge v-if="sessionModel(comp.dataA.detail)" variant="accent" :title="sessionModel(comp.dataA.detail)!">{{ modelDisplayName(sessionModel(comp.dataA.detail)!, sourceA) }}</Badge>
        <Badge v-if="exitLabel(comp.dataA.metrics, sourceA)" :variant="exitBadgeVariant(comp.dataA.metrics)">{{ exitLabel(comp.dataA.metrics, sourceA) }}</Badge>
        <Badge variant="neutral" :title="`Session span. ${DURATION_HINTS.sessionSpan}`">{{ formatDuration(sessionDurationMs(comp.dataA.detail)) || '—' }}</Badge>
        <Badge variant="neutral">{{ comp.dataA.turns.length }} turns</Badge>
        <Badge variant="neutral">{{ comp.dataA.detail?.eventCount ?? 0 }} events</Badge>
      </div>
    </div>
    <div class="summary-card session-b">
      <div class="summary-label">Session B</div>
      <div class="session-name">{{ sessionLabel(comp.dataB.detail) }}</div>
      <div class="summary-meta">
        <Badge v-if="showSources" :variant="sourceVariant(sourceB)" title="Session source">{{ sourceLabel(sourceB) }}</Badge>
        <Badge v-if="comp.dataB.detail?.repository" variant="accent">{{ comp.dataB.detail.repository }}</Badge>
        <Badge v-if="sessionModel(comp.dataB.detail)" variant="accent" :title="sessionModel(comp.dataB.detail)!">{{ modelDisplayName(sessionModel(comp.dataB.detail)!, sourceB) }}</Badge>
        <Badge v-if="exitLabel(comp.dataB.metrics, sourceB)" :variant="exitBadgeVariant(comp.dataB.metrics)">{{ exitLabel(comp.dataB.metrics, sourceB) }}</Badge>
        <Badge variant="neutral" :title="`Session span. ${DURATION_HINTS.sessionSpan}`">{{ formatDuration(sessionDurationMs(comp.dataB.detail)) || '—' }}</Badge>
        <Badge variant="neutral">{{ comp.dataB.turns.length }} turns</Badge>
        <Badge variant="neutral">{{ comp.dataB.detail?.eventCount ?? 0 }} events</Badge>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comp-picker {
  flex: 0 1 340px;
  min-width: 200px;
  max-width: 340px;
}

@media (max-width: 768px) {
  .comp-picker {
    width: 100%;
    max-width: none;
  }
}
</style>
