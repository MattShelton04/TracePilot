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
import { useAgentRequestRollups } from "@/composables/session/useAgentRequestRollups";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { usePreferencesStore } from "@/stores/preferences";
import {
  type AgentRequestFigures,
  cacheReadRatio,
  joinAgentRequestRollups,
} from "@/utils/agentRequestRollups";
import { agentUsageCoverage, buildAgentUsageRows } from "@/utils/agentUsageRows";
import { formatExactCredits, NOT_RECORDED } from "@/utils/requestLedger";
import MetricsCacheBreakdown from "./MetricsCacheBreakdown.vue";
import MetricsModelTable from "./MetricsModelTable.vue";

const props = defineProps<{ metrics: ShutdownMetrics; turns: ConversationTurn[] }>();
defineEmits<{ activity: [toolCallId: string] }>();
const descendants = ref(false);
type SortKey = "name" | "credits" | "share" | "total" | "requests" | "tools" | "apiMs";
const sortKey = ref<SortKey | null>(null);
const sortDirection = ref<"ascending" | "descending">("descending");
const page = ref(0);
const selectedId = ref<string | null>("main");
const rows = computed(() => buildAgentUsageRows(props.metrics, props.turns));
const coverage = computed(() => agentUsageCoverage(props.metrics));

// Recorded requests are a second, independent source. They add columns to the
// shutdown breakdown; they never stand in for a shutdown total, whose coverage
// they cannot be assumed to match.
const sessionDetail = useSessionDetailContext();
const requests = useAgentRequestRollups(() => sessionDetail.sessionId);
const requestJoin = computed(() => joinAgentRequestRollups(rows.value, requests.rollups.value));
const showRequests = computed(
  () => requests.enabled.value && requests.available.value && requestJoin.value.hasFigures,
);
const attribution = computed(() => requestJoin.value.attribution);

/** A row with no roll-up at all is unrecorded, which a recorded 0 is not. */
function requestCell(figures: AgentRequestFigures | undefined): string {
  if (!figures || (figures.requestCount === 0 && figures.nanoAiu == null)) return NOT_RECORDED;
  return formatNumber(figures.requestCount);
}

function ratioCell(figures: AgentRequestFigures | undefined): string {
  const ratio = figures ? cacheReadRatio(figures) : null;
  return ratio == null ? NOT_RECORDED : `${(ratio * 100).toFixed(1)}%`;
}

const displayRows = computed(() => {
  const join = requestJoin.value;
  const result = rows.value.map((row) => {
    const usage = descendants.value ? row.branch : row.own;
    const columns = join.byRow.get(row.id);
    const figures = descendants.value ? columns?.branch : columns?.own;
    return {
      ...row,
      ...usage,
      requestFigures: figures,
      storeRequests: requestCell(figures),
      storeCredits:
        figures && figures.unparsedCredits === 0
          ? formatExactCredits(figures.nanoAiu)
          : NOT_RECORDED,
      storeCacheRatio: ratioCell(figures),
      total: usage.tokens.total,
      share:
        usage.credits != null &&
        coverage.value.sessionCredits != null &&
        coverage.value.sessionCredits > 0
          ? (usage.credits / coverage.value.sessionCredits) * 100
          : null,
    };
  });
  const key = sortKey.value;
  if (key) {
    const direction = sortDirection.value === "ascending" ? 1 : -1;
    result.sort((a, b) => {
      if (key === "name") return direction * a.name.localeCompare(b.name);
      const left = a[key];
      const right = b[key];
      // Unknown usage stays last in either direction. Equal values retain the
      // deterministic hierarchy order supplied by buildAgentUsageRows.
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return direction * (left - right);
    });
  }
  return result;
});
const pageCount = computed(() => Math.max(1, Math.ceil(displayRows.value.length / 50)));
watch([sortKey, sortDirection, descendants], () => {
  page.value = 0;
});
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count - 1);
});
const visibleRows = computed(() => displayRows.value.slice(page.value * 50, (page.value + 1) * 50));
const selected = computed(() => rows.value.find((row) => row.id === selectedId.value));
const selectedMetrics = computed<ShutdownMetrics>(() => ({ modelMetrics: selected.value?.models }));
const detail = useMetricsTabData(selectedMetrics, usePreferencesStore(), true);
const columns = (
  [
    { key: "name", label: "Agent" },
    { key: "credits", label: "Recorded credits", align: "right" as const },
    { key: "share", label: "Session share", align: "right" as const },
    { key: "total", label: "Tokens", align: "right" as const },
    { key: "requests", label: "Requests", align: "right" as const },
    { key: "tools", label: "Tools", align: "right" as const },
    { key: "apiMs", label: "API time", align: "right" as const },
  ] satisfies Array<{ key: SortKey; label: string; align?: "right" }>
).map((column) => ({ ...column, sortable: true }));

