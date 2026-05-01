// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { createDeferred } from "@tracepilot/test-utils";
import type { MigrationDiff } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { FIXTURE_MIGRATION_DIFFS, mocks } from "./setup";
import { useConfigInjectorStore } from "../../../stores/configInjector";

describe("useConfigInjectorStore migration flows", () => {
  describe("loadMigrationDiffs", () => {
    it("loads migration diffs for version pair", async () => {
      mocks.getMigrationDiffs.mockResolvedValue(FIXTURE_MIGRATION_DIFFS);

      const store = useConfigInjectorStore();
      await store.loadMigrationDiffs("1.0.8", "1.0.9");

      expect(mocks.getMigrationDiffs).toHaveBeenCalledWith("1.0.8", "1.0.9");
      expect(store.migrationDiffs).toEqual(FIXTURE_MIGRATION_DIFFS);
    });

    it("populates migrationDiffs ref", async () => {
      mocks.getMigrationDiffs.mockResolvedValue(FIXTURE_MIGRATION_DIFFS);

      const store = useConfigInjectorStore();
      await store.loadMigrationDiffs("1.0.8", "1.0.9");

      expect(store.migrationDiffs).toHaveLength(2);
      expect(store.migrationDiffs[0].fileName).toBe("code-reviewer.yaml");
      expect(store.migrationDiffs[0].hasConflicts).toBe(false);
    });

    it("sets error on failure", async () => {
      mocks.getMigrationDiffs.mockRejectedValue(new Error("Diff failed"));

      const store = useConfigInjectorStore();
      await store.loadMigrationDiffs("1.0.8", "1.0.9");

      expect(store.error).toContain("Diff failed");
    });

    it("ignores stale migrationDiffs responses when a newer request finishes first", async () => {
      const slowDiffs = createDeferred<MigrationDiff[]>();
      const freshDiffs: MigrationDiff[] = [
        {
          fileName: "new-agent.yaml",
          agentName: "new-agent",
          fromVersion: "1.1.0",
          toVersion: "1.2.0",
          diff: "+model: fresh",
          hasConflicts: false,
        },
      ];
      const staleDiffs: MigrationDiff[] = [
        {
          fileName: "stale-agent.yaml",
          agentName: "stale-agent",
          fromVersion: "1.0.0",
          toVersion: "1.0.1",
          diff: "-old",
          hasConflicts: true,
        },
      ];

      mocks.getMigrationDiffs
        .mockReturnValueOnce(slowDiffs.promise)
        .mockResolvedValueOnce(freshDiffs);

      const store = useConfigInjectorStore();
      const first = store.loadMigrationDiffs("1.0.0", "1.0.1");
      const second = store.loadMigrationDiffs("1.1.0", "1.2.0");

      await second;

      expect(store.migrationDiffs).toEqual(freshDiffs);
      expect(store.error).toBeNull();

      slowDiffs.resolve(staleDiffs);
      await first;

      expect(store.migrationDiffs).toEqual(freshDiffs);
    });
  });

  describe("migrateAgent", () => {
    it("migrates agent definition", async () => {
      mocks.migrateAgentDefinition.mockResolvedValue(undefined);

      const store = useConfigInjectorStore();
      const result = await store.migrateAgent("code-reviewer.yaml", "1.0.8", "1.0.9");

      expect(result).toBe(true);
      expect(mocks.migrateAgentDefinition).toHaveBeenCalledWith(
        "code-reviewer.yaml",
        "1.0.8",
        "1.0.9",
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Migrated code-reviewer.yaml");
    });

    it("sets error on failure", async () => {
      mocks.migrateAgentDefinition.mockRejectedValue(new Error("Migration failed"));

      const store = useConfigInjectorStore();
      const result = await store.migrateAgent("test.yaml", "1.0.8", "1.0.9");

      expect(result).toBe(false);
      expect(store.error).toContain("Migration failed");
    });
  });
});
