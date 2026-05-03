import "./setup";
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useGitRepository } from "../../useGitRepository";
import { client, logger, setupUseGitRepositoryTest } from "./setup";

setupUseGitRepositoryTest();

describe("useGitRepository git command failures", () => {
  it("should handle errors gracefully when loading default branch", async () => {
    const error = new Error("Git error");
    vi.mocked(client.getDefaultBranch).mockRejectedValue(error);

    const repoPath = ref("/invalid/path");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    await nextTick();

    expect(defaultBranch.value).toBe("");
    expect(logger.logWarn).toHaveBeenCalledWith(
      "[useGitRepository] Failed to get default branch",
      { repoPath: "/invalid/path" },
      error,
    );
  });

  it("manual loadDefaultBranch should handle errors silently", async () => {
    const error = new Error("Error");
    vi.mocked(client.getDefaultBranch).mockRejectedValue(error);

    const repoPath = ref("/path/to/repo");
    const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

    await loadDefaultBranch();

    expect(defaultBranch.value).toBe("");
    expect(logger.logWarn).toHaveBeenCalledWith(
      "[useGitRepository] Failed to get default branch",
      { repoPath: "/path/to/repo" },
      error,
    );
  });

  it("should call onFetchError callback on failure", async () => {
    vi.mocked(client.fetchRemote).mockRejectedValue(new Error("Network error"));
    const onFetchError = vi.fn();

    const repoPath = ref("/path/to/repo");
    const { fetchRemote } = useGitRepository({
      repoPath,
      onFetchError,
    });

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
