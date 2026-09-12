<script setup lang="ts">
import type { ConversationTurn, ShutdownMetrics } from "@tracepilot/types";
import {
  Badge,
  DataTable,
  formatAiCredits,
  formatDuration,
  formatNumber,
  SectionPanel,
  Tooltip,
} from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePreferencesStore } from "@/stores/preferences";
import { agentUsageCoverage, buildAgentUsageRows } from "@/utils/agentUsageRows";
import MetricsCacheBreakdown from "./MetricsCacheBreakdown.vue";
import MetricsModelTable from "./MetricsModelTable.vue";

const props = defineProps<{ metrics: ShutdownMetrics; turns: ConversationTurn[] }>();
defineEmits<{ activity: [toolCallId: string] }>();
const descendants = ref(false);
const sort = ref("tree");
const page = ref(0);
const selectedId = ref<string | null>(null);
const rows = computed(() => buildAgentUsageRows(props.metrics, props.turns));
const coverage = computed(() => agentUsageCoverage(props.metrics));
const displayRows = computed(() => {
  const result = rows.value.map((row) => {
    const usage = descendants.value ? row.branch : row.own;
    return {
      ...row,
      ...usage,
      total: usage.tokens.total,
      share:
        usage.credits != null &&
        coverage.value.sessionCredits != null &&
        coverage.value.sessionCredits > 0
          ? (usage.credits / coverage.value.sessionCredits) * 100
          : null,
    };
  });
  if (sort.value !== "tree") {
    const key = sort.value as "credits" | "total" | "apiMs";
    result.sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  }
  return result;
});
const pageCount = computed(() => Math.max(1, Math.ceil(displayRows.value.length / 50)));
watch([sort, descendants, () => props.metrics], () => {
  page.value = 0;
});
const visibleRows = computed(() => displayRows.value.slice(page.value * 50, (page.value + 1) * 50));
const selected = computed(() => rows.value.find((row) => row.id === selectedId.value));
const selectedMetrics = computed<ShutdownMetrics>(() => ({ modelMetrics: selected.value?.models }));
const detail = useMetricsTabData(selectedMetrics, usePreferencesStore(), true);
const columns = [
  { key: "name", label: "Agent" },
  { key: "credits", label: "Recorded credits", align: "right" as const },
  { key: "share", label: "Session share", align: "right" as const },
  { key: "total", label: "Tokens", align: "right" as const },
  { key: "requests", label: "Requests", align: "right" as const },
  { key: "tools", label: "Tools", align: "right" as const },
  { key: "apiMs", label: "API time", align: "right" as const },
];
const format = (value: unknown) => (value == null ? "—" : formatNumber(value as number));
const snapshotDate = computed(() =>
  props.metrics.agentUsage?.timestamp
    ? new Date(props.metrics.agentUsage.timestamp).toLocaleString()
    : "unknown time",
);
</script>

