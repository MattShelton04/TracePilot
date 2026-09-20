import { agentsList, agentsUsageSummary } from "@tracepilot/client";
import type { AgentCatalog, AgentUsageSummary } from "@tracepilot/types";
import { runAction, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import {
  type AgentFlag,
  type AgentScopeFilter,
  type AgentSortKey,
  buildAgentEntries,
  filterAndSortEntries,
} from "@/utils/agents/entries";
import { type AgentUsageRange, rangeBounds } from "@/utils/agents/range";
import { createAgentMutations } from "./mutations";

/**
 * Agents explorer state: definitions and settings (`agents_list`) plus
 * cross-session usage for the selected range (`agents_usage_summary`).
 * Both load independently so a missing index never hides definitions.
 */
export const useAgentsStore = defineStore("agents", () => {
  const catalog = shallowRef<AgentCatalog | null>(null);
  const usage = shallowRef<AgentUsageSummary | null>(null);
  const range = ref<AgentUsageRange>("30d");
  const catalogLoading = ref(false);
  const usageLoading = ref(false);
  const error = ref<string | null>(null);
  const usageError = ref<string | null>(null);
  const catalogGuard = useAsyncGuard();
  const usageGuard = useAsyncGuard();

  const scope = ref<AgentScopeFilter>("all");
  const flags = ref<ReadonlySet<AgentFlag>>(new Set());
  const search = ref("");
  const sort = ref<AgentSortKey>("runs");

  const entries = computed(() => buildAgentEntries(catalog.value, usage.value, range.value));
  const filteredEntries = computed(() =>
    filterAndSortEntries(entries.value, {
      scope: scope.value,
      flags: flags.value,
      search: search.value,
      sort: sort.value,
    }),
  );
  const scopeCounts = computed(() => {
    const counts = { builtin: 0, personal: 0, project: 0, plugin: 0, unresolved: 0 };
    for (const entry of entries.value) counts[entry.scope] += 1;
    return counts;
  });
  const hasCustomAgents = computed(() =>
    (catalog.value?.definitions ?? []).some((d) => d.scope === "personal" || d.scope === "project"),
  );

  async function loadCatalog() {
    await runAction({
      loading: catalogLoading,
      error,
      guard: catalogGuard,
      action: () => agentsList(),
      onSuccess: (result) => {
        catalog.value = result;
      },
    });
  }

  async function loadUsage() {
    await runAction({
      loading: usageLoading,
      error: usageError,
      guard: usageGuard,
      action: () => agentsUsageSummary(rangeBounds(range.value)),
      onSuccess: (result) => {
        usage.value = result;
      },
    });
  }

  async function loadAll() {
    await Promise.all([loadCatalog(), loadUsage()]);
  }

  async function setRange(next: AgentUsageRange) {
    if (range.value === next) return;
    range.value = next;
    await loadUsage();
  }

  function toggleFlag(flag: AgentFlag) {
    const next = new Set(flags.value);
    if (next.has(flag)) next.delete(flag);
    else next.add(flag);
    flags.value = next;
  }

  function clearFilters() {
    scope.value = "all";
    flags.value = new Set();
    search.value = "";
  }

  const mutations = createAgentMutations({ catalog, error, loadCatalog });

  return {
    catalog,
    usage,
    range,
    catalogLoading,
    usageLoading,
    error,
    usageError,
    scope,
    flags,
    search,
    sort,
    entries,
    filteredEntries,
    scopeCounts,
    hasCustomAgents,
    loadCatalog,
    loadUsage,
    loadAll,
    setRange,
    toggleFlag,
    clearFilters,
    ...mutations,
  };
});
