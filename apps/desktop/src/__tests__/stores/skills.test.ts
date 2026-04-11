import type { Skill, SkillAsset, SkillImportResult, SkillSummary } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSkillsStore } from "../../stores/skills";
import { createDeferred } from "../helpers/deferred";

// ── Mock client functions ──────────────────────────────────────
const mockSkillsListAll = vi.fn();
const mockSkillsGetSkill = vi.fn();
const mockSkillsCreate = vi.fn();
const mockSkillsUpdate = vi.fn();
const mockSkillsUpdateRaw = vi.fn();
const mockSkillsDelete = vi.fn();
const mockSkillsRename = vi.fn();
const mockSkillsDuplicate = vi.fn();
const mockSkillsListAssets = vi.fn();
const mockSkillsAddAsset = vi.fn();
const mockSkillsRemoveAsset = vi.fn();
const mockSkillsImportLocal = vi.fn();
const mockSkillsImportFile = vi.fn();
const mockSkillsImportGitHub = vi.fn();
const mockSkillsDiscoverRepos = vi.fn();

vi.mock("@tracepilot/client", () => ({
  skillsListAll: (...args: unknown[]) => mockSkillsListAll(...args),
  skillsGetSkill: (...args: unknown[]) => mockSkillsGetSkill(...args),
  skillsCreate: (...args: unknown[]) => mockSkillsCreate(...args),
  skillsUpdate: (...args: unknown[]) => mockSkillsUpdate(...args),
  skillsUpdateRaw: (...args: unknown[]) => mockSkillsUpdateRaw(...args),
  skillsDelete: (...args: unknown[]) => mockSkillsDelete(...args),
  skillsRename: (...args: unknown[]) => mockSkillsRename(...args),
  skillsDuplicate: (...args: unknown[]) => mockSkillsDuplicate(...args),
  skillsListAssets: (...args: unknown[]) => mockSkillsListAssets(...args),
  skillsAddAsset: (...args: unknown[]) => mockSkillsAddAsset(...args),
  skillsRemoveAsset: (...args: unknown[]) => mockSkillsRemoveAsset(...args),
  skillsImportLocal: (...args: unknown[]) => mockSkillsImportLocal(...args),
  skillsImportFile: (...args: unknown[]) => mockSkillsImportFile(...args),
  skillsImportGitHub: (...args: unknown[]) => mockSkillsImportGitHub(...args),
  skillsDiscoverRepos: (...args: unknown[]) => mockSkillsDiscoverRepos(...args),
}));

// ── Mock @tracepilot/ui ────────────────────────────────────────
vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

// ── Mock logger ────────────────────────────────────────────────
const mockLogWarn = vi.fn();
vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

// ── Fixtures ───────────────────────────────────────────────────
const FIXTURE_SUMMARY: SkillSummary = {
  name: "code-review",
  description: "Reviews code changes for quality",
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/code-review",
  enabled: true,
  estimatedTokens: 500,
  hasAssets: true,
  assetCount: 2,
};

const FIXTURE_SUMMARY_REPO: SkillSummary = {
  name: "test-gen",
  description: "Generates unit tests",
  scope: "repository",
  directory: "/home/user/repos/project/.copilot/skills/test-gen",
  enabled: false,
  estimatedTokens: 300,
  hasAssets: false,
  assetCount: 0,
};

const FIXTURE_SUMMARY_DISABLED: SkillSummary = {
  name: "api-docs",
  description: "Generates API documentation",
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/api-docs",
  enabled: false,
  estimatedTokens: 200,
  hasAssets: false,
  assetCount: 0,
};

const FIXTURE_SKILL: Skill = {
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/code-review",
  enabled: true,
  estimatedTokens: 500,
  frontmatter: {
    name: "code-review",
    description: "Reviews code changes for quality",
  },
  body: "Review the code for quality issues.",
  rawContent:
    "---\nname: code-review\ndescription: Reviews code changes for quality\n---\nReview the code for quality issues.",
};

const FIXTURE_ASSET: SkillAsset = {
  path: "/home/user/.config/github-copilot/skills/code-review/checklist.md",
  name: "checklist.md",
  sizeBytes: 1024,
  isDirectory: false,
};

const FIXTURE_IMPORT_RESULT: SkillImportResult = {
  skillName: "imported-skill",
  destination: "/home/user/.config/github-copilot/skills/imported-skill",
  warnings: [],
  filesCopied: 3,
};

const ALL_SUMMARIES: SkillSummary[] = [
  FIXTURE_SUMMARY,
  FIXTURE_SUMMARY_REPO,
  FIXTURE_SUMMARY_DISABLED,
];

