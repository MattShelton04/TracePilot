// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  ALL_SUMMARIES,
  FIXTURE_SKILL,
  FIXTURE_SUMMARY,
  mocks,
  setupSkillsStoreTest,
} from "./setup";
import { useSkillsStore } from "../../../stores/skills";

setupSkillsStoreTest();

describe("useSkillsStore", () => {
  // ── createSkill ────────────────────────────────────────────
  describe("createSkill", () => {
    it("returns directory and reloads skills on success", async () => {
      const newDir = "/home/user/.config/github-copilot/skills/new-skill";
      mocks.skillsCreate.mockResolvedValue(newDir);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.createSkill("new-skill", "A new skill", "body text");

      expect(result).toBe(newDir);
      expect(mocks.skillsCreate).toHaveBeenCalledWith("new-skill", "A new skill", "body text");
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsCreate.mockRejectedValue(new Error("create failed"));
      const store = useSkillsStore();

      const result = await store.createSkill("bad-skill", "desc", "body");

      expect(result).toBeNull();
      expect(store.error).toBe("create failed");
    });
  });

  // ── updateSkill ────────────────────────────────────────────
  describe("updateSkill", () => {
    it("returns true and reloads skills on success", async () => {
      mocks.skillsUpdate.mockResolvedValue(undefined);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      const fm = { name: "code-review", description: "Updated desc" };

      const result = await store.updateSkill(FIXTURE_SKILL.directory, fm, "new body");

      expect(result).toBe(true);
      expect(mocks.skillsUpdate).toHaveBeenCalledWith(FIXTURE_SKILL.directory, fm, "new body");
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns false and sets error on failure", async () => {
      mocks.skillsUpdate.mockRejectedValue(new Error("update failed"));
      const store = useSkillsStore();

      const result = await store.updateSkill("/dir", { name: "x", description: "y" }, "b");

      expect(result).toBe(false);
      expect(store.error).toBe("update failed");
    });
  });

  // ── updateSkillRaw ─────────────────────────────────────────
  describe("updateSkillRaw", () => {
    it("returns true and reloads skills on success", async () => {
      mocks.skillsUpdateRaw.mockResolvedValue(undefined);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.updateSkillRaw(FIXTURE_SKILL.directory, "raw content");

      expect(result).toBe(true);
      expect(mocks.skillsUpdateRaw).toHaveBeenCalledWith(FIXTURE_SKILL.directory, "raw content");
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns false and sets error on failure", async () => {
      mocks.skillsUpdateRaw.mockRejectedValue(new Error("raw update failed"));
      const store = useSkillsStore();

      const result = await store.updateSkillRaw("/dir", "content");

      expect(result).toBe(false);
      expect(store.error).toBe("raw update failed");
    });
  });

  // ── deleteSkill ────────────────────────────────────────────
  describe("deleteSkill", () => {
    it("removes skill from array on success", async () => {
      mocks.skillsDelete.mockResolvedValue(undefined);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      // Pre-populate
      await store.loadSkills();
      expect(store.skills).toHaveLength(3);

      const result = await store.deleteSkill(FIXTURE_SUMMARY.directory);

      expect(result).toBe(true);
      expect(store.skills.find((s) => s.directory === FIXTURE_SUMMARY.directory)).toBeUndefined();
    });

    it("clears selectedSkill if it matches deleted directory", async () => {
      mocks.skillsDelete.mockResolvedValue(undefined);
      mocks.skillsGetSkill.mockResolvedValue(FIXTURE_SKILL);
      const store = useSkillsStore();

      // Set selectedSkill
      await store.getSkill(FIXTURE_SKILL.directory);
      expect(store.selectedSkill).not.toBeNull();

      await store.deleteSkill(FIXTURE_SKILL.directory);

      expect(store.selectedSkill).toBeNull();
    });

    it("does not clear selectedSkill if it does not match", async () => {
      mocks.skillsDelete.mockResolvedValue(undefined);
      mocks.skillsGetSkill.mockResolvedValue(FIXTURE_SKILL);
      const store = useSkillsStore();

      await store.getSkill(FIXTURE_SKILL.directory);
      await store.deleteSkill("/some/other/directory");

      expect(store.selectedSkill).toEqual(FIXTURE_SKILL);
    });

    it("returns false and sets error on failure", async () => {
      mocks.skillsDelete.mockRejectedValue(new Error("delete failed"));
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
      mocks.skillsRename.mockResolvedValue(newDir);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.renameSkill(FIXTURE_SUMMARY.directory, "renamed-skill");

      expect(result).toBe(newDir);
      expect(mocks.skillsRename).toHaveBeenCalledWith(FIXTURE_SUMMARY.directory, "renamed-skill");
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsRename.mockRejectedValue(new Error("rename failed"));
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
      mocks.skillsDuplicate.mockResolvedValue(newDir);
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      const result = await store.duplicateSkill(FIXTURE_SUMMARY.directory, "code-review-copy");

      expect(result).toBe(newDir);
      expect(mocks.skillsDuplicate).toHaveBeenCalledWith(
        FIXTURE_SUMMARY.directory,
        "code-review-copy",
      );
      expect(mocks.skillsListAll).toHaveBeenCalled();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsDuplicate.mockRejectedValue(new Error("duplicate failed"));
      const store = useSkillsStore();

      const result = await store.duplicateSkill("/dir", "copy");

      expect(result).toBeNull();
      expect(store.error).toBe("duplicate failed");
    });
  });
});
