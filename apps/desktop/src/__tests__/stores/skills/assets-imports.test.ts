// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  ALL_SUMMARIES,
  FIXTURE_ASSET,
  FIXTURE_IMPORT_RESULT,
  FIXTURE_SUMMARY,
  mocks,
  setupSkillsStoreTest,
} from "./setup";
import { useSkillsStore } from "../../../stores/skills";

setupSkillsStoreTest();

describe("useSkillsStore", () => {
  // ── listAssets ─────────────────────────────────────────────
  describe("listAssets", () => {
    it("returns assets on success", async () => {
      mocks.skillsListAssets.mockResolvedValue([FIXTURE_ASSET]);
      const store = useSkillsStore();

      const result = await store.listAssets(FIXTURE_SUMMARY.directory);

      expect(result).toEqual([FIXTURE_ASSET]);
    });

    it("returns empty array and logs warning on failure", async () => {
      mocks.skillsListAssets.mockRejectedValue(new Error("list failed"));
      const store = useSkillsStore();

      const result = await store.listAssets("/dir");

      expect(result).toEqual([]);
      expect(mocks.logWarn).toHaveBeenCalledWith(
        "[skills] Failed to list assets",
        expect.objectContaining({ dir: "/dir" }),
      );
    });
  });

  // ── addAsset ───────────────────────────────────────────────
  describe("addAsset", () => {
    it("returns true on success", async () => {
      mocks.skillsAddAsset.mockResolvedValue(undefined);
      const store = useSkillsStore();

      const result = await store.addAsset(FIXTURE_SUMMARY.directory, "file.md", [1, 2, 3]);

      expect(result).toBe(true);
      expect(mocks.skillsAddAsset).toHaveBeenCalledWith(
        FIXTURE_SUMMARY.directory,
        "file.md",
        [1, 2, 3],
      );
    });

    it("returns false and sets error on failure", async () => {
      mocks.skillsAddAsset.mockRejectedValue(new Error("add asset failed"));
      const store = useSkillsStore();

      const result = await store.addAsset("/dir", "file.md", [1]);

      expect(result).toBe(false);
      expect(store.error).toBe("add asset failed");
    });
  });

  // ── removeAsset ────────────────────────────────────────────
  describe("removeAsset", () => {
    it("returns true on success", async () => {
      mocks.skillsRemoveAsset.mockResolvedValue(undefined);
      const store = useSkillsStore();

      const result = await store.removeAsset(FIXTURE_SUMMARY.directory, "file.md");

      expect(result).toBe(true);
      expect(mocks.skillsRemoveAsset).toHaveBeenCalledWith(FIXTURE_SUMMARY.directory, "file.md");
    });

    it("returns false and sets error on failure", async () => {
      mocks.skillsRemoveAsset.mockRejectedValue(new Error("remove asset failed"));
      const store = useSkillsStore();

      const result = await store.removeAsset("/dir", "file.md");

      expect(result).toBe(false);
      expect(store.error).toBe("remove asset failed");
    });
  });

  // ── importLocal ────────────────────────────────────────────
  describe("importLocal", () => {
    it("returns result and reloads skills on success", async () => {
      mocks.skillsImportLocal.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.importLocal("/source/dir");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mocks.skillsImportLocal).toHaveBeenCalledWith("/source/dir", undefined, undefined);
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsImportLocal.mockRejectedValue(new Error("import local failed"));
      const store = useSkillsStore();

      const result = await store.importLocal("/bad/dir");

      expect(result).toBeNull();
      expect(store.error).toBe("import local failed");
    });
  });

  // ── importFile ─────────────────────────────────────────────
  describe("importFile", () => {
    it("returns result and reloads skills on success", async () => {
      mocks.skillsImportFile.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.importFile("/path/to/file.md");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mocks.skillsImportFile).toHaveBeenCalledWith("/path/to/file.md", undefined, undefined);
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsImportFile.mockRejectedValue(new Error("import file failed"));
      const store = useSkillsStore();

      const result = await store.importFile("/bad/path.md");

      expect(result).toBeNull();
      expect(store.error).toBe("import file failed");
    });
  });

  // ── importGitHub ───────────────────────────────────────────
  describe("importGitHub", () => {
    it("returns result and reloads skills on success", async () => {
      mocks.skillsImportGitHub.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.importGitHub("owner", "repo", "skills/review", "main");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mocks.skillsImportGitHub).toHaveBeenCalledWith(
        "owner",
        "repo",
        "skills/review",
        "main",
        undefined,
        undefined,
      );
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsImportGitHub.mockRejectedValue(new Error("github import failed"));
      const store = useSkillsStore();

      const result = await store.importGitHub("owner", "repo");

      expect(result).toBeNull();
      expect(store.error).toBe("github import failed");
    });
  });
});
