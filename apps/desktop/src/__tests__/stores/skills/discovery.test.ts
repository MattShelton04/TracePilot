// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { mocks, setupSkillsStoreTest } from "./setup";
import { useSkillsStore } from "../../../stores/skills";

setupSkillsStoreTest();

describe("useSkillsStore", () => {
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
      mocks.skillsDiscoverRepos.mockResolvedValue(mockResults);

      const store = useSkillsStore();
      const results = await store.discoverRepos([
        ["/repos/project-a", "project-a"],
        ["/repos/project-b", "project-b"],
      ]);

      expect(mocks.skillsDiscoverRepos).toHaveBeenCalledWith([
        ["/repos/project-a", "project-a"],
        ["/repos/project-b", "project-b"],
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].skills).toHaveLength(1);
      expect(results[1].skills).toHaveLength(0);
    });

    it("returns empty array and sets error on failure", async () => {
      mocks.skillsDiscoverRepos.mockRejectedValue(new Error("Scan failed"));

      const store = useSkillsStore();
      const results = await store.discoverRepos([]);

      expect(results).toEqual([]);
      expect(store.error).toBe("Scan failed");
    });
  });
});
