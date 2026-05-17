import type { Skill, SkillScope, SkillSummary } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import { logWarn } from "@/utils/logger";
import { createSkillsAssetActions } from "./assets";
import { createSkillsComputed } from "./computed";
import type { SkillsContext } from "./context";
import { createSkillsDiscoveryActions } from "./discovery";
import { discoverEncounteredProjectSkills, type EncounteredSkillSummary } from "./encountered";
import { createSkillsImportActions } from "./imports";
import { createSkillsLoadingActions } from "./loading";
import { createSkillsMutationActions } from "./mutations";

export const useSkillsStore = defineStore("skills", () => {
  const skills = shallowRef<SkillSummary[]>([]);
  const encounteredSkills = shallowRef<EncounteredSkillSummary[]>([]);
  const selectedSkill = shallowRef<Skill | null>(null);
  const loading = ref(false);
  const encounteredLoading = ref(false);
  const error = ref<string | null>(null);
  const encounteredError = ref<string | null>(null);
  const searchQuery = ref("");
  const filterScope = ref<"all" | SkillScope>("global");
  const currentRepoRoot = ref<string | undefined>(undefined);
  const loadGuard = useAsyncGuard();

  const context: SkillsContext = {
    skills,
    encounteredSkills,
    selectedSkill,
    loading,
    encounteredLoading,
    error,
    encounteredError,
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

  async function loadEncounteredProjectSkills() {
    encounteredLoading.value = true;
    encounteredError.value = null;
    try {
      encounteredSkills.value = await discoverEncounteredProjectSkills(skills.value);
    } catch (errorValue) {
      const message =
        errorValue instanceof Error ? errorValue.message : "Unable to scan recent sessions";
      encounteredSkills.value = [];
      encounteredError.value = message;
      logWarn("[skills] Failed to load encountered project skills", errorValue);
    } finally {
      encounteredLoading.value = false;
    }
  }

  return {
    // State
    skills,
    encounteredSkills,
    selectedSkill,
    loading,
    encounteredLoading,
    error,
    encounteredError,
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
    loadEncounteredProjectSkills,
  };
});