// Not sortable: credits here are exact decimal strings, and comparing them
// would mean parsing a nano-AIU total that routinely exceeds 2^53.
const REQUEST_COLUMNS = [
  { key: "storeRequests", label: "Observed requests", align: "right" as const, sortable: false },
  { key: "storeCredits", label: "Observed credits", align: "right" as const, sortable: false },
  {
    key: "storeCacheRatio",
    label: "Observed cache reuse",
    align: "right" as const,
    sortable: false,
  },
];
const tableColumns = computed(() =>
  showRequests.value ? [...columns, ...REQUEST_COLUMNS] : columns,
);
function toggleSort(key: string) {
  const column = columns.find((column) => column.key === key);
  if (!column) return;
  if (sortKey.value !== column.key) {
    sortKey.value = column.key;
    sortDirection.value = column.key === "name" ? "ascending" : "descending";
  } else {
    sortDirection.value = sortDirection.value === "ascending" ? "descending" : "ascending";
  }
}
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
      <button v-if="sortKey" class="cursor-pointer text-xs text-[var(--accent-fg)] hover:underline" @click="sortKey = null">Reset to hierarchy</button>
    </div>
    <DataTable :columns="tableColumns" :rows="visibleRows" :sort-key="sortKey" :sort-direction="sortDirection" style="overflow-x: auto;" data-testid="agent-usage-table" @sort="toggleSort">
      <template #cell-name="{ row }">
        <div :style="{ paddingLeft: !sortKey ? `${Math.min(row.depth as number, 8) * 16}px` : '0' }">
          <button class="cursor-pointer text-left text-[var(--accent-fg)] hover:underline" :class="{ 'font-semibold': selectedId === row.id }" :title="row.id as string" :aria-pressed="selectedId === row.id" @click="selectedId = row.id as string">{{ row.name }}</button>
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
      <template #cell-storeRequests="{ value }">{{ value }}</template>
      <template #cell-storeCredits="{ value }">{{ value }}</template>
      <template #cell-storeCacheRatio="{ value }">{{ value }}</template>
    </DataTable>
    <div v-if="pageCount > 1" class="flex items-center gap-4 mt-4 text-xs">
      <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous</button>
      <span>{{ page + 1 }} / {{ pageCount }}</span>
      <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">Next</button>
    </div>
    <p v-if="descendants" class="text-xs text-[var(--text-tertiary)] mt-3">Rows include descendants and overlap; do not add them together.</p>
    <p v-if="coverage.attributed != null" class="text-xs text-[var(--text-secondary)] mt-4">Attributed credits: {{ formatAiCredits(coverage.attributed) }}{{ coverage.complete ? '' : ' (partial)' }}<span v-if="coverage.remainder != null"> · Not attributed to an agent: {{ formatAiCredits(coverage.remainder) }}</span></p>
    <p v-if="coverage.exceedsTotal" class="text-xs text-[var(--attention-fg)] mt-3">Agent credits exceed the recorded session total.</p>
    <template v-if="requests.enabled.value">
      <p v-if="showRequests" class="text-xs text-[var(--text-secondary)] mt-4" data-testid="agent-requests-note">Observed columns come from the Copilot session store and are counted per recorded request. They are a separate figure from the shutdown totals beside them, which are unchanged.</p>
      <!-- Requests without an agent ID are usually the main agent's own, but the store does not say so; only runs named yet unmatched are unexplained. -->
      <p v-if="showRequests && attribution.unattributedRequests > 0" class="text-xs mt-2" :class="attribution.unmatchedRollups > 0 ? 'text-[var(--attention-fg)]' : 'text-[var(--text-tertiary)]'" data-testid="agent-requests-unattributed">Not attributed to an agent run: {{ attribution.unattributedRequests }} recorded request(s)<span v-if="attribution.unmatched && attribution.unmatched.unparsedCredits === 0"> · {{ formatExactCredits(attribution.unmatched.nanoAiu) }}</span>. These recorded no agent to join on — typically the main agent's own requests, though the store does not confirm it — so the rows above leave them out.</p>
      <p v-if="showRequests && attribution.unmatchedRollups > 0" class="text-xs text-[var(--attention-fg)] mt-2" data-testid="agent-requests-unmatched">{{ attribution.unmatchedRollups }} recorded run(s) have no matching row in this breakdown and are not included in the columns above.</p>
      <p v-if="requests.loaded.value && !requests.available.value" class="text-xs text-[var(--text-tertiary)] mt-4" data-testid="agent-requests-unavailable">No session store could be read, so per-request figures are unavailable for these agents. The shutdown totals above are unaffected.</p>
    </template>
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
