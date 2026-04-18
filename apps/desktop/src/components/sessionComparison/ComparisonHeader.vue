<script setup lang="ts">
import { Badge, EmptyState, ErrorAlert, formatDuration, SkeletonLoader } from "@tracepilot/ui";
import {
  exitBadgeVariant,
  exitLabel,
  sessionLabel,
  useSessionComparisonContext,
} from "@/composables/useSessionComparison";
import { sessionDurationMs } from "@/composables/useSessionMetrics";

const comp = useSessionComparisonContext();
</script>

<template>
  <!-- Page Title -->
  <div class="mb-4">
    <h1 class="page-title">Compare Sessions</h1>
    <p class="page-subtitle">Rich side-by-side session analysis with metric deltas and visual comparisons</p>
  </div>

  <!-- Session Selector -->
  <div class="selector-row">
    <select
      v-model="comp.selectedA"
      class="comp-select"
      :disabled="comp.loading"
      aria-label="Select Session A"
    >
      <option value="" disabled>Select Session A…</option>
      <option
        v-for="s in comp.sessionOptions"
        :key="s.id"
        :value="s.id"
      >
        {{ s.summary || s.id }}{{ s.repository ? ` — ${s.repository}` : '' }}
      </option>
    </select>
    <span class="vs-label">vs</span>
    <select
      v-model="comp.selectedB"
      class="comp-select"
      :disabled="comp.loading"
      aria-label="Select Session B"
    >
      <option value="" disabled>Select Session B…</option>
      <option
        v-for="s in comp.sessionOptions"
        :key="s.id"
        :value="s.id"
      >
        {{ s.summary || s.id }}{{ s.repository ? ` — ${s.repository}` : '' }}
      </option>
    </select>
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
    icon="⚖️"
    title="Select Two Sessions"
    message="Pick two sessions above and click Compare to see a side-by-side analysis."
  />

  <!-- Summary Cards -->
  <div v-else class="summary-pair">
    <div class="summary-card session-a">
      <div class="summary-label">Session A</div>
      <div class="session-name">{{ sessionLabel(comp.dataA.detail) }}</div>
      <div class="summary-meta">
        <Badge v-if="comp.dataA.detail?.repository" variant="accent">{{ comp.dataA.detail.repository }}</Badge>
        <Badge v-if="comp.dataA.metrics?.currentModel" variant="accent">{{ comp.dataA.metrics.currentModel }}</Badge>
        <Badge :variant="exitBadgeVariant(comp.dataA.metrics)">{{ exitLabel(comp.dataA.metrics) }}</Badge>
        <Badge variant="neutral">{{ formatDuration(sessionDurationMs(comp.dataA.detail)) || '—' }}</Badge>
        <Badge variant="neutral">{{ comp.dataA.turns.length }} turns</Badge>
        <Badge variant="neutral">{{ comp.dataA.detail?.eventCount ?? 0 }} events</Badge>
      </div>
    </div>
    <div class="summary-card session-b">
      <div class="summary-label">Session B</div>
      <div class="session-name">{{ sessionLabel(comp.dataB.detail) }}</div>
      <div class="summary-meta">
        <Badge v-if="comp.dataB.detail?.repository" variant="accent">{{ comp.dataB.detail.repository }}</Badge>
        <Badge v-if="comp.dataB.metrics?.currentModel" variant="accent">{{ comp.dataB.metrics.currentModel }}</Badge>
        <Badge :variant="exitBadgeVariant(comp.dataB.metrics)">{{ exitLabel(comp.dataB.metrics) }}</Badge>
        <Badge variant="neutral">{{ formatDuration(sessionDurationMs(comp.dataB.detail)) || '—' }}</Badge>
        <Badge variant="neutral">{{ comp.dataB.turns.length }} turns</Badge>
        <Badge variant="neutral">{{ comp.dataB.detail?.eventCount ?? 0 }} events</Badge>
      </div>
    </div>
  </div>
</template>
