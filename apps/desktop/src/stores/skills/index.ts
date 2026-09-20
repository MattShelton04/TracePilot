import type { Skill, SkillDiagnostic, SkillSummary } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import type { SkillFlag, SkillScopeFilter, SkillSortKey } from "@/utils/skills/entries";
import { createSkillsAssetActions } from "./assets";
import { createSkillsComputed } from "./computed";
import type { SkillsContext } from "./context";
import { createSkillsDiscoveryActions } from "./discovery";
import { createSkillsImportActions } from "./imports";
import { createSkillsLoadingActions } from "./loading";
import { createSkillsMutationActions } from "./mutations";
import { createSkillsUsageSlice } from "./usage";

export const useSkillsStore = defineStore("skills", () => {
  const skills = shallowRef<SkillSummary[]>([]);
  const diagnostics = shallowRef<SkillDiagnostic[]>([]);
  const selectedSkill = shallowRef<Skill | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterScope = ref<SkillScopeFilter>("all");
  const filterFlags = ref<ReadonlySet<SkillFlag>>(new Set());
  const sort = ref<SkillSortKey>("uses");
  const currentRepoRoot = ref<string | undefined>(undefined);
  const loadGuard = useAsyncGuard();

  const context: SkillsContext = {
    skills,
    diagnostics,
    selectedSkill,
    loading,
    error,
    searchQuery,
    filterScope,
    filterFlags,
    sort,
    currentRepoRoot,
    loadGuard,
  };

  const usageSlice = createSkillsUsageSlice();
  const computed = createSkillsComputed(context, usageSlice.usage, usageSlice.range);
  const loadingActions = createSkillsLoadingActions(context);
  const mutationActions = createSkillsMutationActions(context, loadingActions.loadSkills);
  const assetActions = createSkillsAssetActions(context);
  const importActions = createSkillsImportActions(context, loadingActions.loadSkills);
  const discoveryActions = createSkillsDiscoveryActions(context);

  function clearError() {
    error.value = null;
  }

  function setFilterScope(scope: SkillScopeFilter) {
    filterScope.value = scope;
  }

  function toggleFlag(flag: SkillFlag) {
    const next = new Set(filterFlags.value);
    if (next.has(flag)) next.delete(flag);
    else next.add(flag);
    filterFlags.value = next;
  }

  /** Show only one flag, for an insight's "Show them". */
  function showOnlyFlag(flag: SkillFlag) {
    filterScope.value = "all";
    searchQuery.value = "";
    filterFlags.value = new Set([flag]);
  }

  function clearFilters() {
    filterScope.value = "all";
    filterFlags.value = new Set();
    searchQuery.value = "";
  }

  /** The catalog and its usage, loaded together but failing independently. */
  async function loadAll(repoRoot?: string) {
    await Promise.all([loadingActions.loadSkills(repoRoot), usageSlice.loadUsage()]);
  }

  return {
    // State
    skills,
    diagnostics,
    selectedSkill,
    loading,
    error,
    searchQuery,
    filterScope,
    filterFlags,
    sort,
    ...usageSlice,
    // Computed
    ...computed,
    // Actions
    ...loadingActions,
    ...mutationActions,
    // Assets
    ...assetActions,
    // Import
    ...importActions,
    ...discoveryActions,
    clearError,
    setFilterScope,
    toggleFlag,
    showOnlyFlag,
    clearFilters,
    loadAll,
  };
});
