<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import {
  StatCard, Badge, SectionPanel, EmptyState, ErrorAlert,
  DataTable, TokenBar, HealthRing,
  formatNumber, formatCost, formatDuration, formatDate, formatTime, useSessionTabLoader,
} from "@tracepilot/ui";

const store = useSessionDetailStore();
const prefs = usePreferencesStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadShutdownMetrics()
);

function retryLoadMetrics() {
  store.loaded.delete("metrics");
  store.loadShutdownMetrics();
}

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
    <ErrorAlert
      v-if="store.metricsError"
      :message="store.metricsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadMetrics"
    />

    <EmptyState v-if="!metrics && !store.metricsError" message="No shutdown metrics available for this session. Metrics are only generated after the first session shutdown." />

    <template v-if="metrics">
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

      <!-- Session Activity (Full Width Horizontal Tiles) -->
      <SectionPanel v-if="metrics.shutdownSegments?.length" title="Session Activity" class="mb-6">
        <div class="activity-horizontal">
          <div
            v-for="(seg, idx) in metrics.shutdownSegments"
            :key="idx"
            class="activity-tile"
          >
            <!-- Card Header -->
            <div class="activity-tile-header">
              <div class="flex flex-col">
                <span class="activity-index">Segment #{{ idx + 1 }}</span>
                <span class="activity-timestamp">{{ formatDate(seg.endTimestamp) }} {{ formatTime(seg.endTimestamp) }}</span>
              </div>
              <Badge v-if="idx === metrics.shutdownSegments.length - 1" variant="success" size="sm">Latest</Badge>
            </div>

            <!-- Token Hero (Compacted) -->
            <div class="activity-hero" :class="{ 'activity-hero--empty': seg.tokens === 0 }">
              <div v-if="seg.tokens > 0" class="hero-stats">
                <div class="hero-main">
                  <span class="hero-val">{{ formatNumber(seg.tokens) }}</span>
                  <span class="hero-unit">tokens</span>
                </div>
              </div>
              <div v-else class="hero-empty">
                <span class="text-tertiary">No interaction recorded</span>
              </div>
            </div>

            <!-- Model Breakdown Sections (Compacted) -->
            <div v-if="seg.tokens > 0" class="activity-details">
              <!-- Models -->
              <div 
                v-for="(m, name) in seg.modelMetrics" 
                :key="name"
                class="model-row"
                :class="{ 'model-row--premium': (m.requests?.cost ?? 0) > 0 }"
              >
                <div class="row-main">
                  <span class="model-name">{{ name }}</span>
                  <span class="model-tokens">{{ formatNumber((m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0)) }} <small>tokens</small></span>
                </div>
                <div class="row-costs">
                  <span v-if="(m.requests?.cost ?? 0) > 0" class="cost-pill amber-text" title="Copilot Cost">
                    {{ formatCost((m.requests?.cost ?? 0) * prefs.costPerPremiumRequest) }}
                  </span>
                  <span class="cost-pill emerald-text" title="Wholesale Cost">
                    {{ formatCost(prefs.computeWholesaleCost(name as string, m.usage?.inputTokens ?? 0, m.usage?.cacheReadTokens ?? 0, m.usage?.outputTokens ?? 0) || 0) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Card Footer -->
            <div class="activity-tile-footer">
              <div class="footer-metric">
                <span class="label">Time</span>
                <span class="val">{{ formatDuration(seg.apiDurationMs) }}</span>
              </div>
              <div class="footer-metric">
                <span class="label">Reqs</span>
                <span class="val">{{ seg.premiumRequests.toFixed(0) }}</span>
              </div>
            </div>
          </div>
        </div>
      </SectionPanel>

      <!-- Cache Breakdown (Full Width) -->
      <SectionPanel v-if="totalCacheReadTokens > 0" title="Cache Breakdown" class="mb-6">
        <div class="flex flex-col md:flex-row items-center gap-8 py-4">
          <div class="flex flex-col items-center gap-2">
            <HealthRing :score="cacheHitRatio" size="lg" />
            <div class="text-lg font-bold text-[var(--text-primary)]">{{ (cacheHitRatio * 100).toFixed(1) }}%</div>
          </div>
          
          <div class="flex-grow max-w-2xl">
            <div class="text-base font-semibold text-[var(--text-primary)] mb-1">Cache Hit Rate</div>
            <div class="text-sm text-[var(--text-secondary)] mb-6">
              {{ formatNumber(totalCacheReadTokens) }} cache reads out of {{ formatNumber(totalInputTokens) }} total input tokens
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div class="cache-stat-item">
                <div class="flex justify-between text-xs mb-2">
                  <span class="text-[var(--text-tertiary)] uppercase tracking-wider">Cache Influence</span>
                  <span class="font-semibold">{{ formatNumber(totalCacheReadTokens) }} tokens</span>
                </div>
                <div class="h-2 w-full bg-[var(--surface-secondary)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                  <div class="h-full bg-[var(--success-fg)] shadow-[0_0_10px_rgba(52,211,153,0.3)] transition-all duration-500" :style="{ width: `${cacheHitRatio * 100}%` }" />
                </div>
              </div>
              <div class="cache-stat-item">
                <div class="flex justify-between text-xs mb-2">
                  <span class="text-[var(--text-tertiary)] uppercase tracking-wider">Potential Overhead</span>
                  <span class="font-semibold">{{ formatNumber(totalInputTokens - totalCacheReadTokens) }} tokens</span>
                </div>
                <div class="h-2 w-full bg-[var(--surface-secondary)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                  <div class="h-full bg-[var(--accent-fg)]" :style="{ width: `${(1 - cacheHitRatio) * 100}%` }" />
                </div>
              </div>
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

<style scoped>
.activity-horizontal {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 8px 8px 16px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
  margin: 0 -8px;
}

.activity-horizontal::-webkit-scrollbar {
  height: 4px;
}

.activity-horizontal::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 10px;
}

.activity-tile {
  flex: 0 0 280px;
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}

.activity-tile:hover {
  border-color: var(--accent-fg);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.activity-tile-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.activity-index {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--accent-fg);
  letter-spacing: 0.05em;
}

.activity-timestamp {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.activity-hero {
  background: var(--canvas-inset);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin-bottom: 12px;
  border-left: 2px solid var(--accent-fg);
  display: flex;
  align-items: center;
  min-height: 40px;
}

.activity-hero--empty {
  border-left-color: var(--border-subtle);
  background: var(--canvas-default);
  opacity: 0.5;
}

.hero-main {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.hero-val {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
}

.hero-unit {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.hero-empty {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
}

.activity-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-grow: 1;
  margin-bottom: 12px;
}

.model-row {
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-row--premium {
  border-left: 2px solid var(--warning-fg);
  background: var(--warning-subtle);
}

.row-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.model-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tokens {
  font-size: 0.6875rem;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

.model-tokens small {
  font-size: 0.625rem;
  opacity: 0.7;
}

.row-costs {
  display: flex;
  gap: 6px;
}

.cost-pill {
  font-size: 0.6875rem;
  font-family: var(--font-mono);
  font-weight: 700;
  background: rgba(0, 0, 0, 0.15);
  padding: 1px 6px;
  border-radius: 3px;
}

.activity-tile-footer {
  display: flex;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.footer-metric {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.footer-metric .label {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  text-transform: uppercase;
}

.footer-metric .val {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.amber-text { color: var(--warning-fg); }
.emerald-text { color: var(--success-fg); }
</style>