<template>
  <SectionPanel title="Agent Usage" class="mb-6" data-testid="agent-usage">
    <template #actions>
      <span class="text-xs text-[var(--text-tertiary)]">{{ descendants ? 'Including descendants' : 'Own usage' }}</span>
      <Tooltip :text="`Usage recorded at shutdown (${snapshotDate}); status and tools can include newer activity. API time is accumulated request duration, not wall time. Select an agent for model/cache details. A dash means unavailable.`"><button type="button" aria-label="About agent usage" class="text-[var(--text-tertiary)]"><Info :size="14" /></button></Tooltip>
    </template>
    <p v-if="!metrics.agentUsage" class="text-sm text-[var(--text-secondary)] mb-4">Per-agent usage was not recorded in this session.</p>
    <p v-if="metrics.agentUsage && !coverage.comparable" class="text-xs text-[var(--attention-fg)] mb-4">Agent snapshot: {{ snapshotDate }} · not comparable with latest session totals.</p>
    <p v-if="metrics.agentUsage?.hasInvalidFields" class="text-xs text-[var(--attention-fg)] mb-4">Some recorded fields are invalid; valid data is retained.</p>
    <div class="flex flex-wrap items-center gap-4 mb-4">
      <label class="text-xs flex items-center gap-2 cursor-pointer"><input v-model="descendants" type="checkbox" class="cursor-pointer" />Include descendants</label>
      <label class="text-xs flex items-center gap-2">Order
        <select v-model="sort" class="filter-select" aria-label="Agent order"><option value="tree">Agent hierarchy</option><option value="credits">Highest credits</option><option value="total">Most tokens</option><option value="apiMs">Longest API time</option></select>
      </label>
    </div>
    <DataTable :columns="columns" :rows="visibleRows" style="overflow-x: auto;" data-testid="agent-usage-table">
      <template #cell-name="{ row }">
        <div :style="{ paddingLeft: sort === 'tree' ? `${Math.min(row.depth as number, 8) * 16}px` : '0' }">
          <button class="cursor-pointer text-left text-[var(--accent-fg)] hover:underline" :title="row.id as string" @click="selectedId = row.id as string">{{ row.name }}</button>
          <Badge v-if="row.status !== 'main'" variant="neutral" class="ml-2">{{ row.status === 'in-progress' ? 'Running' : row.status === 'unlinked' ? 'Activity unavailable' : row.status }}</Badge>
          <div class="text-xs text-[var(--text-tertiary)] max-w-64 truncate" :title="row.modelNames as string">{{ row.modelNames }}</div>
        </div>
      </template>
      <template #cell-credits="{ value, row }">{{ formatAiCredits(value as number | null) }}<span v-if="row.partial && value != null" title="Includes known credits only"> (partial)</span></template>
      <template #cell-share="{ value }">{{ value != null ? `${(value as number).toFixed(1)}%` : '—' }}</template>
      <template #cell-total="{ value }">{{ format(value) }}</template>
      <template #cell-requests="{ value }">{{ format(value) }}</template>
      <template #cell-tools="{ value }">{{ format(value) }}</template>
      <template #cell-apiMs="{ value }">{{ value != null ? formatDuration(value as number) : '—' }}</template>
    </DataTable>
    <div v-if="pageCount > 1" class="flex items-center gap-4 mt-4 text-xs">
      <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous</button>
      <span>{{ page + 1 }} / {{ pageCount }}</span>
      <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">Next</button>
    </div>
    <p v-if="descendants" class="text-xs text-[var(--text-tertiary)] mt-3">Rows include descendants and overlap; do not add them together.</p>
    <p v-if="coverage.attributed != null" class="text-xs text-[var(--text-secondary)] mt-4">Attributed credits: {{ formatAiCredits(coverage.attributed) }}{{ coverage.complete ? '' : ' (partial)' }}<span v-if="coverage.remainder != null"> · Not attributed to an agent: {{ formatAiCredits(coverage.remainder) }}</span></p>
    <p v-if="coverage.exceedsTotal" class="text-xs text-[var(--attention-fg)] mt-3">Agent credits exceed the recorded session total.</p>
  </SectionPanel>
  <SectionPanel v-if="selected" :title="`${selected.name} · Own usage`" class="mb-6" data-testid="agent-usage-detail">
    <template #actions>
      <Tooltip :text="selected.id"><button type="button" aria-label="Agent identity" class="text-[var(--text-tertiary)]"><Info :size="14" /></button></Tooltip>
      <button v-if="selected.toolCallId" class="btn btn-secondary" @click="$emit('activity', selected.toolCallId)">Open agent activity</button>
      <button class="btn btn-secondary" @click="selectedId = null">Close details</button>
    </template>
    <p v-if="!Object.keys(selected.models).length" class="text-sm text-[var(--text-secondary)]">Model usage is unavailable for this agent.</p>
    <template v-else>
      <MetricsCacheBreakdown :breakdown="selected.own.tokens" :scope="`${selected.name} only`" />
      <MetricsModelTable :model-entries="detail.modelEntries.value" :total-tokens="detail.totalTokens.value" :has-reasoning-data="detail.hasReasoningData.value" hide-distribution />
    </template>
  </SectionPanel>
</template>
