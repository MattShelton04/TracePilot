<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import {
  StatCard, Badge, SectionPanel, EmptyState,
  DataTable, TokenBar, HealthRing,
  formatNumber, formatCost, formatDuration, useSessionTabLoader,
} from "@tracepilot/ui";

const store = useSessionDetailStore();
const prefs = usePreferencesStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadShutdownMetrics()
);

const metrics = computed(() => store.shutdownMetrics);

const modelEntries = computed(() => {
  if (!metrics.value?.modelMetrics) return [];
  return Object.entries(metrics.value.modelMetrics)
    .map(([name, data]) => {
      const inputTokens = data.usage?.inputTokens ?? 0;
      const outputTokens = data.usage?.outputTokens ?? 0;
      const cacheReadTokens = data.usage?.cacheReadTokens ?? 0;
      const wholesaleCost = prefs.computeWholesaleCost(name, inputTokens, cacheReadTokens, outputTokens);
      const premiumRequests = data.requests?.cost ?? 0;
      return {
        name,
        requests: data.requests?.count ?? 0,
        copilotCost: premiumRequests * prefs.costPerPremiumRequest,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: data.usage?.cacheWriteTokens ?? 0,
        totalTokens: inputTokens + outputTokens,
        wholesaleCost,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
});

const totalInputTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.inputTokens, 0));
const totalOutputTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.outputTokens, 0));
const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);
const totalCacheReadTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.cacheReadTokens, 0));
const totalRequests = computed(() => modelEntries.value.reduce((sum, m) => sum + m.requests, 0));

const copilotCost = computed(() => {
  const premiumReqs = metrics.value?.totalPremiumRequests ?? 0;
  return premiumReqs * prefs.costPerPremiumRequest;
});

const totalWholesaleCost = computed(() => {
  let total = 0;
  for (const m of modelEntries.value) {
    if (m.wholesaleCost !== null) total += m.wholesaleCost;
  }
  return total;
});

// Cache hit rate: what % of input tokens were served from cache (0–1 for HealthRing)
const cacheHitRatio = computed(() => {
  return totalInputTokens.value > 0 ? totalCacheReadTokens.value / totalInputTokens.value : 0;
});

const modelColumns = [
  { key: "name", label: "Model", align: "left" as const },
  { key: "requests", label: "Requests", align: "right" as const },
  { key: "copilotCost", label: "Copilot Cost", align: "right" as const },
  { key: "wholesaleCost", label: "Wholesale Cost", align: "right" as const },
  { key: "inputTokens", label: "Input Tokens", align: "right" as const },
  { key: "outputTokens", label: "Output Tokens", align: "right" as const },
  { key: "cacheReadTokens", label: "Cache Read", align: "right" as const, class: "hidden lg:table-cell" },
  { key: "cacheWriteTokens", label: "Cache Write", align: "right" as const, class: "hidden lg:table-cell" },
  { key: "totalTokens", label: "Total", align: "right" as const },
];
</script>

<template>
  <div>
    <EmptyState v-if="!metrics" message="No shutdown metrics available for this session." />

    <template v-else>
      <!-- Stats row — cost comparison -->
      <div class="grid-4 mb-6">
        <StatCard :value="totalRequests" label="Total Requests" color="accent" />
        <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Premium Requests" color="accent" />
        <StatCard :value="formatCost(copilotCost)" label="Copilot Cost" color="warning" />
        <StatCard :value="formatCost(totalWholesaleCost)" label="Wholesale Cost" color="done" tooltip="Estimated cost if this usage went through direct API access instead of GitHub Copilot, based on per-model token pricing configured in Settings." />
      </div>

      <div class="grid-4 mb-6">
        <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
        <StatCard :value="formatDuration(metrics.totalApiDurationMs)" label="API Duration" color="done" />
      </div>

      <!-- Token Distribution — per-model bars -->
      <SectionPanel v-if="modelEntries.length > 0" title="Token Distribution" class="mb-6">
        <div class="space-y-3">
          <TokenBar
            v-for="model in modelEntries"
            :key="model.name"
            :label="model.name"
            :value="formatNumber(model.totalTokens)"
            :percentage="totalTokens > 0 ? (model.totalTokens / totalTokens) * 100 : 0"
            color="var(--accent-emphasis)"
          />
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
        <template #cell-copilotCost="{ value }">
          <span class="text-[var(--warning-fg)]">{{ formatCost(value as number) }}</span>
        </template>
        <template #cell-wholesaleCost="{ value }">
          <span :class="value != null ? 'text-[var(--done-fg)]' : 'text-[var(--text-placeholder)]'">
            {{ value != null ? formatCost(value as number) : '—' }}
          </span>
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
      </DataTable>

      <!-- Cache Breakdown with HealthRing -->
      <SectionPanel v-if="totalCacheReadTokens > 0" title="Cache Breakdown" class="mb-6">
        <div class="flex items-center gap-4">
          <HealthRing :score="cacheHitRatio" size="lg" />
          <div>
            <div class="text-sm font-semibold text-[var(--text-primary)]">Cache Hit Rate</div>
            <div class="text-xs text-[var(--text-tertiary)] mt-1">
              {{ formatNumber(totalCacheReadTokens) }} cache reads of {{ formatNumber(totalInputTokens) }} total input tokens
            </div>
          </div>
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
