import "./useGitRepository/setup";
import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { useGitRepository } from "../useGitRepository";
import { client, setupUseGitRepositoryTest } from "./useGitRepository/setup";

setupUseGitRepositoryTest();

describe("useGitRepository", () => {
  it("exposes repository operations with initial empty state", async () => {
    const repoPath = ref("");
    const { computeWorktreePath, defaultBranch, fetchRemote, fetchingRemote, loadDefaultBranch } =
      useGitRepository({ repoPath });

    await nextTick();

    expect(defaultBranch.value).toBe("");
    expect(fetchingRemote.value).toBe(false);
    expect(computeWorktreePath("feature/test")).toBe("");
    expect(fetchRemote).toEqual(expect.any(Function));
    expect(loadDefaultBranch).toEqual(expect.any(Function));
    expect(client.getDefaultBranch).not.toHaveBeenCalled();
  });
});
