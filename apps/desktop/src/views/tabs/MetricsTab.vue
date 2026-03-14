<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { StatCard, Badge, SectionPanel, EmptyState, ProgressBar, DataTable, formatNumber, formatCost, useSessionTabLoader } from "@tracepilot/ui";

const store = useSessionDetailStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadShutdownMetrics()
);

const metrics = computed(() => store.shutdownMetrics);

const modelEntries = computed(() => {
  if (!metrics.value?.modelMetrics) return [];
  return Object.entries(metrics.value.modelMetrics)
    .map(([name, data]) => ({
      name,
      requests: data.requests?.count ?? 0,
      cost: data.requests?.cost ?? 0,
      inputTokens: data.usage?.inputTokens ?? 0,
      outputTokens: data.usage?.outputTokens ?? 0,
      cacheReadTokens: data.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: data.usage?.cacheWriteTokens ?? 0,
      totalTokens: (data.usage?.inputTokens ?? 0) + (data.usage?.outputTokens ?? 0),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
});

const totalTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.totalTokens, 0));
const totalRequests = computed(() => modelEntries.value.reduce((sum, m) => sum + m.requests, 0));

const modelColumns = [
  { key: "name", label: "Model", align: "left" as const },
  { key: "requests", label: "Requests", align: "right" as const },
  { key: "inputTokens", label: "Input", align: "right" as const },
  { key: "outputTokens", label: "Output", align: "right" as const },
  { key: "cacheReadTokens", label: "Cache Read", align: "right" as const, class: "hidden lg:table-cell" },
  { key: "cacheWriteTokens", label: "Cache Write", align: "right" as const, class: "hidden lg:table-cell" },
  { key: "totalTokens", label: "Total", align: "right" as const },
  { key: "cost", label: "Cost", align: "right" as const },
];
</script>

<template>
  <div class="space-y-6">
    <EmptyState v-if="!metrics" message="No shutdown metrics available for this session." />

    <template v-else>
      <!-- Summary stats -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" color="accent" />
        <StatCard :value="totalRequests" label="Total Requests" color="accent" />
        <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Premium Requests" color="warning" />
        <StatCard :value="modelEntries.length" label="Models Used" color="done" />
      </div>

      <!-- Model table -->
      <DataTable v-if="modelEntries.length > 0" :columns="modelColumns" :rows="modelEntries">
        <template #cell-name="{ value }">
          <Badge variant="done">{{ value }}</Badge>
        </template>
        <template #cell-requests="{ value }">
          <span class="text-[var(--color-text-primary)]">{{ value }}</span>
        </template>
        <template #cell-inputTokens="{ value }">
          <span class="text-[var(--color-text-secondary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-outputTokens="{ value }">
          <span class="text-[var(--color-text-secondary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-cacheReadTokens="{ value }">
          <span class="text-[var(--color-text-tertiary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-cacheWriteTokens="{ value }">
          <span class="text-[var(--color-text-tertiary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-totalTokens="{ value }">
          <span class="font-semibold text-[var(--color-text-primary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-cost="{ value }">
          <span class="text-[var(--color-warning-fg)]">{{ formatCost(value as number) }}</span>
        </template>
      </DataTable>

      <!-- Token distribution -->
      <SectionPanel v-if="modelEntries.length > 0" title="Token Distribution">
        <div class="space-y-3">
          <div v-for="model in modelEntries" :key="model.name" class="space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-[var(--color-done-fg)]">{{ model.name }}</span>
              <span class="text-[var(--color-text-secondary)]">
                {{ formatNumber(model.totalTokens) }}
                <span class="text-[var(--color-text-tertiary)]">({{ totalTokens > 0 ? Math.round(model.totalTokens / totalTokens * 100) : 0 }}%)</span>
              </span>
            </div>
            <ProgressBar
              :percent="totalTokens > 0 ? Math.round(model.totalTokens / totalTokens * 100) : 0"
              color="var(--color-done-emphasis)"
              :aria-label="`${model.name} token usage`"
            />
          </div>
        </div>
      </SectionPanel>

      <!-- Code changes -->
      <SectionPanel v-if="metrics.codeChanges" title="Code Changes">
        <div class="flex gap-6 text-sm mb-3">
          <div>
            <span class="text-lg font-bold text-[var(--color-success-fg)]">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
            <span class="ml-1 text-[var(--color-text-secondary)]">lines added</span>
          </div>
          <div>
            <span class="text-lg font-bold text-[var(--color-danger-fg)]">-{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            <span class="ml-1 text-[var(--color-text-secondary)]">lines removed</span>
          </div>
        </div>
        <div v-if="metrics.codeChanges.filesModified?.length" class="space-y-1">
          <div class="text-xs text-[var(--color-text-secondary)]">
            Files modified ({{ metrics.codeChanges.filesModified.length }}):
          </div>
          <div class="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs text-[var(--color-text-tertiary)]">
            <div v-for="file in metrics.codeChanges.filesModified" :key="file">{{ file }}</div>
          </div>
        </div>
      </SectionPanel>
    </template>
  </div>
</template>
