<script setup lang="ts">
import { formatNumber } from "@tracepilot/types";
import { Banner, EmptyState, PageHeader, PageShell, type SegmentOption } from "@tracepilot/ui";
import { Bot, Plus, RefreshCw } from "lucide-vue-next";
import DefinitionFilters from "@/components/definitions/DefinitionFilters.vue";
import DefinitionLoading from "@/components/definitions/DefinitionLoading.vue";
import "@/styles/features/definition-manager.css";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AgentCard from "@/components/agents/AgentCard.vue";
import AgentCreateModal from "@/components/agents/AgentCreateModal.vue";
import { FLAG_BADGES, FLAG_FILTERS, SCOPE_FILTER_LABELS } from "@/components/agents/agentBadges";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAgentsStore } from "@/stores/agents";
import {
  type AgentEntry,
  type AgentFlag,
  type AgentScopeFilter,
  type AgentSortKey,
  agentRouteId,
} from "@/utils/agents/entries";
import { USAGE_RANGE_LABELS } from "@/utils/usage/range";

const store = useAgentsStore();
const router = useRouter();
const route = useRoute();
const showCreate = ref(false);

// Deep links must be visible even after a previous visit narrowed the filters.
watch(
  () => route.query.q,
  (query) => {
    if (typeof query !== "string") return;
    store.clearFilters();
    store.search = query;
  },
  { immediate: true },
);
onMounted(() => store.loadAll());

const scopeOptions = computed<SegmentOption[]>(() =>
  SCOPE_FILTER_LABELS.map((option) => ({
    ...option,
    count:
      option.value === "all"
        ? store.entries.length
        : store.scopeCounts[option.value as keyof typeof store.scopeCounts],
  })).filter((option) => option.value === "all" || (option.count ?? 0) > 0),
);

const sortOptions = [
  { value: "runs", label: "Most runs" },
  { value: "name", label: "Name" },
  { value: "failure", label: "Failure rate" },
  { value: "duration", label: "Median duration" },
  { value: "lastUsed", label: "Last used" },
] as const;

const visibleFlags = computed(() =>
  FLAG_FILTERS.map((flag) => ({
    value: flag,
    ...FLAG_BADGES[flag],
    count: store.entries.filter((entry) => entry.flags.includes(flag)).length,
  })).filter((flag) => flag.count > 0 || store.flags.has(flag.value)),
);

const failureRatePct = computed(() => {
  const usage = store.usage;
  if (!usage || usage.totalRuns === 0) return "—";
  const rate = ((usage.failedRuns + usage.cancelledRuns) / usage.totalRuns) * 100;
  return `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}%`;
});

function openAgent(entry: AgentEntry) {
  pushRoute(router, ROUTE_NAMES.agentEditor, { query: { id: agentRouteId(entry) } });
}

function onCreated(path: string) {
  showCreate.value = false;
  pushRoute(router, ROUTE_NAMES.agentEditor, { query: { id: path } });
}
</script>

<template>
  <PageShell>
    <div class="definition-manager agents-manager-view">
      <PageHeader title="Agents" subtitle="Definitions and cross-session usage for every Copilot CLI agent">
        <template #icon>
          <Bot :size="16" :stroke-width="1.75" />
        </template>
        <template #actions>
          <button type="button" class="btn btn--ghost" :disabled="store.catalogLoading || store.usageLoading" @click="store.loadAll(true)">
            <RefreshCw :size="14" /> Refresh
          </button>
          <button class="btn btn--primary" @click="showCreate = true">
            <Plus :size="14" :stroke-width="2" />
            New Agent
          </button>
        </template>
      </PageHeader>

      <DefinitionLoading v-if="!store.initialized" noun="agents" />
      <template v-else>
      <div class="stats-strip">
        <span class="stat-chip">{{ store.entries.length }} agents</span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">{{ store.scopeCounts.builtin }} built-in</span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">{{ store.scopeCounts.personal }} personal</span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">{{ store.scopeCounts.project }} project</span>
        <template v-if="store.scopeCounts.plugin">
          <span class="stat-sep">&middot;</span>
          <span class="stat-chip">{{ store.scopeCounts.plugin }} plugin</span>
        </template>
        <template v-if="store.scopeCounts.unresolved">
          <span class="stat-sep">&middot;</span>
          <span class="stat-chip stat-chip--warning">{{ store.scopeCounts.unresolved }} unresolved</span>
        </template>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          {{ store.usage ? formatNumber(store.usage.totalRuns) : "—" }} runs
          <span class="stat-chip__muted">in {{ USAGE_RANGE_LABELS[store.range] }}</span>
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">{{ failureRatePct }} failed or cancelled</span>
      </div>

      <DefinitionFilters
        :scope="store.scope" :scopes="scopeOptions" :range="store.range"
        :sort="store.sort" :sorts="[...sortOptions]" v-model:search="store.search"
        noun="agents" :flags="visibleFlags" :selected-flags="store.flags"
        @update:scope="store.scope = $event as AgentScopeFilter"
        @update:range="store.setRange" @update:sort="store.sort = $event as AgentSortKey"
        @toggle-flag="store.toggleFlag($event as AgentFlag)" @clear="store.clearFilters"
      />

      <Banner v-if="store.error" tone="danger" :title="'Agents could not be loaded'">
        {{ store.error }}
      </Banner>
      <Banner v-else-if="store.usageError" tone="warning" title="Usage unavailable">
        {{ store.usage ? "Showing previously loaded usage:" : "Definitions are shown without cross-session usage:" }} {{ store.usageError }}
      </Banner>

      <details
        v-if="store.catalog?.diagnostics.length"
        class="diagnostics"
      >
        <summary>
          {{ store.catalog.diagnostics.length }} definition{{ store.catalog.diagnostics.length === 1 ? "" : "s" }} could not be read
        </summary>
        <ul>
          <li v-for="diagnostic in store.catalog.diagnostics" :key="diagnostic.path">
            <code>{{ diagnostic.path }}</code>: {{ diagnostic.message }}
          </li>
        </ul>
      </details>

      <Banner v-if="store.catalog?.settings.shapeError" tone="warning" title="Unrecognised subagents settings">
        {{ store.catalog.settings.shapeError }} Overrides are read-only until the shape is understood.
      </Banner>

        <div v-if="store.filteredEntries.length" class="definition-grid agents-grid">
          <AgentCard
            v-for="entry in store.filteredEntries"
            :key="entry.key"
            :entry="entry"
            :range="store.range"
            @open="openAgent"
          />
        </div>

        <EmptyState
          v-else
          title="No agents match"
          :description="
            store.entries.length
              ? 'Try a different search, scope or flag.'
              : 'No agent definitions were found and no sessions have run one yet.'
          "
          :primary-action="store.entries.length
            ? { label: 'Clear filters', onClick: store.clearFilters }
            : { label: 'Create agent', onClick: () => (showCreate = true) }"
        >
          <template #icon><Bot :size="40" :stroke-width="1.5" /></template>
        </EmptyState>
      </template>

      <AgentCreateModal v-model:visible="showCreate" @created="onCreated" />
    </div>
  </PageShell>
</template>
