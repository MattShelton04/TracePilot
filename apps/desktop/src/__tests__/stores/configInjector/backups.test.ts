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

describe("useConfigInjectorStore backup mutations", () => {
  describe("createBackup", () => {
    it("creates backup and reloads list", async () => {
      mocks.createConfigBackup.mockResolvedValue(undefined);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const result = await store.createBackup("/path/to/file", "My backup");

      expect(result).toBe(true);
      expect(mocks.createConfigBackup).toHaveBeenCalledWith("/path/to/file", "My backup");
      expect(store.backups).toEqual(FIXTURE_BACKUPS);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Backup created");
    });

    it("silent mode suppresses toast", async () => {
      mocks.createConfigBackup.mockResolvedValue(undefined);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.createBackup("/path/to/file", "Silent backup", true);

      expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it("sets error on failure when not silent", async () => {
      mocks.createConfigBackup.mockRejectedValue(new Error("Backup failed"));

      const store = useConfigInjectorStore();
      const result = await store.createBackup("/path/to/file", "Failed backup");

      expect(result).toBe(false);
      expect(store.error).toContain("Backup failed");
    });

    it("silent mode suppresses error", async () => {
      mocks.createConfigBackup.mockRejectedValue(new Error("Silent failure"));

      const store = useConfigInjectorStore();
      const result = await store.createBackup("/path/to/file", "backup", true);

      expect(result).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe("restoreBackup", () => {
    it("restores backup successfully", async () => {
      mocks.restoreConfigBackup.mockResolvedValue(undefined);
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const result = await store.restoreBackup("/backup/path", "/restore/to");

      expect(result).toBe(true);
      expect(mocks.restoreConfigBackup).toHaveBeenCalledWith("/backup/path", "/restore/to");
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Backup restored");
    });

    it("reinitializes after restore", async () => {
      mocks.restoreConfigBackup.mockResolvedValue(undefined);
      mocks.getAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mocks.getCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mocks.discoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mocks.getActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.restoreBackup("/backup/path", "/restore/to");

      expect(store.agents).toEqual(FIXTURE_AGENTS);
      expect(store.copilotConfig).toEqual(FIXTURE_CONFIG);
    });

    it("sets error on failure", async () => {
      mocks.restoreConfigBackup.mockRejectedValue(new Error("Restore failed"));

      const store = useConfigInjectorStore();
      const result = await store.restoreBackup("/backup/path", "/restore/to");

      expect(result).toBe(false);
      expect(store.error).toContain("Restore failed");
    });
  });

  describe("deleteBackup", () => {
    it("deletes backup and reloads list", async () => {
      mocks.deleteConfigBackup.mockResolvedValue(undefined);
      mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const result = await store.deleteBackup("/backup/path");

      expect(result).toBe(true);
      expect(mocks.deleteConfigBackup).toHaveBeenCalledWith("/backup/path");
      expect(store.backups).toEqual(FIXTURE_BACKUPS);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Backup deleted");
    });

    it("sets error on failure", async () => {
      mocks.deleteConfigBackup.mockRejectedValue(new Error("Delete failed"));

      const store = useConfigInjectorStore();
      const result = await store.deleteBackup("/backup/path");

      expect(result).toBe(false);
      expect(store.error).toContain("Delete failed");
    });
  });
});
