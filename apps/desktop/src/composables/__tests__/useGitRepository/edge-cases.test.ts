import "./setup";
import { createDeferred } from "@tracepilot/test-utils";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useGitRepository } from "../../useGitRepository";
import { client, setupUseGitRepositoryTest } from "./setup";

setupUseGitRepositoryTest();

describe("useGitRepository edge cases", () => {
  it("suppresses stale default-branch completion after repoPath is cleared", async () => {
    const pendingBranch = createDeferred<string>();
    vi.mocked(client.getDefaultBranch).mockReturnValueOnce(pendingBranch.promise);

    const repoPath = ref("/path/to/repo-a");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    repoPath.value = "";
    await nextTick();
    expect(defaultBranch.value).toBe("");

    pendingBranch.resolve("main");
    await flushPromises();
    expect(defaultBranch.value).toBe("");
  });

  it("should not fetch when repoPath is empty", async () => {
    const repoPath = ref("");
    const { fetchRemote } = useGitRepository({ repoPath });

    await nextTick();
    await fetchRemote();

    expect(client.fetchRemote).not.toHaveBeenCalled();
  });

  it("should work without callbacks", async () => {
    vi.mocked(client.fetchRemote).mockResolvedValue("");

    const repoPath = ref("/path/to/repo");
    const { fetchRemote } = useGitRepository({ repoPath });

    await nextTick();
    await nextTick();

    await expect(fetchRemote()).resolves.not.toThrow();
  });

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

  it("suppresses stale fetch completion after repo changes", async () => {
    const pendingFetch = createDeferred<string>();
    vi.mocked(client.fetchRemote).mockReturnValueOnce(pendingFetch.promise);
    const onFetchSuccess = vi.fn();

    const repoPath = ref("/path/to/repo-a");
    const { fetchRemote, fetchingRemote } = useGitRepository({ repoPath, onFetchSuccess });

    await flushPromises();

    const fetchPromise = fetchRemote();
    expect(fetchingRemote.value).toBe(true);

    repoPath.value = "/path/to/repo-b";
    await nextTick();
    expect(fetchingRemote.value).toBe(false);

    pendingFetch.resolve("");
    await fetchPromise;

    expect(fetchingRemote.value).toBe(false);
    expect(onFetchSuccess).not.toHaveBeenCalled();
  });

  it("suppresses stale fetch errors after repo is cleared", async () => {
    const pendingFetch = createDeferred<string>();
    vi.mocked(client.fetchRemote).mockReturnValueOnce(pendingFetch.promise);
    const onFetchError = vi.fn();

    const repoPath = ref("/path/to/repo");
    const { fetchRemote, fetchingRemote } = useGitRepository({ repoPath, onFetchError });

    await flushPromises();

    const fetchPromise = fetchRemote();
    expect(fetchingRemote.value).toBe(true);

    repoPath.value = "";
    await nextTick();
    expect(fetchingRemote.value).toBe(false);

    pendingFetch.reject(new Error("old fetch failed"));
    await fetchPromise;

    expect(fetchingRemote.value).toBe(false);
    expect(onFetchError).not.toHaveBeenCalled();
  });
});
