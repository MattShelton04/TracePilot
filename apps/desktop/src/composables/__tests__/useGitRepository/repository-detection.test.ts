import "./setup";
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useGitRepository } from "../../useGitRepository";
import { client, setupUseGitRepositoryTest } from "./setup";

setupUseGitRepositoryTest();

describe("useGitRepository repository detection", () => {
  it("should load default branch on mount when repoPath is provided", async () => {
    vi.mocked(client.getDefaultBranch).mockResolvedValue("main");
    const repoPath = ref("/path/to/repo");

    const { defaultBranch } = useGitRepository({ repoPath });

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

  it("should not load default branch when repoPath is empty initially", async () => {
    const repoPath = ref("");
    const { defaultBranch } = useGitRepository({ repoPath });

    await nextTick();
    await nextTick();

    expect(client.getDefaultBranch).not.toHaveBeenCalled();
    expect(defaultBranch.value).toBe("");
  });

  it("should manually load default branch", async () => {
    vi.mocked(client.getDefaultBranch).mockResolvedValue("develop");

    const repoPath = ref("");
    const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

    repoPath.value = "/path/to/repo";
    await loadDefaultBranch();

    expect(defaultBranch.value).toBe("develop");
  });

  it("should not manually load when repoPath is empty", async () => {
    const repoPath = ref("");
    const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

    await loadDefaultBranch();

    expect(client.getDefaultBranch).not.toHaveBeenCalled();
    expect(defaultBranch.value).toBe("");
  });
});