// ── Helpers ────────────────────────────────────────────────────
function allMocks() {
  return [
    mockSkillsListAll,
    mockSkillsGetSkill,
    mockSkillsCreate,
    mockSkillsUpdate,
    mockSkillsUpdateRaw,
    mockSkillsDelete,
    mockSkillsRename,
    mockSkillsDuplicate,
    mockSkillsListAssets,
    mockSkillsAddAsset,
    mockSkillsRemoveAsset,
    mockSkillsImportLocal,
    mockSkillsImportFile,
    mockSkillsImportGitHub,
    mockLogWarn,
  ];
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════
describe("useSkillsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const mock of allMocks()) mock.mockReset();
  });

  afterEach(async () => {
    await flushPromises();
  });

  // ── Initialization ─────────────────────────────────────────
  describe("initialization", () => {
    it("starts with empty skills", () => {
      const store = useSkillsStore();
      expect(store.skills).toEqual([]);
    });

    it("starts with selectedSkill null", () => {
      const store = useSkillsStore();
      expect(store.selectedSkill).toBeNull();
    });

    it("starts with loading false", () => {
      const store = useSkillsStore();
      expect(store.loading).toBe(false);
    });

    it("starts with no error", () => {
      const store = useSkillsStore();
      expect(store.error).toBeNull();
    });

    it("starts with empty searchQuery", () => {
      const store = useSkillsStore();
      expect(store.searchQuery).toBe("");
    });

    it("defaults filterScope to 'all'", () => {
      const store = useSkillsStore();
      expect(store.filterScope).toBe("all");
    });
  });

  // ── loadSkills ─────────────────────────────────────────────
  describe("loadSkills", () => {
    it("populates skills array on success", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      await store.loadSkills();

      expect(store.skills).toHaveLength(3);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("passes repoRoot to client function", async () => {
      mockSkillsListAll.mockResolvedValue([]);
      const store = useSkillsStore();

      await store.loadSkills("/some/repo");

      expect(mockSkillsListAll).toHaveBeenCalledWith("/some/repo");
    });

    it("sets loading to true during fetch", async () => {
      mockSkillsListAll.mockResolvedValue([]);
      const store = useSkillsStore();

      const promise = store.loadSkills();
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockSkillsListAll.mockRejectedValue(new Error("network error"));
      const store = useSkillsStore();

      await store.loadSkills();

      expect(store.error).toBe("network error");
      expect(store.loading).toBe(false);
    });

    it("discards stale response when newer load is in progress", async () => {
      const firstDeferred = createDeferred<SkillSummary[]>();
      mockSkillsListAll
        .mockReturnValueOnce(firstDeferred.promise)
        .mockResolvedValueOnce([{ ...FIXTURE_SUMMARY_REPO }]);

      const store = useSkillsStore();

      const call1 = store.loadSkills();
      const call2 = store.loadSkills(); // invalidates first call's token

      await call2;
      await flushPromises();
      expect(store.skills).toHaveLength(1);
      expect(store.skills[0].name).toBe("test-gen");

      // Now resolve first call — should be discarded
      firstDeferred.resolve(ALL_SUMMARIES.map((s) => ({ ...s })));
      await call1;
      await flushPromises();
      // Skills should still be from call2 (stale result discarded)
      expect(store.skills).toHaveLength(1);
      expect(store.skills[0].name).toBe("test-gen");
    });
  });

  // ── getSkill ───────────────────────────────────────────────
  describe("getSkill", () => {
    it("returns skill and sets selectedSkill on success", async () => {
      mockSkillsGetSkill.mockResolvedValue(FIXTURE_SKILL);
      const store = useSkillsStore();

      const result = await store.getSkill(FIXTURE_SKILL.directory);

      expect(result).toEqual(FIXTURE_SKILL);
      expect(store.selectedSkill).toEqual(FIXTURE_SKILL);
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsGetSkill.mockRejectedValue(new Error("not found"));
      const store = useSkillsStore();

      const result = await store.getSkill("/nonexistent");

      expect(result).toBeNull();
      expect(store.error).toBe("not found");
    });
  });

  // ── createSkill ────────────────────────────────────────────
  describe("createSkill", () => {
    it("returns directory and reloads skills on success", async () => {
      const newDir = "/home/user/.config/github-copilot/skills/new-skill";
      mockSkillsCreate.mockResolvedValue(newDir);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.createSkill("new-skill", "A new skill", "body text");

      expect(result).toBe(newDir);
      expect(mockSkillsCreate).toHaveBeenCalledWith("new-skill", "A new skill", "body text");
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsCreate.mockRejectedValue(new Error("create failed"));
      const store = useSkillsStore();

      const result = await store.createSkill("bad-skill", "desc", "body");

      expect(result).toBeNull();
      expect(store.error).toBe("create failed");
    });
  });

  // ── updateSkill ────────────────────────────────────────────
  describe("updateSkill", () => {
    it("returns true and reloads skills on success", async () => {
      mockSkillsUpdate.mockResolvedValue(undefined);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      const fm = { name: "code-review", description: "Updated desc" };

      const result = await store.updateSkill(FIXTURE_SKILL.directory, fm, "new body");

      expect(result).toBe(true);
      expect(mockSkillsUpdate).toHaveBeenCalledWith(FIXTURE_SKILL.directory, fm, "new body");
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns false and sets error on failure", async () => {
      mockSkillsUpdate.mockRejectedValue(new Error("update failed"));
      const store = useSkillsStore();

      const result = await store.updateSkill("/dir", { name: "x", description: "y" }, "b");

      expect(result).toBe(false);
      expect(store.error).toBe("update failed");
    });
  });

  // ── updateSkillRaw ─────────────────────────────────────────
  describe("updateSkillRaw", () => {
    it("returns true and reloads skills on success", async () => {
      mockSkillsUpdateRaw.mockResolvedValue(undefined);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.updateSkillRaw(FIXTURE_SKILL.directory, "raw content");

      expect(result).toBe(true);
      expect(mockSkillsUpdateRaw).toHaveBeenCalledWith(FIXTURE_SKILL.directory, "raw content");
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns false and sets error on failure", async () => {
      mockSkillsUpdateRaw.mockRejectedValue(new Error("raw update failed"));
      const store = useSkillsStore();

      const result = await store.updateSkillRaw("/dir", "content");

      expect(result).toBe(false);
      expect(store.error).toBe("raw update failed");
    });
  });

  // ── deleteSkill ────────────────────────────────────────────
  describe("deleteSkill", () => {
    it("removes skill from array on success", async () => {
      mockSkillsDelete.mockResolvedValue(undefined);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      // Pre-populate
      await store.loadSkills();
      expect(store.skills).toHaveLength(3);

      const result = await store.deleteSkill(FIXTURE_SUMMARY.directory);

      expect(result).toBe(true);
      expect(store.skills.find((s) => s.directory === FIXTURE_SUMMARY.directory)).toBeUndefined();
    });

    it("clears selectedSkill if it matches deleted directory", async () => {
      mockSkillsDelete.mockResolvedValue(undefined);
      mockSkillsGetSkill.mockResolvedValue(FIXTURE_SKILL);
      const store = useSkillsStore();

      // Set selectedSkill
      await store.getSkill(FIXTURE_SKILL.directory);
      expect(store.selectedSkill).not.toBeNull();

      await store.deleteSkill(FIXTURE_SKILL.directory);

      expect(store.selectedSkill).toBeNull();
    });

    it("does not clear selectedSkill if it does not match", async () => {
      mockSkillsDelete.mockResolvedValue(undefined);
      mockSkillsGetSkill.mockResolvedValue(FIXTURE_SKILL);
      const store = useSkillsStore();

      await store.getSkill(FIXTURE_SKILL.directory);
      await store.deleteSkill("/some/other/directory");

      expect(store.selectedSkill).toEqual(FIXTURE_SKILL);
    });

    it("returns false and sets error on failure", async () => {
      mockSkillsDelete.mockRejectedValue(new Error("delete failed"));
      const store = useSkillsStore();

      const result = await store.deleteSkill("/dir");

      expect(result).toBe(false);
      expect(store.error).toBe("delete failed");
    });
  });

  // ── renameSkill ────────────────────────────────────────────
  describe("renameSkill", () => {
    it("returns new directory and reloads on success", async () => {
      const newDir = "/home/user/.config/github-copilot/skills/renamed-skill";
      mockSkillsRename.mockResolvedValue(newDir);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.renameSkill(FIXTURE_SUMMARY.directory, "renamed-skill");

      expect(result).toBe(newDir);
      expect(mockSkillsRename).toHaveBeenCalledWith(FIXTURE_SUMMARY.directory, "renamed-skill");
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsRename.mockRejectedValue(new Error("rename failed"));
      const store = useSkillsStore();

      const result = await store.renameSkill("/dir", "new-name");

      expect(result).toBeNull();
      expect(store.error).toBe("rename failed");
    });
  });

  // ── duplicateSkill ─────────────────────────────────────────
  describe("duplicateSkill", () => {
    it("returns new directory and reloads on success", async () => {
      const newDir = "/home/user/.config/github-copilot/skills/code-review-copy";
      mockSkillsDuplicate.mockResolvedValue(newDir);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.duplicateSkill(FIXTURE_SUMMARY.directory, "code-review-copy");

      expect(result).toBe(newDir);
      expect(mockSkillsDuplicate).toHaveBeenCalledWith(
        FIXTURE_SUMMARY.directory,
        "code-review-copy",
      );
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsDuplicate.mockRejectedValue(new Error("duplicate failed"));
      const store = useSkillsStore();

      const result = await store.duplicateSkill("/dir", "copy");

      expect(result).toBeNull();
      expect(store.error).toBe("duplicate failed");
    });
  });

  // ── listAssets ─────────────────────────────────────────────
  describe("listAssets", () => {
    it("returns assets on success", async () => {
      mockSkillsListAssets.mockResolvedValue([FIXTURE_ASSET]);
      const store = useSkillsStore();

      const result = await store.listAssets(FIXTURE_SUMMARY.directory);

      expect(result).toEqual([FIXTURE_ASSET]);
    });

    it("returns empty array and logs warning on failure", async () => {
      mockSkillsListAssets.mockRejectedValue(new Error("list failed"));
      const store = useSkillsStore();

      const result = await store.listAssets("/dir");

      expect(result).toEqual([]);
      expect(mockLogWarn).toHaveBeenCalledWith(
        "[skills] Failed to list assets",
        expect.objectContaining({ dir: "/dir" }),
      );
    });
  });

  // ── addAsset ───────────────────────────────────────────────
  describe("addAsset", () => {
    it("returns true on success", async () => {
      mockSkillsAddAsset.mockResolvedValue(undefined);
      const store = useSkillsStore();

      const result = await store.addAsset(FIXTURE_SUMMARY.directory, "file.md", [1, 2, 3]);

      expect(result).toBe(true);
      expect(mockSkillsAddAsset).toHaveBeenCalledWith(
        FIXTURE_SUMMARY.directory,
        "file.md",
        [1, 2, 3],
      );
    });

    it("returns false and sets error on failure", async () => {
      mockSkillsAddAsset.mockRejectedValue(new Error("add asset failed"));
      const store = useSkillsStore();

      const result = await store.addAsset("/dir", "file.md", [1]);

      expect(result).toBe(false);
      expect(store.error).toBe("add asset failed");
    });
  });

  // ── removeAsset ────────────────────────────────────────────
  describe("removeAsset", () => {
    it("returns true on success", async () => {
      mockSkillsRemoveAsset.mockResolvedValue(undefined);
      const store = useSkillsStore();

      const result = await store.removeAsset(FIXTURE_SUMMARY.directory, "file.md");

      expect(result).toBe(true);
      expect(mockSkillsRemoveAsset).toHaveBeenCalledWith(FIXTURE_SUMMARY.directory, "file.md");
    });

    it("returns false and sets error on failure", async () => {
      mockSkillsRemoveAsset.mockRejectedValue(new Error("remove asset failed"));
      const store = useSkillsStore();

      const result = await store.removeAsset("/dir", "file.md");

      expect(result).toBe(false);
      expect(store.error).toBe("remove asset failed");
    });
  });

  // ── importLocal ────────────────────────────────────────────
  describe("importLocal", () => {
    it("returns result and reloads skills on success", async () => {
      mockSkillsImportLocal.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.importLocal("/source/dir");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mockSkillsImportLocal).toHaveBeenCalledWith("/source/dir", undefined, undefined);
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsImportLocal.mockRejectedValue(new Error("import local failed"));
      const store = useSkillsStore();

      const result = await store.importLocal("/bad/dir");

      expect(result).toBeNull();
      expect(store.error).toBe("import local failed");
    });
  });

  // ── importFile ─────────────────────────────────────────────
  describe("importFile", () => {
    it("returns result and reloads skills on success", async () => {
      mockSkillsImportFile.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.importFile("/path/to/file.md");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mockSkillsImportFile).toHaveBeenCalledWith("/path/to/file.md", undefined, undefined);
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsImportFile.mockRejectedValue(new Error("import file failed"));
      const store = useSkillsStore();

      const result = await store.importFile("/bad/path.md");

      expect(result).toBeNull();
      expect(store.error).toBe("import file failed");
    });
  });

  // ── importGitHub ───────────────────────────────────────────
  describe("importGitHub", () => {
    it("returns result and reloads skills on success", async () => {
      mockSkillsImportGitHub.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.importGitHub("owner", "repo", "skills/review", "main");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mockSkillsImportGitHub).toHaveBeenCalledWith(
        "owner",
        "repo",
        "skills/review",
        "main",
        undefined,
        undefined,
      );
      expect(mockSkillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mockSkillsImportGitHub.mockRejectedValue(new Error("github import failed"));
      const store = useSkillsStore();

      const result = await store.importGitHub("owner", "repo");

      expect(result).toBeNull();
      expect(store.error).toBe("github import failed");
    });
  });

  // ── filteredSkills (computed) ──────────────────────────────
  describe("filteredSkills", () => {
    it("returns all skills sorted by name when no filters applied", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      const names = store.filteredSkills.map((s) => s.name);
      expect(names).toEqual(["api-docs", "code-review", "test-gen"]);
    });

    it("filters by searchQuery on name", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.searchQuery = "code";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("code-review");
    });

    it("filters by searchQuery on description", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.searchQuery = "unit tests";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("test-gen");
    });

    it("filters by searchQuery case-insensitively", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.searchQuery = "CODE-REVIEW";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("code-review");
    });

    it("filters by scope 'global'", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.filterScope = "global";

      expect(store.filteredSkills).toHaveLength(2);
      expect(store.filteredSkills.every((s) => s.scope === "global")).toBe(true);
    });

    it("filters by scope 'repository'", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.filterScope = "repository";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].scope).toBe("repository");
    });

    it("combines scope and searchQuery filters", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.filterScope = "global";
      store.searchQuery = "api";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("api-docs");
    });
  });

  // ── tokenBudget (computed) ─────────────────────────────────
  describe("tokenBudget", () => {
    it("computes correctly from skills list", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      const budget = store.tokenBudget;

      expect(budget.totalSkills).toBe(3);
      expect(budget.enabledSkills).toBe(1); // only FIXTURE_SUMMARY is enabled
      expect(budget.totalTokens).toBe(500 + 300 + 200);
      expect(budget.enabledTokens).toBe(500);
    });

    it("returns zeros when no skills are loaded", () => {
      const store = useSkillsStore();

      const budget = store.tokenBudget;

      expect(budget.totalSkills).toBe(0);
      expect(budget.enabledSkills).toBe(0);
      expect(budget.totalTokens).toBe(0);
      expect(budget.enabledTokens).toBe(0);
    });
  });

  // ── globalSkills / repoSkills (computed) ───────────────────
  describe("globalSkills / repoSkills", () => {
    it("globalSkills returns only global-scope skills", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      expect(store.globalSkills).toHaveLength(2);
      expect(store.globalSkills.every((s) => s.scope === "global")).toBe(true);
    });

    it("repoSkills returns only repository-scope skills", async () => {
      mockSkillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      expect(store.repoSkills).toHaveLength(1);
      expect(store.repoSkills[0].scope).toBe("repository");
    });

    it("both return empty arrays when no skills are loaded", () => {
      const store = useSkillsStore();

      expect(store.globalSkills).toEqual([]);
      expect(store.repoSkills).toEqual([]);
    });
  });

  describe("discoverRepos", () => {
    it("returns results from batch scan", async () => {
      const mockResults = [
        {
          repoPath: "/repos/project-a",
          repoName: "project-a",
          skills: [
            {
              path: "/repos/project-a/.github/skills/test",
              name: "test",
              description: "Test skill",
              fileCount: 2,
            },
          ],
        },
        {
          repoPath: "/repos/project-b",
          repoName: "project-b",
          skills: [],
        },
      ];
      mockSkillsDiscoverRepos.mockResolvedValue(mockResults);

      const store = useSkillsStore();
      const results = await store.discoverRepos([
        ["/repos/project-a", "project-a"],
        ["/repos/project-b", "project-b"],
      ]);

      expect(mockSkillsDiscoverRepos).toHaveBeenCalledWith([
        ["/repos/project-a", "project-a"],
        ["/repos/project-b", "project-b"],
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].skills).toHaveLength(1);
      expect(results[1].skills).toHaveLength(0);
    });

    it("returns empty array and sets error on failure", async () => {
      mockSkillsDiscoverRepos.mockRejectedValue(new Error("Scan failed"));

      const store = useSkillsStore();
      const results = await store.discoverRepos([]);

      expect(results).toEqual([]);
      expect(store.error).toBe("Scan failed");
    });
  });
});
