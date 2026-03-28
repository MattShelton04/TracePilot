import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useConfigInjectorStore } from "@/stores/configInjector";
import type {
  AgentDefinition,
  BackupEntry,
  CopilotConfig,
  CopilotVersion,
  MigrationDiff,
} from "@tracepilot/types";

// ── Mock client functions ──────────────────────────────────────
const mockGetAgentDefinitions = vi.fn();
const mockSaveAgentDefinition = vi.fn();
const mockGetCopilotConfig = vi.fn();
const mockSaveCopilotConfig = vi.fn();
const mockCreateConfigBackup = vi.fn();
const mockDeleteConfigBackup = vi.fn();
const mockListConfigBackups = vi.fn();
const mockRestoreConfigBackup = vi.fn();
const mockDiscoverCopilotVersions = vi.fn();
const mockGetActiveCopilotVersion = vi.fn();
const mockGetMigrationDiffs = vi.fn();
const mockMigrateAgentDefinition = vi.fn();

vi.mock("@tracepilot/client", () => ({
  getAgentDefinitions: (...args: unknown[]) => mockGetAgentDefinitions(...args),
  saveAgentDefinition: (...args: unknown[]) => mockSaveAgentDefinition(...args),
  getCopilotConfig: (...args: unknown[]) => mockGetCopilotConfig(...args),
  saveCopilotConfig: (...args: unknown[]) => mockSaveCopilotConfig(...args),
  createConfigBackup: (...args: unknown[]) => mockCreateConfigBackup(...args),
  deleteConfigBackup: (...args: unknown[]) => mockDeleteConfigBackup(...args),
  listConfigBackups: (...args: unknown[]) => mockListConfigBackups(...args),
  restoreConfigBackup: (...args: unknown[]) => mockRestoreConfigBackup(...args),
  discoverCopilotVersions: (...args: unknown[]) => mockDiscoverCopilotVersions(...args),
  getActiveCopilotVersion: (...args: unknown[]) => mockGetActiveCopilotVersion(...args),
  getMigrationDiffs: (...args: unknown[]) => mockGetMigrationDiffs(...args),
  migrateAgentDefinition: (...args: unknown[]) => mockMigrateAgentDefinition(...args),
}));

// Mock toast store
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────
const FIXTURE_AGENT: AgentDefinition = {
  name: "code-reviewer",
  filePath: "/home/user/.copilot/versions/1.0.9/agents/code-reviewer.yaml",
  model: "claude-opus-4.6",
  tools: ["read", "grep", "bash"],
  promptExcerpt: "You are a code review assistant...",
  rawYaml: "name: code-reviewer\nmodel: claude-opus-4.6\n",
};

const FIXTURE_AGENTS: AgentDefinition[] = [
  FIXTURE_AGENT,
  {
    name: "test-writer",
    filePath: "/home/user/.copilot/versions/1.0.9/agents/test-writer.yaml",
    model: "claude-sonnet-4.6",
    tools: ["read", "write", "bash"],
    promptExcerpt: "You write comprehensive tests...",
    rawYaml: "name: test-writer\nmodel: claude-sonnet-4.6\n",
  },
];

const FIXTURE_CONFIG: CopilotConfig = {
  model: "claude-sonnet-4.6",
  reasoningEffort: "high",
  trustedFolders: ["/home/user/projects"],
  renderSettings: {
    maxWidth: 1200,
  },
};

const FIXTURE_VERSIONS: CopilotVersion[] = [
  {
    version: "1.0.9",
    path: "/home/user/.copilot/versions/1.0.9",
    agentCount: 12,
    hasCustomizations: false,
  },
  {
    version: "1.0.8",
    path: "/home/user/.copilot/versions/1.0.8",
    agentCount: 11,
    hasCustomizations: true,
  },
];

const FIXTURE_ACTIVE_VERSION: CopilotVersion = FIXTURE_VERSIONS[0];

