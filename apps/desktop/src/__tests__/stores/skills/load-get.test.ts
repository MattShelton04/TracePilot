// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import type { SkillSummary } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  createDeferred,
  ALL_SUMMARIES,
  FIXTURE_SKILL,
  FIXTURE_SUMMARY_REPO,
  mocks,
  setupSkillsStoreTest,
} from "./setup";
import { useSkillsStore } from "../../../stores/skills";

setupSkillsStoreTest();

describe("useSkillsStore", () => {
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
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();

      await store.loadSkills();

      expect(store.skills).toHaveLength(3);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("passes repoRoot to client function", async () => {
      mocks.skillsListAll.mockResolvedValue([]);
      const store = useSkillsStore();

      await store.loadSkills("/some/repo");

      expect(mocks.skillsListAll).toHaveBeenCalledWith("/some/repo");
    });

    it("sets loading to true during fetch", async () => {
      mocks.skillsListAll.mockResolvedValue([]);
      const store = useSkillsStore();

      const promise = store.loadSkills();
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it("sets error on failure", async () => {
      mocks.skillsListAll.mockRejectedValue(new Error("network error"));
      const store = useSkillsStore();

      await store.loadSkills();

      expect(store.error).toBe("network error");
      expect(store.loading).toBe(false);
    });

    it("discards stale response when newer load is in progress", async () => {
      const firstDeferred = createDeferred<SkillSummary[]>();
      mocks.skillsListAll
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
      mocks.skillsGetSkill.mockResolvedValue(FIXTURE_SKILL);
      const store = useSkillsStore();

      const result = await store.getSkill(FIXTURE_SKILL.directory);

      expect(result).toEqual(FIXTURE_SKILL);
      expect(store.selectedSkill).toEqual(FIXTURE_SKILL);
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mocks.skillsGetSkill.mockRejectedValue(new Error("not found"));
      const store = useSkillsStore();

      const result = await store.getSkill("/nonexistent");

      expect(result).toBeNull();
      expect(store.error).toBe("not found");
    });
  });
});
