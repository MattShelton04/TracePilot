// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { createDeferred } from "@tracepilot/test-utils";
import type {
  AgentDefinition,
  BackupEntry,
  CopilotConfig,
  CopilotVersion,
} from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_ACTIVE_VERSION,
  FIXTURE_AGENT,
  FIXTURE_AGENTS,
  FIXTURE_BACKUPS,
  FIXTURE_CONFIG,
  FIXTURE_VERSIONS,
  mocks,
} from "./setup";
import { useConfigInjectorStore } from "../../../stores/configInjector";

describe("useConfigInjectorStore", () => {
  describe("initial state", () => {
    it("initializes with empty arrays and null values", () => {
      const store = useConfigInjectorStore();
      expect(store.agents).toEqual([]);
      expect(store.copilotConfig).toBeNull();
      expect(store.versions).toEqual([]);
      expect(store.activeVersion).toBeNull();
      expect(store.backups).toEqual([]);
      expect(store.migrationDiffs).toEqual([]);
      expect(store.selectedAgent).toBeNull();
    });

    it("initializes with activeTab set to 'agents'", () => {
      const store = useConfigInjectorStore();
      expect(store.activeTab).toBe("agents");
    });

    it("initializes with loading and saving as false", () => {
      const store = useConfigInjectorStore();
      expect(store.loading).toBe(false);
      expect(store.saving).toBe(false);
    });

    it("initializes with error as null", () => {
      const store = useConfigInjectorStore();
      expect(store.error).toBeNull();
    });
  });

  describe("initialize", () => {
    it("loads all 5 resources successfully", async () => {
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.agents).toEqual(FIXTURE_AGENTS);
      expect(store.copilotConfig).toEqual(FIXTURE_CONFIG);
      expect(store.versions).toEqual(FIXTURE_VERSIONS);
      expect(store.activeVersion).toEqual(FIXTURE_ACTIVE_VERSION);
      expect(store.backups).toEqual(FIXTURE_BACKUPS);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("handles partial failures gracefully", async () => {
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockRejectedValue(new Error("Config fetch failed"));
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockRejectedValue(new Error("Backups fetch failed"));

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.agents).toEqual(FIXTURE_AGENTS);
      expect(store.versions).toEqual(FIXTURE_VERSIONS);
      expect(store.activeVersion).toEqual(FIXTURE_ACTIVE_VERSION);
      expect(store.copilotConfig).toBeNull();
      expect(store.backups).toEqual([]);
      expect(store.error).toContain("Config fetch failed");
      expect(store.error).toContain("Backups fetch failed");
    });

    it("aggregates errors from rejected promises", async () => {
      mocks.getAgentDefinitions.mockRejectedValue(new Error("Agents failed"));
      mocks.getCopilotConfig.mockRejectedValue(new Error("Config failed"));
      mocks.discoverCopilotVersions.mockRejectedValue(new Error("Versions failed"));
      mocks.getActiveCopilotVersion.mockResolvedValue(null);
      mocks.listConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.error).toContain("Agents failed");
      expect(store.error).toContain("Config failed");
      expect(store.error).toContain("Versions failed");
    });

    it("sets loading=true during fetch, false after completion", async () => {
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const initPromise = store.initialize();

      expect(store.loading).toBe(true);
      await initPromise;
      expect(store.loading).toBe(false);
    });

    it("clears error on successful load", async () => {
      mocks.getAgentDefinitions.mockRejectedValue(new Error("First error"));
      const store = useConfigInjectorStore();
      await store.initialize();
      expect(store.error).toBeTruthy();

      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      await store.initialize();
      expect(store.error).toBeNull();
    });

    it("ignores stale initialize responses when a newer call finishes first", async () => {
      const slowAgents = createDeferred<AgentDefinition[]>();

      mocks.getAgentDefinitions
        .mockReturnValueOnce(slowAgents.promise)
        .mockResolvedValueOnce([{ ...FIXTURE_AGENT, name: "fresh-agent" }]);

      const freshConfig: CopilotConfig = { ...FIXTURE_CONFIG, model: "fresh-model" };
      const freshVersions: CopilotVersion[] = [
        { ...FIXTURE_ACTIVE_VERSION, version: "2.0.0", hasCustomizations: true },
      ];
      const freshActive: CopilotVersion = { ...freshVersions[0] };
      const freshBackups: BackupEntry[] = [{ ...FIXTURE_BACKUPS[0], id: "fresh-backup" }];

      mocks.getCopilotConfig
        .mockResolvedValueOnce(FIXTURE_CONFIG)
        .mockResolvedValueOnce(freshConfig);
      mocks.discoverCopilotVersions
        .mockResolvedValueOnce(FIXTURE_VERSIONS)
        .mockResolvedValueOnce(freshVersions);
      mocks.getActiveCopilotVersion
        .mockResolvedValueOnce(FIXTURE_ACTIVE_VERSION)
        .mockResolvedValueOnce(freshActive);
      mocks.listConfigBackups
        .mockResolvedValueOnce(FIXTURE_BACKUPS)
        .mockResolvedValueOnce(freshBackups);

      const store = useConfigInjectorStore();
      const first = store.initialize();
      const second = store.initialize();

      await second;

      expect(store.agents).toEqual([{ ...FIXTURE_AGENT, name: "fresh-agent" }]);
      expect(store.copilotConfig).toEqual(freshConfig);
      expect(store.versions).toEqual(freshVersions);
      expect(store.activeVersion).toEqual(freshActive);
      expect(store.backups).toEqual(freshBackups);
      expect(store.error).toBeNull();

      slowAgents.resolve(FIXTURE_AGENTS);
      await first;

      expect(store.agents).toEqual([{ ...FIXTURE_AGENT, name: "fresh-agent" }]);
      expect(store.copilotConfig).toEqual(freshConfig);
      expect(store.versions).toEqual(freshVersions);
      expect(store.activeVersion).toEqual(freshActive);
      expect(store.backups).toEqual(freshBackups);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });
});