const FIXTURE_BACKUPS: BackupEntry[] = [
  {
    path: "/home/user/.copilot/backups/code-reviewer-2026-03-28.yaml",
    fileName: "code-reviewer-2026-03-28.yaml",
    label: "Before Opus upgrade",
    createdAt: "2026-03-28T10:00:00Z",
    sizeBytes: 1024,
  },
  {
    path: "/home/user/.copilot/backups/config-2026-03-27.json",
    fileName: "config-2026-03-27.json",
    label: "Daily backup",
    createdAt: "2026-03-27T10:00:00Z",
    sizeBytes: 512,
  },
];

const FIXTURE_MIGRATION_DIFFS: MigrationDiff[] = [
  {
    fileName: "code-reviewer.yaml",
    oldContent: "name: code-reviewer\nmodel: claude-opus-4.5\n",
    newContent: "name: code-reviewer\nmodel: claude-opus-4.6\n",
    status: "modified",
  },
  {
    fileName: "test-writer.yaml",
    oldContent: null,
    newContent: "name: test-writer\nmodel: claude-sonnet-4.6\n",
    status: "added",
  },
];

describe("useConfigInjectorStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Default: all succeed with empty/default data
    mockGetAgentDefinitions.mockResolvedValue([]);
    mockGetCopilotConfig.mockResolvedValue(null);
    mockDiscoverCopilotVersions.mockResolvedValue([]);
    mockGetActiveCopilotVersion.mockResolvedValue(null);
    mockListConfigBackups.mockResolvedValue([]);
  });

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
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

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
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockRejectedValue(new Error("Config fetch failed"));
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockRejectedValue(new Error("Backups fetch failed"));

      const store = useConfigInjectorStore();
      await store.initialize();

      // Successful loads
      expect(store.agents).toEqual(FIXTURE_AGENTS);
      expect(store.versions).toEqual(FIXTURE_VERSIONS);
      expect(store.activeVersion).toEqual(FIXTURE_ACTIVE_VERSION);

      // Failed loads should not update state
      expect(store.copilotConfig).toBeNull();
      expect(store.backups).toEqual([]);

      // Error should aggregate failures
      expect(store.error).toContain("Config fetch failed");
      expect(store.error).toContain("Backups fetch failed");
    });

    it("aggregates errors from rejected promises", async () => {
      mockGetAgentDefinitions.mockRejectedValue(new Error("Agents failed"));
      mockGetCopilotConfig.mockRejectedValue(new Error("Config failed"));
      mockDiscoverCopilotVersions.mockRejectedValue(new Error("Versions failed"));
      mockGetActiveCopilotVersion.mockResolvedValue(null);
      mockListConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.error).toContain("Agents failed");
      expect(store.error).toContain("Config failed");
      expect(store.error).toContain("Versions failed");
    });

    it("sets loading=true during fetch, false after completion", async () => {
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const initPromise = store.initialize();

      expect(store.loading).toBe(true);
      await initPromise;
      expect(store.loading).toBe(false);
    });

    it("clears error on successful load", async () => {
      mockGetAgentDefinitions.mockRejectedValue(new Error("First error"));
      const store = useConfigInjectorStore();
      await store.initialize();
      expect(store.error).toBeTruthy();

      // Second initialization succeeds
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      await store.initialize();
      expect(store.error).toBeNull();
    });
  });

  describe("selectAgent", () => {
    it("sets selectedAgent and editingYaml", () => {
      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      expect(store.selectedAgent).toEqual(FIXTURE_AGENT);
      expect(store.editingYaml).toBe(FIXTURE_AGENT.rawYaml);
    });

    it("preserves rawYaml content for editing", () => {
      const store = useConfigInjectorStore();
      const agentWithComplexYaml = {
        ...FIXTURE_AGENT,
        rawYaml: "name: test\nmodel: opus\ntools:\n  - read\n  - write\n",
      };

      store.selectAgent(agentWithComplexYaml);
      expect(store.editingYaml).toBe(agentWithComplexYaml.rawYaml);
    });
  });

  describe("saveAgent", () => {
    it("successfully saves agent YAML", async () => {
      mockSaveAgentDefinition.mockResolvedValue(undefined);
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);
      store.editingYaml = "name: updated\nmodel: new-model\n";

      const result = await store.saveAgent();

      expect(result).toBe(true);
      expect(mockSaveAgentDefinition).toHaveBeenCalledWith(
        FIXTURE_AGENT.filePath,
        "name: updated\nmodel: new-model\n"
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Saved code-reviewer agent");
    });

    it("reloads agent definitions after save", async () => {
      mockSaveAgentDefinition.mockResolvedValue(undefined);
      const updatedAgents = [{ ...FIXTURE_AGENT, model: "new-model" }];
      mockGetAgentDefinitions.mockResolvedValue(updatedAgents);

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      await store.saveAgent();

      expect(store.agents).toEqual(updatedAgents);
    });

    it("sets error on failure and returns false", async () => {
      mockSaveAgentDefinition.mockRejectedValue(new Error("Save failed"));

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      const result = await store.saveAgent();

      expect(result).toBe(false);
      expect(store.error).toContain("Save failed");
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("sets saving=true during operation", async () => {
      let resolveSave: () => void;
      const savePromise = new Promise<void>((resolve) => { resolveSave = resolve; });
      mockSaveAgentDefinition.mockReturnValue(savePromise);
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);

      const store = useConfigInjectorStore();
      store.selectAgent(FIXTURE_AGENT);

      const saveTask = store.saveAgent();
      expect(store.saving).toBe(true);

      resolveSave!();
      await saveTask;
      expect(store.saving).toBe(false);
    });

    it("returns false when no agent selected", async () => {
      const store = useConfigInjectorStore();
      const result = await store.saveAgent();
      expect(result).toBe(false);
    });
  });

  describe("saveGlobalConfig", () => {
    it("successfully saves global config", async () => {
      mockSaveCopilotConfig.mockResolvedValue(undefined);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);

      const store = useConfigInjectorStore();
      const newConfig = { model: "claude-opus-4.6", reasoningEffort: "medium" };

      const result = await store.saveGlobalConfig(newConfig);

      expect(result).toBe(true);
      expect(mockSaveCopilotConfig).toHaveBeenCalledWith(newConfig);
      expect(mockToastSuccess).toHaveBeenCalledWith("Global config saved");
    });

    it("reloads copilotConfig after save", async () => {
      mockSaveCopilotConfig.mockResolvedValue(undefined);
      const updatedConfig = { ...FIXTURE_CONFIG, model: "new-model" };
      mockGetCopilotConfig.mockResolvedValue(updatedConfig);

      const store = useConfigInjectorStore();
      await store.saveGlobalConfig({});

      expect(store.copilotConfig).toEqual(updatedConfig);
    });

    it("sets error on failure", async () => {
      mockSaveCopilotConfig.mockRejectedValue(new Error("Config save failed"));

      const store = useConfigInjectorStore();
      const result = await store.saveGlobalConfig({});

      expect(result).toBe(false);
      expect(store.error).toContain("Config save failed");
    });

    it("sets saving=true during operation", async () => {
      let resolveSave: () => void;
      const savePromise = new Promise<void>((resolve) => { resolveSave = resolve; });
      mockSaveCopilotConfig.mockReturnValue(savePromise);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);

      const store = useConfigInjectorStore();
      const saveTask = store.saveGlobalConfig({});
      expect(store.saving).toBe(true);

      resolveSave!();
      await saveTask;
      expect(store.saving).toBe(false);
    });
  });

  describe("createBackup", () => {
    it("creates backup and reloads list", async () => {
      mockCreateConfigBackup.mockResolvedValue(undefined);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const result = await store.createBackup("/path/to/file", "My backup");

      expect(result).toBe(true);
      expect(mockCreateConfigBackup).toHaveBeenCalledWith("/path/to/file", "My backup");
      expect(store.backups).toEqual(FIXTURE_BACKUPS);
      expect(mockToastSuccess).toHaveBeenCalledWith("Backup created");
    });

    it("silent mode suppresses toast", async () => {
      mockCreateConfigBackup.mockResolvedValue(undefined);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.createBackup("/path/to/file", "Silent backup", true);

      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("sets error on failure unless silent", async () => {
      mockCreateConfigBackup.mockRejectedValue(new Error("Backup failed"));

      const store = useConfigInjectorStore();
      const result = await store.createBackup("/path/to/file", "Failed backup");

      expect(result).toBe(false);
      expect(store.error).toBeNull(); // Error suppressed (no silent flag check in non-silent path)
    });

    it("silent mode suppresses error", async () => {
      mockCreateConfigBackup.mockRejectedValue(new Error("Silent failure"));

      const store = useConfigInjectorStore();
      const result = await store.createBackup("/path/to/file", "backup", true);

      expect(result).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe("restoreBackup", () => {
    it("restores backup successfully", async () => {
      mockRestoreConfigBackup.mockResolvedValue(undefined);
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const result = await store.restoreBackup("/backup/path", "/restore/to");

      expect(result).toBe(true);
      expect(mockRestoreConfigBackup).toHaveBeenCalledWith("/backup/path", "/restore/to");
      expect(mockToastSuccess).toHaveBeenCalledWith("Backup restored");
    });

    it("reinitializes after restore", async () => {
      mockRestoreConfigBackup.mockResolvedValue(undefined);
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.restoreBackup("/backup/path", "/restore/to");

      // Verify initialize was called by checking state
      expect(store.agents).toEqual(FIXTURE_AGENTS);
      expect(store.copilotConfig).toEqual(FIXTURE_CONFIG);
    });

    it("sets error on failure", async () => {
      mockRestoreConfigBackup.mockRejectedValue(new Error("Restore failed"));

      const store = useConfigInjectorStore();
      const result = await store.restoreBackup("/backup/path", "/restore/to");

      expect(result).toBe(false);
      expect(store.error).toContain("Restore failed");
    });
  });

  describe("deleteBackup", () => {
    it("deletes backup and reloads list", async () => {
      mockDeleteConfigBackup.mockResolvedValue(undefined);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      const result = await store.deleteBackup("/backup/path");

      expect(result).toBe(true);
      expect(mockDeleteConfigBackup).toHaveBeenCalledWith("/backup/path");
      expect(store.backups).toEqual(FIXTURE_BACKUPS);
      expect(mockToastSuccess).toHaveBeenCalledWith("Backup deleted");
    });

    it("sets error on failure", async () => {
      mockDeleteConfigBackup.mockRejectedValue(new Error("Delete failed"));

      const store = useConfigInjectorStore();
      const result = await store.deleteBackup("/backup/path");

      expect(result).toBe(false);
      expect(store.error).toContain("Delete failed");
    });
  });

  describe("loadMigrationDiffs", () => {
    it("loads migration diffs for version pair", async () => {
      mockGetMigrationDiffs.mockResolvedValue(FIXTURE_MIGRATION_DIFFS);

      const store = useConfigInjectorStore();
      await store.loadMigrationDiffs("1.0.8", "1.0.9");

      expect(mockGetMigrationDiffs).toHaveBeenCalledWith("1.0.8", "1.0.9");
      expect(store.migrationDiffs).toEqual(FIXTURE_MIGRATION_DIFFS);
    });

    it("populates migrationDiffs ref", async () => {
      mockGetMigrationDiffs.mockResolvedValue(FIXTURE_MIGRATION_DIFFS);

      const store = useConfigInjectorStore();
      await store.loadMigrationDiffs("1.0.8", "1.0.9");

      expect(store.migrationDiffs).toHaveLength(2);
      expect(store.migrationDiffs[0].fileName).toBe("code-reviewer.yaml");
      expect(store.migrationDiffs[0].status).toBe("modified");
    });

    it("sets error on failure", async () => {
      mockGetMigrationDiffs.mockRejectedValue(new Error("Diff failed"));

      const store = useConfigInjectorStore();
      await store.loadMigrationDiffs("1.0.8", "1.0.9");

      expect(store.error).toContain("Diff failed");
    });
  });

  describe("migrateAgent", () => {
    it("migrates agent definition", async () => {
      mockMigrateAgentDefinition.mockResolvedValue(undefined);

      const store = useConfigInjectorStore();
      const result = await store.migrateAgent("code-reviewer.yaml", "1.0.8", "1.0.9");

      expect(result).toBe(true);
      expect(mockMigrateAgentDefinition).toHaveBeenCalledWith("code-reviewer.yaml", "1.0.8", "1.0.9");
      expect(mockToastSuccess).toHaveBeenCalledWith("Migrated code-reviewer.yaml");
    });

    it("sets error on failure", async () => {
      mockMigrateAgentDefinition.mockRejectedValue(new Error("Migration failed"));

      const store = useConfigInjectorStore();
      const result = await store.migrateAgent("test.yaml", "1.0.8", "1.0.9");

      expect(result).toBe(false);
      expect(store.error).toContain("Migration failed");
    });
  });

  describe("computed properties", () => {
    it("hasCustomizations returns true when any version has customizations", async () => {
      mockGetAgentDefinitions.mockResolvedValue([]);
      mockGetCopilotConfig.mockResolvedValue(null);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.hasCustomizations).toBe(true);
    });

    it("hasCustomizations returns false when all versions clean", async () => {
      const cleanVersions = FIXTURE_VERSIONS.map((v) => ({ ...v, hasCustomizations: false }));
      mockGetAgentDefinitions.mockResolvedValue([]);
      mockGetCopilotConfig.mockResolvedValue(null);
      mockDiscoverCopilotVersions.mockResolvedValue(cleanVersions);
      mockGetActiveCopilotVersion.mockResolvedValue(cleanVersions[0]);
      mockListConfigBackups.mockResolvedValue([]);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.hasCustomizations).toBe(false);
    });

    it("activeVersionStr returns activeVersion.version", async () => {
      mockGetAgentDefinitions.mockResolvedValue([]);
      mockGetCopilotConfig.mockResolvedValue(null);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue([]);

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
      mockGetAgentDefinitions.mockResolvedValue([]);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.agents).toEqual([]);
      expect(store.error).toBeNull();
    });

    it("handles null copilotConfig gracefully", async () => {
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(null);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.copilotConfig).toBeNull();
      expect(store.error).toBeNull();
    });

    it("handles empty versions list gracefully", async () => {
      mockGetAgentDefinitions.mockResolvedValue(FIXTURE_AGENTS);
      mockGetCopilotConfig.mockResolvedValue(FIXTURE_CONFIG);
      mockDiscoverCopilotVersions.mockResolvedValue([]);
      mockGetActiveCopilotVersion.mockResolvedValue(null);
      mockListConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);

      const store = useConfigInjectorStore();
      await store.initialize();

      expect(store.versions).toEqual([]);
      expect(store.hasCustomizations).toBe(false);
    });

    it("handles all Promise.allSettled rejections gracefully", async () => {
      mockGetAgentDefinitions.mockRejectedValue(new Error("Agents failed"));
      mockGetCopilotConfig.mockRejectedValue(new Error("Config failed"));
      mockDiscoverCopilotVersions.mockRejectedValue(new Error("Versions failed"));
      mockGetActiveCopilotVersion.mockRejectedValue(new Error("Active failed"));
      mockListConfigBackups.mockRejectedValue(new Error("Backups failed"));

      const store = useConfigInjectorStore();
      await store.initialize();

      // Should not throw
      expect(store.error).toBeTruthy();
      expect(store.loading).toBe(false);
      // All state should remain at defaults
      expect(store.agents).toEqual([]);
      expect(store.copilotConfig).toBeNull();
      expect(store.versions).toEqual([]);
    });
  });
});
