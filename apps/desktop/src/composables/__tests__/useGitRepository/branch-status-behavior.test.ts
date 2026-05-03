import "./setup";
import { createDeferred } from "@tracepilot/test-utils";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useGitRepository } from "../../useGitRepository";
import { client, setupUseGitRepositoryTest } from "./setup";

setupUseGitRepositoryTest();

describe("useGitRepository branch and status behavior", () => {
  it("ignores stale default-branch success when repoPath changes", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    vi.mocked(client.getDefaultBranch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const repoPath = ref("/path/to/repo-a");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    repoPath.value = "/path/to/repo-b";
    await nextTick();

    second.resolve("develop");
    await flushPromises();
    expect(defaultBranch.value).toBe("develop");

    first.resolve("main");
    await flushPromises();
    expect(defaultBranch.value).toBe("develop");
  });

  it("ignores stale default-branch errors after a newer success", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    vi.mocked(client.getDefaultBranch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const repoPath = ref("/path/to/repo-a");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    repoPath.value = "/path/to/repo-b";
    await nextTick();

    second.resolve("release");
    await flushPromises();
    expect(defaultBranch.value).toBe("release");

    first.reject(new Error("old error"));
    await flushPromises();
    expect(defaultBranch.value).toBe("release");
  });

  it("clears the visible default branch immediately while a new repo is loading", async () => {
    const second = createDeferred<string>();
    vi.mocked(client.getDefaultBranch)
      .mockResolvedValueOnce("main")
      .mockReturnValueOnce(second.promise);

    const repoPath = ref("/path/to/repo-a");
    const { defaultBranch } = useGitRepository({ repoPath });

    await flushPromises();
    expect(defaultBranch.value).toBe("main");

    repoPath.value = "/path/to/repo-b";
    await nextTick();
    expect(defaultBranch.value).toBe("");

    second.resolve("develop");
    await flushPromises();
    expect(defaultBranch.value).toBe("develop");
  });

  it("uses guard tokens rather than path matching for rapid A→B→A switches", async () => {
    const firstA = createDeferred<string>();
    const branchB = createDeferred<string>();
    const secondA = createDeferred<string>();
    vi.mocked(client.getDefaultBranch)
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(branchB.promise)
      .mockReturnValueOnce(secondA.promise);

    const repoPath = ref("/path/to/repo-a");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    repoPath.value = "/path/to/repo-b";
    await nextTick();
    repoPath.value = "/path/to/repo-a";
    await nextTick();

    secondA.resolve("latest-a");
    await flushPromises();
    expect(defaultBranch.value).toBe("latest-a");

    branchB.resolve("branch-b");
    firstA.resolve("old-a");
    await flushPromises();
    expect(defaultBranch.value).toBe("latest-a");
  });

  it("manual loadDefaultBranch supersedes an in-flight watcher request", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    vi.mocked(client.getDefaultBranch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const repoPath = ref("/path/to/repo");
    const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

    await nextTick();

    const manualLoad = loadDefaultBranch();
    second.resolve("manual");
    await manualLoad;
    expect(defaultBranch.value).toBe("manual");

    first.resolve("watcher");
    await flushPromises();
    expect(defaultBranch.value).toBe("manual");
  });

  it("should fetch from remote and set loading state", async () => {
    vi.mocked(client.fetchRemote).mockResolvedValue("");
    const onFetchSuccess = vi.fn();

    const repoPath = ref("/path/to/repo");
    const { fetchRemote, fetchingRemote } = useGitRepository({
      repoPath,
      onFetchSuccess,
    });

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

  it("treats overlapping fetchRemote calls as latest-wins for callbacks and loading", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    vi.mocked(client.fetchRemote)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onFetchSuccess = vi.fn();

    const repoPath = ref("/path/to/repo");
    const { fetchRemote, fetchingRemote } = useGitRepository({ repoPath, onFetchSuccess });

    await flushPromises();

    const firstPromise = fetchRemote();
    const secondPromise = fetchRemote();
    expect(fetchingRemote.value).toBe(true);

    second.resolve("");
    await secondPromise;
    expect(fetchingRemote.value).toBe(false);
    expect(onFetchSuccess).toHaveBeenCalledTimes(1);

    first.resolve("");
    await firstPromise;
    expect(fetchingRemote.value).toBe(false);
    expect(onFetchSuccess).toHaveBeenCalledTimes(1);
  });

  it("should maintain reactivity of defaultBranch", async () => {
    vi.mocked(client.getDefaultBranch)
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce("develop");

    const repoPath = ref("/path/to/repo1");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    await nextTick();
    expect(defaultBranch.value).toBe("main");

    repoPath.value = "/path/to/repo2";
    await nextTick();
    await nextTick();

    expect(defaultBranch.value).toBe("develop");
  });

  it("should maintain reactivity of fetchingRemote", async () => {
    let resolvePromise!: () => void;
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

    resolvePromise();
    await fetchPromise;

    expect(fetchingRemote.value).toBe(false);
  });
});
