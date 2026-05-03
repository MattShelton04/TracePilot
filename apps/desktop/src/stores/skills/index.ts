import type { Skill, SkillScope, SkillSummary } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import { createSkillsAssetActions } from "./assets";
import { createSkillsComputed } from "./computed";
import type { SkillsContext } from "./context";
import { createSkillsDiscoveryActions } from "./discovery";
import { createSkillsImportActions } from "./imports";
import { createSkillsLoadingActions } from "./loading";
import { createSkillsMutationActions } from "./mutations";

export const useSkillsStore = defineStore("skills", () => {
  const skills = shallowRef<SkillSummary[]>([]);
  const selectedSkill = shallowRef<Skill | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterScope = ref<"all" | SkillScope>("all");
  const currentRepoRoot = ref<string | undefined>(undefined);
  const loadGuard = useAsyncGuard();

  const context: SkillsContext = {
    skills,
    selectedSkill,
    loading,
    error,
    searchQuery,
    filterScope,
    currentRepoRoot,
    loadGuard,
  };

  const computed = createSkillsComputed(context);
  const loadingActions = createSkillsLoadingActions(context);
  const mutationActions = createSkillsMutationActions(context, loadingActions.loadSkills);
  const assetActions = createSkillsAssetActions(context);
  const importActions = createSkillsImportActions(context, loadingActions.loadSkills);
  const discoveryActions = createSkillsDiscoveryActions(context);

  function clearError() {
    error.value = null;
  }

  function setFilterScope(scope: "all" | SkillScope) {
    filterScope.value = scope;
  }

  return {
    // State
    skills,
    selectedSkill,
    loading,
    error,
    searchQuery,
    filterScope,
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
  };
});
