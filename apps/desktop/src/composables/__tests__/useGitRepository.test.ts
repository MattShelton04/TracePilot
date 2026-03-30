import * as client from "@tracepilot/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useGitRepository } from "../useGitRepository";

// Mock the client functions
vi.mock("@tracepilot/client", () => ({
  getDefaultBranch: vi.fn(),
  fetchRemote: vi.fn(),
}));

// Mock UI utilities - these are simple path utilities
vi.mock("@tracepilot/ui", () => ({
  pathBasename: vi.fn((path: string) => path.split("/").pop() || path.split("\\").pop() || ""),
  pathDirname: vi.fn((path: string) => {
    const parts = path.split("/");
    if (parts.length > 1) return parts.slice(0, -1).join("/");
    const winParts = path.split("\\");
    if (winParts.length > 1) return winParts.slice(0, -1).join("\\");
    return "";
  }),
  sanitizeBranchForPath: vi.fn((branch: string) => branch.replace(/[/\\:*?"<>|#]/g, "-")),
}));

describe("useGitRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("defaultBranch loading", () => {
    it("should load default branch on mount when repoPath is provided", async () => {
      vi.mocked(client.getDefaultBranch).mockResolvedValue("main");
      const repoPath = ref("/path/to/repo");

      const { defaultBranch } = useGitRepository({ repoPath });

      // Wait for the watcher to trigger
      await nextTick();
      await nextTick();

      expect(client.getDefaultBranch).toHaveBeenCalledWith("/path/to/repo");
      expect(defaultBranch.value).toBe("main");
    });

    it("should update default branch when repoPath changes", async () => {
      vi.mocked(client.getDefaultBranch)
        .mockResolvedValueOnce("main")
        .mockResolvedValueOnce("master");

      const repoPath = ref("/path/to/repo1");
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();
      expect(defaultBranch.value).toBe("main");

      repoPath.value = "/path/to/repo2";
      await nextTick();
      await nextTick();

      expect(client.getDefaultBranch).toHaveBeenCalledWith("/path/to/repo2");
      expect(defaultBranch.value).toBe("master");
    });

    it("should clear default branch when repoPath becomes empty", async () => {
      vi.mocked(client.getDefaultBranch).mockResolvedValue("main");

      const repoPath = ref("/path/to/repo");
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();
      expect(defaultBranch.value).toBe("main");

      repoPath.value = "";
      await nextTick();

      expect(defaultBranch.value).toBe("");
    });

    it("should handle errors gracefully when loading default branch", async () => {
      vi.mocked(client.getDefaultBranch).mockRejectedValue(new Error("Git error"));

      const repoPath = ref("/invalid/path");
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      expect(defaultBranch.value).toBe("");
    });

    it("should not load default branch when repoPath is empty initially", async () => {
      const repoPath = ref("");
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      expect(client.getDefaultBranch).not.toHaveBeenCalled();
      expect(defaultBranch.value).toBe("");
    });
  });

  describe("fetchRemote", () => {
    it("should fetch from remote and set loading state", async () => {
      vi.mocked(client.fetchRemote).mockResolvedValue("");
      const onFetchSuccess = vi.fn();

      const repoPath = ref("/path/to/repo");
      const { fetchRemote, fetchingRemote } = useGitRepository({
        repoPath,
        onFetchSuccess,
      });

      // Wait for initial default branch load
      await nextTick();
      await nextTick();

      expect(fetchingRemote.value).toBe(false);

      const promise = fetchRemote();
      expect(fetchingRemote.value).toBe(true);

      await promise;

      expect(fetchingRemote.value).toBe(false);
      expect(client.fetchRemote).toHaveBeenCalledWith("/path/to/repo");
      expect(onFetchSuccess).toHaveBeenCalled();
    });

    it("should call onFetchError callback on failure", async () => {
      vi.mocked(client.fetchRemote).mockRejectedValue(new Error("Network error"));
      const onFetchError = vi.fn();

      const repoPath = ref("/path/to/repo");
      const { fetchRemote } = useGitRepository({
        repoPath,
        onFetchError,
      });

      // Wait for initial default branch load
      await nextTick();
      await nextTick();

      await fetchRemote();

      expect(onFetchError).toHaveBeenCalledWith("Network error");
    });

    it("should handle non-Error objects in catch block", async () => {
      vi.mocked(client.fetchRemote).mockRejectedValue("String error");
      const onFetchError = vi.fn();

      const repoPath = ref("/path/to/repo");
      const { fetchRemote } = useGitRepository({
        repoPath,
        onFetchError,
      });

      await nextTick();
      await nextTick();
      await fetchRemote();

      expect(onFetchError).toHaveBeenCalledWith("String error");
    });

    it("should not fetch when repoPath is empty", async () => {
      const repoPath = ref("");
      const { fetchRemote } = useGitRepository({ repoPath });

      await nextTick();
      await fetchRemote();

      expect(client.fetchRemote).not.toHaveBeenCalled();
    });

    it("should reset loading state even on error", async () => {
      vi.mocked(client.fetchRemote).mockRejectedValue(new Error("Error"));

      const repoPath = ref("/path/to/repo");
      const { fetchRemote, fetchingRemote } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      expect(fetchingRemote.value).toBe(false);

      const promise = fetchRemote();
      expect(fetchingRemote.value).toBe(true);

      await promise;

      expect(fetchingRemote.value).toBe(false);
    });

    it("should work without callbacks", async () => {
      vi.mocked(client.fetchRemote).mockResolvedValue("");

      const repoPath = ref("/path/to/repo");
      const { fetchRemote } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      await expect(fetchRemote()).resolves.not.toThrow();
    });
  });

  describe("computeWorktreePath", () => {
    it("should compute worktree path correctly", () => {
      const repoPath = ref("/home/user/repos/my-project");
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath("feature/new-feature");

      expect(path).toBe("/home/user/repos/my-project-feature-new-feature");
    });

    it("should sanitize branch names with special characters", () => {
      const repoPath = ref("/home/user/repos/my-project");
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath("feature/fix:bug#123");

      // Should sanitize special characters
      expect(path).toBe("/home/user/repos/my-project-feature-fix-bug-123");
    });

    it("should return empty string when repoPath is empty", () => {
      const repoPath = ref("");
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath("feature/test");

      expect(path).toBe("");
    });

    it("should return empty string when branchName is empty", () => {
      const repoPath = ref("/home/user/repos/my-project");
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath("");

      expect(path).toBe("");
    });

    it("should handle Windows paths correctly", () => {
      const repoPath = ref("C:\\Users\\user\\repos\\my-project");
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath("feature/test");

      expect(path).toContain("my-project-feature-test");
    });

    it("should handle complex branch names", () => {
      const repoPath = ref("/home/user/repos/my-project");
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath("feature/JIRA-123/fix-critical-bug");

      expect(path).toBe("/home/user/repos/my-project-feature-JIRA-123-fix-critical-bug");
    });
  });

  describe("loadDefaultBranch method", () => {
    it("should manually load default branch", async () => {
      vi.mocked(client.getDefaultBranch).mockResolvedValue("develop");

      const repoPath = ref("");
      const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

      repoPath.value = "/path/to/repo";
      await loadDefaultBranch();

      expect(defaultBranch.value).toBe("develop");
    });

    it("should not load when repoPath is empty", async () => {
      const repoPath = ref("");
      const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

      await loadDefaultBranch();

      expect(client.getDefaultBranch).not.toHaveBeenCalled();
      expect(defaultBranch.value).toBe("");
    });

    it("should handle errors silently", async () => {
      vi.mocked(client.getDefaultBranch).mockRejectedValue(new Error("Error"));

      const repoPath = ref("/path/to/repo");
      const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

      await loadDefaultBranch();

      expect(defaultBranch.value).toBe("");
    });
  });

  describe("callback integration", () => {
    it("should not throw when callbacks are not provided", async () => {
      vi.mocked(client.fetchRemote).mockResolvedValue("");

      const repoPath = ref("/path/to/repo");
      const { fetchRemote } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      await expect(fetchRemote()).resolves.not.toThrow();
    });

    it("should call onFetchSuccess with no arguments", async () => {
      vi.mocked(client.fetchRemote).mockResolvedValue("");
      const onFetchSuccess = vi.fn();

      const repoPath = ref("/path/to/repo");
      const { fetchRemote } = useGitRepository({
        repoPath,
        onFetchSuccess,
      });

      await nextTick();
      await nextTick();
      await fetchRemote();

      expect(onFetchSuccess).toHaveBeenCalledWith();
      expect(onFetchSuccess).toHaveBeenCalledTimes(1);
    });

    it("should call onFetchError with error message", async () => {
      vi.mocked(client.fetchRemote).mockRejectedValue(new Error("Test error"));
      const onFetchError = vi.fn();

      const repoPath = ref("/path/to/repo");
      const { fetchRemote } = useGitRepository({
        repoPath,
        onFetchError,
      });

      await nextTick();
      await nextTick();
      await fetchRemote();

      expect(onFetchError).toHaveBeenCalledWith("Test error");
      expect(onFetchError).toHaveBeenCalledTimes(1);
    });
  });

  describe("reactivity", () => {
    it("should maintain reactivity of defaultBranch", async () => {
      vi.mocked(client.getDefaultBranch)
        .mockResolvedValueOnce("main")
        .mockResolvedValueOnce("develop");

      const repoPath = ref("/path/to/repo1");
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();
      expect(defaultBranch.value).toBe("main");

      // Change repo path
      repoPath.value = "/path/to/repo2";
      await nextTick();
      await nextTick();

      expect(defaultBranch.value).toBe("develop");
    });

    it("should maintain reactivity of fetchingRemote", async () => {
      let resolvePromise: () => void;
      const promise = new Promise<string>((resolve) => {
        resolvePromise = () => resolve("");
      });
      vi.mocked(client.fetchRemote).mockReturnValue(promise);

      const repoPath = ref("/path/to/repo");
      const { fetchRemote, fetchingRemote } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      expect(fetchingRemote.value).toBe(false);

      const fetchPromise = fetchRemote();
      expect(fetchingRemote.value).toBe(true);

      resolvePromise!();
      await fetchPromise;

      expect(fetchingRemote.value).toBe(false);
    });
  });
});
