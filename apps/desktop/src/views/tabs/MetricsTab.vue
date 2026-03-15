<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import {
  StatCard, Badge, SectionPanel, EmptyState, ProgressBar,
  DataTable, TokenBar, HealthRing,
  formatNumber, formatCost, formatDuration, useSessionTabLoader,
} from "@tracepilot/ui";

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

const totalInputTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.inputTokens, 0));
const totalOutputTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.outputTokens, 0));
const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);
const totalCacheReadTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.cacheReadTokens, 0));
const totalCacheWriteTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.cacheWriteTokens, 0));
const totalRequests = computed(() => modelEntries.value.reduce((sum, m) => sum + m.requests, 0));

const inputPct = computed(() => totalTokens.value > 0 ? (totalInputTokens.value / totalTokens.value) * 100 : 0);
const outputPct = computed(() => totalTokens.value > 0 ? (totalOutputTokens.value / totalTokens.value) * 100 : 0);
const totalCacheTokens = computed(() => totalCacheReadTokens.value + totalCacheWriteTokens.value);
const cacheReadPct = computed(() => totalCacheTokens.value > 0 ? (totalCacheReadTokens.value / totalCacheTokens.value) * 100 : 0);
const cacheWritePct = computed(() => totalCacheTokens.value > 0 ? (totalCacheWriteTokens.value / totalCacheTokens.value) * 100 : 0);

// Cache hit ratio as 0–1 for HealthRing
const cacheHitRatio = computed(() => {
  const allTokens = totalTokens.value + totalCacheReadTokens.value + totalCacheWriteTokens.value;
  return allTokens > 0 ? totalCacheReadTokens.value / allTokens : 0;
});

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
  <div>
    <EmptyState v-if="!metrics" message="No shutdown metrics available for this session." />

    <template v-else>
      <!-- Token stats grid -->
      <div class="grid-4 mb-6">
        <StatCard :value="formatNumber(totalInputTokens)" label="Input Tokens" color="accent" />
        <StatCard :value="formatNumber(totalOutputTokens)" label="Output Tokens" color="accent" />
        <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
        <StatCard :value="formatNumber(totalCacheReadTokens)" label="Cache Read Tokens" color="success" />
      </div>
      <div class="grid-4 mb-6">
        <StatCard :value="formatNumber(totalCacheWriteTokens)" label="Cache Creation Tokens" color="done" />
        <StatCard :value="totalRequests" label="Total Requests" color="accent" />
        <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Premium Requests" color="warning" />
        <StatCard :value="formatDuration(metrics.totalApiDurationMs)" label="API Duration" color="done" />
      </div>

      <!-- Token Distribution -->
      <SectionPanel title="Token Distribution" class="mb-6">
        <div class="space-y-3">
          <TokenBar
            label="Input Tokens"
            :value="formatNumber(totalInputTokens)"
            :percentage="inputPct"
            color="var(--accent-emphasis)"
          />
          <TokenBar
            label="Output Tokens"
            :value="formatNumber(totalOutputTokens)"
            :percentage="outputPct"
            color="var(--done-emphasis)"
          />
        </div>
        <div v-if="totalCacheTokens > 0" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-subtle);">
          <div class="text-xs text-[var(--text-tertiary)] mb-3" style="font-weight: 500;">Cache Distribution</div>
          <div class="space-y-3">
            <TokenBar
              label="Cache Read"
              :value="formatNumber(totalCacheReadTokens)"
              :percentage="cacheReadPct"
              color="var(--success-fg)"
            />
            <TokenBar
              label="Cache Write"
              :value="formatNumber(totalCacheWriteTokens)"
              :percentage="cacheWritePct"
              color="var(--warning-fg)"
            />
          </div>
        </div>
      </SectionPanel>

      <!-- Cache Breakdown with HealthRing -->
      <SectionPanel v-if="totalCacheReadTokens > 0 || totalCacheWriteTokens > 0" title="Cache Breakdown" class="mb-6">
        <div class="flex items-center gap-4">
          <HealthRing :score="cacheHitRatio" size="lg" />
          <div>
            <div class="text-sm font-semibold text-[var(--text-primary)]">Cache Hit Rate</div>
            <div class="text-xs text-[var(--text-tertiary)] mt-1">
              {{ formatNumber(totalCacheReadTokens) }} cache reads of {{ formatNumber(totalTokens + totalCacheReadTokens + totalCacheWriteTokens) }} total tokens
            </div>
          </div>
        </div>
      </SectionPanel>

      <!-- Model Breakdown table -->
      <DataTable v-if="modelEntries.length > 0" :columns="modelColumns" :rows="modelEntries" class="mb-6">
        <template #cell-name="{ value }">
          <Badge variant="done">{{ value }}</Badge>
        </template>
        <template #cell-requests="{ value }">
          <span class="text-[var(--text-primary)]">{{ value }}</span>
        </template>
        <template #cell-inputTokens="{ value }">
          <span class="text-[var(--text-secondary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-outputTokens="{ value }">
          <span class="text-[var(--text-secondary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-cacheReadTokens="{ value }">
          <span class="text-[var(--text-tertiary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-cacheWriteTokens="{ value }">
          <span class="text-[var(--text-tertiary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-totalTokens="{ value }">
          <span class="font-semibold text-[var(--text-primary)]">{{ formatNumber(value as number) }}</span>
        </template>
        <template #cell-cost="{ value }">
          <span class="text-[var(--warning-fg)]">{{ formatCost(value as number) }}</span>
        </template>
      </DataTable>

      <!-- Per-model token distribution -->
      <SectionPanel v-if="modelEntries.length > 1" title="Token Distribution by Model" class="mb-6">
        <div class="space-y-3">
          <TokenBar
            v-for="model in modelEntries"
            :key="model.name"
            :label="model.name"
            :value="formatNumber(model.totalTokens)"
            :percentage="totalTokens > 0 ? (model.totalTokens / totalTokens) * 100 : 0"
            color="var(--done-emphasis)"
          />
        </div>
      </SectionPanel>

      <!-- Code changes -->
      <SectionPanel v-if="metrics.codeChanges" title="Code Changes" class="mb-6">
        <div class="grid-3 mb-4">
          <StatCard :value="metrics.codeChanges.filesModified?.length ?? 0" label="Files Modified" color="accent" />
          <StatCard :value="`+${metrics.codeChanges.linesAdded ?? 0}`" label="Lines Added" color="success" />
          <StatCard :value="`−${metrics.codeChanges.linesRemoved ?? 0}`" label="Lines Removed" color="danger" />
        </div>
        <div v-if="metrics.codeChanges.filesModified?.length" class="section-panel">
          <table class="data-table" aria-label="Modified files">
            <thead>
              <tr>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in metrics.codeChanges.filesModified" :key="file">
                <td class="font-mono text-xs text-[var(--text-secondary)]">{{ file }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionPanel>

      <!-- Model info -->
      <div v-if="metrics.currentModel" class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-tertiary)]">Current Model:</span>
        <Badge variant="done">{{ metrics.currentModel }}</Badge>
      </div>
    </template>
  </div>
</template>
