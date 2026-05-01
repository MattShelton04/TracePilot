import {
  addRegisteredRepo as addRegisteredRepoApi,
  discoverReposFromSessions as discoverReposApi,
  listRegisteredRepos,
  removeRegisteredRepo as removeRegisteredRepoApi,
  toggleRepoFavourite,
} from "@tracepilot/client";
import type { RegisteredRepo } from "@tracepilot/types";
import { runAction, runMutation } from "@tracepilot/ui";
import { ref } from "vue";
import type { WorktreesContext } from "./context";

export function createRegistryActions(context: WorktreesContext) {
  const { error, registeredRepos, reposLoading, worktrees } = context;
  const togglingFavourites = ref(new Set<string>());

  async function loadRegisteredRepos() {
    await runAction({
      loading: reposLoading,
      error,
      action: () => listRegisteredRepos(),
      onSuccess: (result) => {
        registeredRepos.value = result;
      },
    });
  }

  async function addRepo(path: string): Promise<RegisteredRepo | null> {
    return runMutation(error, async () => {
      const repo = await addRegisteredRepoApi(path);
      await loadRegisteredRepos();
      return repo;
    });
  }

  async function removeRepo(path: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await removeRegisteredRepoApi(path);
      registeredRepos.value = registeredRepos.value.filter((r) => r.path !== path);
      worktrees.value = worktrees.value.filter((w) => w.repoRoot !== path);
      return true as const;
    });
    return ok ?? false;
  }

  async function discoverRepos(): Promise<RegisteredRepo[]> {
    const result = await runMutation(error, async () => {
      const newRepos = await discoverReposApi();
      if (newRepos.length > 0) {
        await loadRegisteredRepos();
      }
      return newRepos;
    });
    return result ?? [];
  }

  async function toggleFavourite(path: string) {
    if (togglingFavourites.value.has(path)) return;
    togglingFavourites.value.add(path);
    try {
      await runMutation(error, async () => {
        const newState = await toggleRepoFavourite(path);
        const repo = registeredRepos.value.find((r) => r.path === path);
        if (repo) {
          repo.favourite = newState;
        }
      });
    } finally {
      togglingFavourites.value.delete(path);
    }
  }

  return {
    loadRegisteredRepos,
    addRepo,
    removeRepo,
    discoverRepos,
    toggleFavourite,
    togglingFavourites,
  };
}
