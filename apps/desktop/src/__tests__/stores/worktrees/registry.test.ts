// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import type { RegisteredRepo, WorktreeInfo } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  createDeferred,
  FIXTURE_FEATURE_WT,
  FIXTURE_MAIN_WT,
  FIXTURE_REPO,
  FIXTURE_REPO_2,
  mocks,
  REPO_PATH,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore repository registry", () => {
  describe("loadRegisteredRepos", () => {
    it("populates registeredRepos", async () => {
      mocks.listRegisteredRepos.mockResolvedValue([FIXTURE_REPO, FIXTURE_REPO_2]);
      const store = useWorktreesStore();

      await store.loadRegisteredRepos();

      expect(store.registeredRepos).toHaveLength(2);
      expect(store.reposLoading).toBe(false);
    });

    it("sets reposLoading during fetch", async () => {
      mocks.listRegisteredRepos.mockResolvedValue([]);
      const store = useWorktreesStore();

      const promise = store.loadRegisteredRepos();
      expect(store.reposLoading).toBe(true);
      await promise;
      expect(store.reposLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mocks.listRegisteredRepos.mockRejectedValue(new Error("registry error"));
      const store = useWorktreesStore();

      await store.loadRegisteredRepos();

      expect(store.error).toContain("registry error");
      expect(store.reposLoading).toBe(false);
    });
  });

  describe("addRepo", () => {
    it("adds repo and refreshes list", async () => {
      const newRepo: RegisteredRepo = {
        ...FIXTURE_REPO,
        path: "/new/repo",
        name: "NewRepo",
      };
      mocks.addRegisteredRepo.mockResolvedValue(newRepo);
      mocks.listRegisteredRepos.mockResolvedValue([FIXTURE_REPO, newRepo]);
      const store = useWorktreesStore();

      const result = await store.addRepo("/new/repo");

      expect(result).toEqual(newRepo);
      // Should have refreshed the list via loadRegisteredRepos
      expect(mocks.listRegisteredRepos).toHaveBeenCalled();
      expect(store.registeredRepos).toHaveLength(2);
    });

    it("sets error and returns null on failure", async () => {
      mocks.addRegisteredRepo.mockRejectedValue(new Error("add error"));
      const store = useWorktreesStore();

      const result = await store.addRepo("/bad/path");

      expect(result).toBeNull();
      expect(store.error).toContain("add error");
    });
  });

  describe("removeRepo", () => {
    it("removes repo from list", async () => {
      mocks.removeRegisteredRepo.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

      const result = await store.removeRepo(FIXTURE_REPO.path);

      expect(result).toBe(true);
      expect(store.registeredRepos).toHaveLength(1);
      expect(store.registeredRepos[0].name).toBe("OtherProject");
    });

    it("cascades worktree removal for the removed repo", async () => {
      mocks.removeRegisteredRepo.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO];
      store.worktrees = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT]; // both repoRoot === REPO_PATH

      await store.removeRepo(REPO_PATH);

      // Both worktrees should be removed since they belong to the removed repo
      expect(store.worktrees).toHaveLength(0);
    });

    it("does not remove worktrees from other repos", async () => {
      mocks.removeRegisteredRepo.mockResolvedValue(undefined);
      const otherWt: WorktreeInfo = {
        ...FIXTURE_FEATURE_WT,
        repoRoot: FIXTURE_REPO_2.path,
        path: `${FIXTURE_REPO_2.path}/.worktrees/dev`,
      };
      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];
      store.worktrees = [FIXTURE_MAIN_WT, otherWt];

      await store.removeRepo(REPO_PATH);

      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].repoRoot).toBe(FIXTURE_REPO_2.path);
    });

    it("sets error and returns false on failure", async () => {
      mocks.removeRegisteredRepo.mockRejectedValue(new Error("remove error"));
      const store = useWorktreesStore();

      const result = await store.removeRepo("/some/path");

      expect(result).toBe(false);
      expect(store.error).toContain("remove error");
    });
  });

  describe("discoverRepos", () => {
    it("refreshes list when new repos discovered", async () => {
      const newRepo: RegisteredRepo = { ...FIXTURE_REPO_2 };
      mocks.discoverReposFromSessions.mockResolvedValue([newRepo]);
      mocks.listRegisteredRepos.mockResolvedValue([FIXTURE_REPO, newRepo]);
      const store = useWorktreesStore();

      const result = await store.discoverRepos();

      expect(result).toHaveLength(1);
      expect(mocks.listRegisteredRepos).toHaveBeenCalled();
    });

    it("does NOT refresh list when no repos discovered", async () => {
      mocks.discoverReposFromSessions.mockResolvedValue([]);
      const store = useWorktreesStore();

      const result = await store.discoverRepos();

      expect(result).toEqual([]);
      expect(mocks.listRegisteredRepos).not.toHaveBeenCalled();
    });

    it("sets error and returns empty on failure", async () => {
      mocks.discoverReposFromSessions.mockRejectedValue(new Error("discover error"));
      const store = useWorktreesStore();

      const result = await store.discoverRepos();

      expect(result).toEqual([]);
      expect(store.error).toContain("discover error");
    });
  });

  describe("toggleFavourite", () => {
    it("toggles favourite state on repo", async () => {
      mocks.toggleRepoFavourite.mockResolvedValue(false);
      const store = useWorktreesStore();
      store.registeredRepos = [{ ...FIXTURE_REPO, favourite: true }];

      await store.toggleFavourite(FIXTURE_REPO.path);

      expect(store.registeredRepos[0].favourite).toBe(false);
    });

    it("prevents concurrent toggle for the same path", async () => {
      const toggleDeferred = createDeferred<boolean>();
      mocks.toggleRepoFavourite.mockReturnValue(toggleDeferred.promise);
      const store = useWorktreesStore();
      store.registeredRepos = [{ ...FIXTURE_REPO }];

      // First toggle starts
      const call1 = store.toggleFavourite(FIXTURE_REPO.path);
      expect(store.togglingFavourites.has(FIXTURE_REPO.path)).toBe(true);

      // Second toggle for same path should be a no-op
      const call2 = store.toggleFavourite(FIXTURE_REPO.path);

      toggleDeferred.resolve(false);
      await call1;
      await call2;

      // Should only have been called once
      expect(mocks.toggleRepoFavourite).toHaveBeenCalledTimes(1);
      expect(store.togglingFavourites.has(FIXTURE_REPO.path)).toBe(false);
    });

    it("sets error on failure", async () => {
      mocks.toggleRepoFavourite.mockRejectedValue(new Error("toggle error"));
      const store = useWorktreesStore();
      store.registeredRepos = [{ ...FIXTURE_REPO }];

      await store.toggleFavourite(FIXTURE_REPO.path);

      expect(store.error).toContain("toggle error");
      expect(store.togglingFavourites.has(FIXTURE_REPO.path)).toBe(false);
    });
  });

  describe("sortedRegisteredRepos", () => {
    it("sorts favourites first, then alphabetically", () => {
      const store = useWorktreesStore();
      store.registeredRepos = [
        { ...FIXTURE_REPO_2, favourite: false, name: "Zebra" },
        { ...FIXTURE_REPO, favourite: true, name: "Alpha" },
        { ...FIXTURE_REPO, path: "/c", favourite: false, name: "Charlie" },
      ];

      const names = store.sortedRegisteredRepos.map((r) => r.name);
      expect(names).toEqual(["Alpha", "Charlie", "Zebra"]);
    });
  });
});
