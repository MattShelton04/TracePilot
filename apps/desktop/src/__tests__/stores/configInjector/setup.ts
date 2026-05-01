import { setupPinia } from "@tracepilot/test-utils";
import type {
  AgentDefinition,
  BackupEntry,
  CopilotConfig,
  CopilotVersion,
  MigrationDiff,
} from "@tracepilot/types";
import { beforeEach, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  getAgentDefinitions: vi.fn(),
  saveAgentDefinition: vi.fn(),
  getCopilotConfig: vi.fn(),
  saveCopilotConfig: vi.fn(),
  createConfigBackup: vi.fn(),
  deleteConfigBackup: vi.fn(),
  listConfigBackups: vi.fn(),
  restoreConfigBackup: vi.fn(),
  discoverCopilotVersions: vi.fn(),
  getActiveCopilotVersion: vi.fn(),
  getMigrationDiffs: vi.fn(),
  migrateAgentDefinition: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getAgentDefinitions: (...args: unknown[]) => hoistedMocks.getAgentDefinitions(...args),
    saveAgentDefinition: (...args: unknown[]) => hoistedMocks.saveAgentDefinition(...args),
    getCopilotConfig: (...args: unknown[]) => hoistedMocks.getCopilotConfig(...args),
    saveCopilotConfig: (...args: unknown[]) => hoistedMocks.saveCopilotConfig(...args),
    createConfigBackup: (...args: unknown[]) => hoistedMocks.createConfigBackup(...args),
    deleteConfigBackup: (...args: unknown[]) => hoistedMocks.deleteConfigBackup(...args),
    listConfigBackups: (...args: unknown[]) => hoistedMocks.listConfigBackups(...args),
    restoreConfigBackup: (...args: unknown[]) => hoistedMocks.restoreConfigBackup(...args),
    discoverCopilotVersions: (...args: unknown[]) => hoistedMocks.discoverCopilotVersions(...args),
    getActiveCopilotVersion: (...args: unknown[]) => hoistedMocks.getActiveCopilotVersion(...args),
    getMigrationDiffs: (...args: unknown[]) => hoistedMocks.getMigrationDiffs(...args),
    migrateAgentDefinition: (...args: unknown[]) => hoistedMocks.migrateAgentDefinition(...args),
  });
});

vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({
    success: hoistedMocks.toastSuccess,
    error: hoistedMocks.toastError,
  }),
}));

export const FIXTURE_AGENT: AgentDefinition = {
  name: "code-reviewer",
  filePath: "/home/user/.copilot/versions/1.0.9/agents/code-reviewer.yaml",
  model: "claude-opus-4.6",
  description: "Reviews code changes for quality and correctness",
  tools: ["read", "grep", "bash"],
  promptExcerpt: "You are a code review assistant...",
  rawYaml: "name: code-reviewer\nmodel: claude-opus-4.6\n",
};

export const FIXTURE_AGENTS: AgentDefinition[] = [
  FIXTURE_AGENT,
  {
    name: "test-writer",
    filePath: "/home/user/.copilot/versions/1.0.9/agents/test-writer.yaml",
    model: "claude-sonnet-4.6",
    description: "Writes comprehensive test suites",
    tools: ["read", "write", "bash"],
    promptExcerpt: "You write comprehensive tests...",
    rawYaml: "name: test-writer\nmodel: claude-sonnet-4.6\n",
  },
];

export const FIXTURE_CONFIG: CopilotConfig = {
  model: "claude-sonnet-4.6",
  reasoningEffort: "high",
  trustedFolders: ["/home/user/projects"],
  disabledSkills: [],
  raw: {
    model: "claude-sonnet-4.6",
    reasoningEffort: "high",
  },
  settingsPath: "/home/user/.copilot/settings.json",
};

export const FIXTURE_VERSIONS: CopilotVersion[] = [
  {
    version: "1.0.9",
    path: "/home/user/.copilot/versions/1.0.9",
    isActive: true,
    isComplete: true,
    modifiedAt: "2026-03-28T10:00:00Z",
    hasCustomizations: false,
    lockCount: 0,
  },
  {
    version: "1.0.8",
    path: "/home/user/.copilot/versions/1.0.8",
    isActive: false,
    isComplete: true,
    modifiedAt: "2026-03-27T10:00:00Z",
    hasCustomizations: true,
    lockCount: 1,
  },
];

export const FIXTURE_ACTIVE_VERSION: CopilotVersion = FIXTURE_VERSIONS[0];

export const FIXTURE_BACKUPS: BackupEntry[] = [
  {
    id: "backup-1",
    label: "Before Opus upgrade",
    sourcePath: "/home/user/.copilot/versions/1.0.9/agents/code-reviewer.yaml",
    backupPath: "/home/user/.copilot/backups/code-reviewer-2026-03-28.yaml",
    createdAt: "2026-03-28T10:00:00Z",
    sizeBytes: 1024,
  },
  {
    id: "backup-2",
    label: "Daily backup",
    sourcePath: "/home/user/.copilot/versions/1.0.9/config.json",
    backupPath: "/home/user/.copilot/backups/config-2026-03-27.json",
    createdAt: "2026-03-27T10:00:00Z",
    sizeBytes: 512,
  },
];

export const FIXTURE_MIGRATION_DIFFS: MigrationDiff[] = [
  {
    fileName: "code-reviewer.yaml",
    agentName: "code-reviewer",
    fromVersion: "1.0.8",
    toVersion: "1.0.9",
    diff: "--- a/code-reviewer.yaml\n+++ b/code-reviewer.yaml\n-model: claude-opus-4.5\n+model: claude-opus-4.6",
    hasConflicts: false,
  },
  {
    fileName: "test-writer.yaml",
    agentName: "test-writer",
    fromVersion: "1.0.8",
    toVersion: "1.0.9",
    diff: "+name: test-writer\n+model: claude-sonnet-4.6",
    hasConflicts: false,
  },
];

export function setupConfigInjectorStoreTest(): void {
  setupPinia();
  vi.clearAllMocks();
  mocks.getAgentDefinitions.mockResolvedValue([]);
  mocks.getCopilotConfig.mockResolvedValue(null);
  mocks.discoverCopilotVersions.mockResolvedValue([]);
  mocks.getActiveCopilotVersion.mockResolvedValue(null);
  mocks.listConfigBackups.mockResolvedValue([]);
}

beforeEach(setupConfigInjectorStoreTest);
