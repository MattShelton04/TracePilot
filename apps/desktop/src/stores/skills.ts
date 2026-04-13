import {
  skillsAddAsset,
  skillsCopyAssetFrom,
  skillsCreate,
  skillsDelete,
  skillsDiscoverGitHub,
  skillsDiscoverLocal,
  skillsDiscoverRepos,
  skillsDuplicate,
  skillsGetSkill,
  skillsImportFile,
  skillsImportGitHub,
  skillsImportGitHubSkill,
  skillsImportLocal,
  skillsListAll,
  skillsListAssets,
  skillsReadAsset,
  skillsRemoveAsset,
  skillsRename,
  skillsUpdate,
  skillsUpdateRaw,
} from "@tracepilot/client";
import type {
  GitHubSkillPreview,
  LocalSkillPreview,
  RepoSkillsResult,
  Skill,
  SkillAsset,
  SkillFrontmatter,
  SkillImportResult,
  SkillScope,
  SkillSummary,
} from "@tracepilot/types";
import { runAction, runMutation, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { logWarn } from "@/utils/logger";

export const useSkillsStore = defineStore("skills", () => {
  // ─── State ────────────────────────────────────────────────────────
  const skills = ref<SkillSummary[]>([]);
  const selectedSkill = ref<Skill | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterScope = ref<"all" | SkillScope>("all");
  const currentRepoRoot = ref<string | undefined>(undefined);

  const loadGuard = useAsyncGuard();

  // ─── Computed ─────────────────────────────────────────────────────
  const sortedSkills = computed(() =>
    [...skills.value].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const globalSkills = computed(() =>
    skills.value.filter((s) => s.scope === "global"),
  );

  const repoSkills = computed(() =>
    skills.value.filter((s) => s.scope === "repository"),
  );

  const filteredSkills = computed(() => {
    let list = sortedSkills.value;

    if (filterScope.value !== "all") {
      list = list.filter((s) => s.scope === filterScope.value);
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      );
    }

    return list;
  });

  const tokenBudget = computed(() => {
    const total = skills.value.length;
    const enabled = skills.value.filter((s) => s.enabled).length;
    const totalTokens = skills.value.reduce((sum, s) => sum + s.estimatedTokens, 0);
    const enabledTokens = skills.value
      .filter((s) => s.enabled)
      .reduce((sum, s) => sum + s.estimatedTokens, 0);
    return { totalSkills: total, enabledSkills: enabled, totalTokens, enabledTokens };
  });

  // ─── Actions ──────────────────────────────────────────────────────

  async function loadSkills(repoRoot?: string) {
    if (repoRoot !== undefined) {
      currentRepoRoot.value = repoRoot;
    }
    await runAction({
      loading,
      error,
      guard: loadGuard,
      action: () => skillsListAll(currentRepoRoot.value),
      onSuccess: (result) => {
        skills.value = result;
      },
    });
  }

  async function getSkill(dir: string): Promise<Skill | null> {
    selectedSkill.value = null;
    return runMutation(error, async () => {
      const skill = await skillsGetSkill(dir);
      selectedSkill.value = skill;
      return skill;
    });
  }

  async function createSkill(
    name: string,
    desc: string,
    body: string,
  ): Promise<string | null> {
    return runMutation(error, async () => {
      const dir = await skillsCreate(name, desc, body);
      await loadSkills();
      return dir;
    });
  }

  async function updateSkill(
    dir: string,
    fm: SkillFrontmatter,
    body: string,
  ): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsUpdate(dir, fm, body);
        await loadSkills();
        return true as const;
      })) ?? false
    );
  }

  async function updateSkillRaw(dir: string, content: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsUpdateRaw(dir, content);
        await loadSkills();
        return true as const;
      })) ?? false
    );
  }

  async function deleteSkill(dir: string): Promise<boolean> {
    return (await runMutation(error, async () => {
      await skillsDelete(dir);
      skills.value = skills.value.filter((s) => s.directory !== dir);
      if (selectedSkill.value?.directory === dir) {
        selectedSkill.value = null;
      }
      return true as const;
    })) ?? false;
  }

  async function renameSkill(dir: string, newName: string): Promise<string | null> {
    return runMutation(error, async () => {
      const newDir = await skillsRename(dir, newName);
      await loadSkills();
      return newDir;
    });
  }

  async function duplicateSkill(dir: string, newName: string): Promise<string | null> {
    return runMutation(error, async () => {
      const newDir = await skillsDuplicate(dir, newName);
      await loadSkills();
      return newDir;
    });
  }

  // ─── Asset Actions ────────────────────────────────────────────────

  async function listAssets(dir: string): Promise<SkillAsset[]> {
    try {
      return await skillsListAssets(dir);
    } catch (e) {
      logWarn("[skills] Failed to list assets", { dir, error: e });
      return [];
    }
  }

  async function addAsset(
    dir: string,
    name: string,
    content: number[],
  ): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsAddAsset(dir, name, content);
        return true as const;
      })) ?? false
    );
  }

  async function copyAssetFrom(
    dir: string,
    name: string,
    sourcePath: string,
  ): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsCopyAssetFrom(dir, name, sourcePath);
        return true as const;
      })) ?? false
    );
  }

  async function readAsset(dir: string, name: string): Promise<string | null> {
    try {
      return await skillsReadAsset(dir, name);
    } catch (e) {
      logWarn("[skills] Failed to read asset", { dir, name, error: e });
      return null;
    }
  }

  async function removeAsset(dir: string, name: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsRemoveAsset(dir, name);
        return true as const;
      })) ?? false
    );
  }

  // ─── Import Actions ───────────────────────────────────────────────

  async function importLocal(sourceDir: string, scope?: string, repoRoot?: string): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportLocal(sourceDir, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function importFile(path: string, scope?: string, repoRoot?: string): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportFile(path, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function importGitHub(
    owner: string,
    repo: string,
    skillPath?: string,
    gitRef?: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportGitHub(owner, repo, skillPath, gitRef, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function discoverGitHub(
    owner: string,
    repo: string,
    path?: string,
    gitRef?: string,
  ): Promise<GitHubSkillPreview[]> {
    return (
      (await runMutation(error, async () => {
        return await skillsDiscoverGitHub(owner, repo, path, gitRef);
      })) ?? []
    );
  }

  async function importGitHubSkill(
    owner: string,
    repo: string,
    skillPath: string,
    gitRef?: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportGitHubSkill(owner, repo, skillPath, gitRef, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function discoverLocal(dir: string): Promise<LocalSkillPreview[]> {
    return (
      (await runMutation(error, async () => {
        return await skillsDiscoverLocal(dir);
      })) ?? []
    );
  }

  async function discoverRepos(
    repos: [string, string][],
  ): Promise<RepoSkillsResult[]> {
    return (
      (await runMutation(error, async () => {
        return await skillsDiscoverRepos(repos);
      })) ?? []
    );
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
    sortedSkills,
    globalSkills,
    repoSkills,
    filteredSkills,
    tokenBudget,
    // Actions
    loadSkills,
    getSkill,
    createSkill,
    updateSkill,
    updateSkillRaw,
    deleteSkill,
    renameSkill,
    duplicateSkill,
    // Assets
    listAssets,
    addAsset,
    copyAssetFrom,
    readAsset,
    removeAsset,
    // Import
    importLocal,
    importFile,
    importGitHub,
    discoverGitHub,
    importGitHubSkill,
    discoverLocal,
    discoverRepos,
  };
});