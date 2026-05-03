import "./setup";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useGitRepository } from "../../useGitRepository";
import { setupUseGitRepositoryTest } from "./setup";

setupUseGitRepositoryTest();

describe("useGitRepository path handling", () => {
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
