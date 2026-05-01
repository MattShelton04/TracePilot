// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import {
  FIXTURE_REPOS,
  FIXTURE_WORKTREES,
  mockLogWarn,
  mockListRegisteredRepos,
  mockListWorktrees,
} from "./setup";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";
import { describe, expect, it } from "vitest";

describe("useOrchestrationHomeStore - worktree stats", () => {
  describe("loadWorktreeStatsFromRegistry", () => {
    it("aggregates stats from multiple repos correctly", async () => {
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees
        .mockResolvedValueOnce(FIXTURE_WORKTREES) // First repo
        .mockResolvedValueOnce([]); // Second repo (empty)

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      expect(store.registeredRepos).toEqual(FIXTURE_REPOS);
      expect(store.worktreeCount).toBe(3);
      expect(store.staleWorktreeCount).toBe(1);
      expect(store.totalDiskUsage).toBe(1024 * 1024 * 180); // 50+30+100 MB
    });

    it("handles repos with no worktrees gracefully", async () => {
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      expect(store.worktreeCount).toBe(0);
      expect(store.staleWorktreeCount).toBe(0);
      expect(store.totalDiskUsage).toBe(0);
    });

    it("skips failed repos without blocking others", async () => {
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees
        .mockRejectedValueOnce(new Error("Repo 1 failed"))
        .mockResolvedValueOnce(FIXTURE_WORKTREES);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      // Should still aggregate from successful repo
      expect(store.worktreeCount).toBe(3);
      expect(store.staleWorktreeCount).toBe(1);
      expect(mockLogWarn).toHaveBeenCalledWith(
        "[worktrees] Failed to load worktrees for repo",
        expect.objectContaining({ repo: FIXTURE_REPOS[0].path }),
      );
    });

    it("handles empty repos list gracefully", async () => {
      mockListRegisteredRepos.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      expect(store.registeredRepos).toEqual([]);
      expect(store.worktreeCount).toBe(0);
    });
  });

  describe("loadWorktreeStats", () => {
    it("loads stats for a single repo", async () => {
      mockListWorktrees.mockResolvedValue(FIXTURE_WORKTREES);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStats("/home/user/repos/TracePilot");

      expect(store.worktreeCount).toBe(3);
      expect(store.staleWorktreeCount).toBe(1);
      expect(store.totalDiskUsage).toBe(1024 * 1024 * 180);
    });

    it("skips silently if repoPath is null", async () => {
      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStats(undefined);

      expect(mockListWorktrees).not.toHaveBeenCalled();
      expect(store.worktreeCount).toBe(0);
    });

    it("handles fetch errors gracefully", async () => {
      mockListWorktrees.mockRejectedValue(new Error("Network error"));

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStats("/home/user/repos/TracePilot");

      // Should not throw, should not update stats
      expect(store.worktreeCount).toBe(0);
    });
  });
});
