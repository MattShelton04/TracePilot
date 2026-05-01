// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  FIXTURE_ACTIVE_VERSION,
  FIXTURE_AGENTS,
  FIXTURE_BACKUPS,
  FIXTURE_CONFIG,
  FIXTURE_VERSIONS,
  mocks,
} from "./setup";
import { useConfigInjectorStore } from "../../../stores/configInjector";

describe("useConfigInjectorStore computed properties and edge cases", () => {
  describe("computed properties", () => {
    it("hasCustomizations returns true when any version has customizations", async () => {
      mocks.getAgentDefinitions.mockResolvedValue([]);
      mocks.getCopilotConfig.mockResolvedValue(null);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.hasCustomizations).toBe(true);
    });

    it("hasCustomizations returns false when all versions clean", async () => {
      const cleanVersions = FIXTURE_VERSIONS.map((v) => ({ ...v, hasCustomizations: false }));
      mocks.getAgentDefinitions.mockResolvedValue([]);
      mocks.getCopilotConfig.mockResolvedValue(null);
      mocks.discoverCopilotVersions.mockResolvedValue(cleanVersions);
      mocks.getActiveCopilotVersion.mockResolvedValue(cleanVersions[0]);
      mocks.listConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.hasCustomizations).toBe(false);
    });

    it("activeVersionStr returns activeVersion.version", async () => {
      mocks.getAgentDefinitions.mockResolvedValue([]);
      mocks.getCopilotConfig.mockResolvedValue(null);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.activeVersionStr).toBe("1.0.9");
    });

    it("activeVersionStr returns 'unknown' when activeVersion is null", () => {
      const store = useConfigInjectorStore();
      expect(store.activeVersionStr).toBe("unknown");
    });
  });

  describe("edge cases", () => {
    it("handles empty agents list gracefully", async () => {
      mocks.getAgentDefinitions.mockResolvedValue([]);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.agents).toEqual([]);
      expect(store.error).toBeNull();
    });

    it("handles null copilotConfig gracefully", async () => {
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(null);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.copilotConfig).toBeNull();
      expect(store.error).toBeNull();
    });

    it("handles empty versions list gracefully", async () => {
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue([]);
      mocks.getActiveCopilotVersion.mockResolvedValue(null);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.versions).toEqual([]);
      expect(store.hasCustomizations).toBe(false);
    });

    it("handles all Promise.allSettled rejections gracefully", async () => {
      mocks.getAgentDefinitions.mockRejectedValue(new Error("Agents failed"));
      mocks.getCopilotConfig.mockRejectedValue(new Error("Config failed"));
      mocks.discoverCopilotVersions.mockRejectedValue(new Error("Versions failed"));
      mocks.getActiveCopilotVersion.mockRejectedValue(new Error("Active failed"));
      mocks.listConfigBackups.mockRejectedValue(new Error("Backups failed"));

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.error).toBeTruthy();
      expect(store.loading).toBe(false);
      expect(store.agents).toEqual([]);
      expect(store.copilotConfig).toBeNull();
      expect(store.versions).toEqual([]);
    });
  });
});
