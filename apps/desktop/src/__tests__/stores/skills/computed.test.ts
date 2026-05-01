// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { ALL_SUMMARIES, mocks, setupSkillsStoreTest } from "./setup";
import { useSkillsStore } from "../../../stores/skills";

setupSkillsStoreTest();

describe("useSkillsStore", () => {
  // ── filteredSkills (computed) ──────────────────────────────
  describe("filteredSkills", () => {
    it("returns all skills sorted by name when no filters applied", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      const names = store.filteredSkills.map((s) => s.name);
      expect(names).toEqual(["api-docs", "code-review", "test-gen"]);
    });

    it("filters by searchQuery on name", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.searchQuery = "code";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("code-review");
    });

    it("filters by searchQuery on description", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.searchQuery = "unit tests";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("test-gen");
    });

    it("filters by searchQuery case-insensitively", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.searchQuery = "CODE-REVIEW";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].name).toBe("code-review");
    });

    it("filters by scope 'global'", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.filterScope = "global";

      expect(store.filteredSkills).toHaveLength(2);
      expect(store.filteredSkills.every((s) => s.scope === "global")).toBe(true);
    });

    it("filters by scope 'repository'", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      store.filterScope = "repository";

      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].scope).toBe("repository");
    });

    it("combines scope and searchQuery filters", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
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
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
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
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
      const store = useSkillsStore();
      await store.loadSkills();

      expect(store.globalSkills).toHaveLength(2);
      expect(store.globalSkills.every((s) => s.scope === "global")).toBe(true);
    });

    it("repoSkills returns only repository-scope skills", async () => {
      mocks.skillsListAll.mockResolvedValue(ALL_SUMMARIES);
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
});
