import { setupPinia } from "@tracepilot/test-utils";
import type {
  AgentDefinition,
  BackupEntry,
  CopilotConfig,
  CopilotVersion,
  MigrationDiff,
} from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, provide, reactive, ref } from "vue";

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      show: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

vi.mock("@tracepilot/client", () => ({
  previewBackupRestore: vi.fn(),
}));

import { ConfigInjectorKey, type UseConfigInjectorReturn } from "@/composables/useConfigInjector";
import ConfigInjectorAgentsTab from "../ConfigInjectorAgentsTab.vue";
import ConfigInjectorBackupsTab from "../ConfigInjectorBackupsTab.vue";
import ConfigInjectorGlobalTab from "../ConfigInjectorGlobalTab.vue";
import ConfigInjectorVersionsTab from "../ConfigInjectorVersionsTab.vue";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "explore",
    filePath: "/agents/explore.md",
    description: "Fast explorer",
    model: "claude-haiku-4.5",
    tools: ["read", "grep"],
    rawYaml: "model: claude-haiku-4.5\n",
    ...overrides,
  } as AgentDefinition;
}

function makeCtx(overrides: Partial<UseConfigInjectorReturn> = {}): UseConfigInjectorReturn {
  const agent = makeAgent();
  const base: UseConfigInjectorReturn = {
    store: reactive({
      activeTab: "agents",
      agents: [agent],
      copilotConfig: {
        model: "claude-sonnet-4.5",
        reasoningEffort: "medium",
        trustedFolders: [],
        disabledSkills: [],
        raw: {},
        settingsPath: "/home/user/.copilot/settings.json",
      } as CopilotConfig,
      versions: [
        {
          version: "1.0.0",
          isActive: true,
          isComplete: true,
          hasCustomizations: false,
          lockCount: 0,
          path: "/p",
        } as CopilotVersion,
        {
          version: "1.1.0",
          isActive: false,
          isComplete: true,
          hasCustomizations: true,
          lockCount: 1,
          path: "/p2",
        } as CopilotVersion,
      ],
      activeVersion: null,
      backups: [] as BackupEntry[],
      migrationDiffs: [] as MigrationDiff[],
      selectedAgent: null,
      editingYaml: "",
      loading: false,
      saving: false,
      error: null,
      hasCustomizations: false,
      activeVersionStr: "1.0.0",
      initialize: vi.fn(),
      selectAgent: vi.fn(),
      saveAgent: vi.fn().mockResolvedValue(true),
      saveGlobalConfig: vi.fn(),
      createBackup: vi.fn(),
      restoreBackup: vi.fn(),
      deleteBackup: vi.fn(),
      loadMigrationDiffs: vi.fn(),
      migrateAgent: vi.fn(),
    }) as unknown as UseConfigInjectorReturn["store"],
    expandedTools: reactive({}),
    visibleTools: (a: AgentDefinition) => a.tools ?? [],
    hiddenToolCount: () => 0,
    autoSavedAgent: ref<string | null>(null),
    agentModels: ref<Record<string, string>>({ [agent.filePath]: agent.model }),
    onAgentModelSelect: vi.fn(),
    upgradeAgent: vi.fn(),
    batchUpgrading: ref(false),
    upgradeAllToOpus: vi.fn(),
    resetAllDefaults: vi.fn(),
    editModel: ref("claude-sonnet-4.5"),
    editReasoningEffort: ref("medium"),
    editShowReasoning: ref(false),
    editRenderMarkdown: ref(true),
    editTrustedFolders: ref<string[]>([]),
    newFolder: ref(""),
    syncGlobalFields: vi.fn(),
    addFolder: vi.fn(),
    removeFolder: vi.fn(),
    configDiffLines: computed(() => ({ left: [], right: [] })),
    hasConfigChanges: computed(() => false),
    handleSaveGlobalConfig: vi.fn(),
    migrationFrom: ref(""),
    migrationTo: ref(""),
    handleLoadDiffs: vi.fn(),
    handleMigrateAgent: vi.fn(),
    newBackupPath: ref(""),
    newBackupLabel: ref(""),
    backupableFiles: computed(() => []),
    handleCreateBackup: vi.fn(),
    batchBackingUp: ref(false),
    handleBackupAllAgents: vi.fn(),
    backupEmoji: () => "🤖",
    formatBackupLabel: () => "Test Backup",
    confirmingDeleteBackupId: ref<string | null>(null),
    toggleDeleteBackup: vi.fn(),
    previewingBackupId: ref<string | null>(null),
    backupDiffLoading: ref(false),
    backupDiffData: ref(null),
    toggleBackupPreview: vi.fn(),
  } as unknown as UseConfigInjectorReturn;
  return { ...base, ...overrides } as UseConfigInjectorReturn;
}

function wrap(child: any, ctx: UseConfigInjectorReturn) {
  return defineComponent({
    setup() {
      provide(ConfigInjectorKey, ctx);
      return () => h(child);
    },
  });
}

beforeEach(() => {
  setupPinia();
});

describe("ConfigInjectorAgentsTab", () => {
  it("renders agent cards with stat grid and batch actions", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(ConfigInjectorAgentsTab, ctx));
    expect(wrapper.findAll(".agent-card")).toHaveLength(1);
    expect(wrapper.findAll(".stat-grid > *")).toHaveLength(4);
    expect(wrapper.find(".batch-actions").exists()).toBe(true);
    expect(wrapper.text()).toContain("explore");
  });

  it("invokes upgradeAllToOpus when batch button clicked", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(ConfigInjectorAgentsTab, ctx));
    await wrapper.find(".btn-gradient").trigger("click");
    expect(ctx.upgradeAllToOpus).toHaveBeenCalled();
  });
});

describe("ConfigInjectorGlobalTab", () => {
  it("renders config form with default model select", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(ConfigInjectorGlobalTab, ctx));
    expect(wrapper.find(".config-form").exists()).toBe(true);
    expect(wrapper.findAll(".toggle-btn")).toHaveLength(3);
    expect(wrapper.findAll(".switch-track")).toHaveLength(2);
  });
});

describe("ConfigInjectorVersionsTab", () => {
  it("renders version cards and migration panel", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(ConfigInjectorVersionsTab, ctx));
    expect(wrapper.findAll(".version-card")).toHaveLength(2);
    expect(wrapper.find(".migration-panel").exists()).toBe(true);
    expect(wrapper.text()).toContain("v1.0.0");
  });
});

describe("ConfigInjectorBackupsTab", () => {
  it("renders create-backup form and empty state when no backups exist", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(ConfigInjectorBackupsTab, ctx));
    expect(wrapper.find(".backup-create").exists()).toBe(true);
    expect(wrapper.text()).toContain("No Backups Yet");
  });

  it("renders backup list items when backups exist", () => {
    const ctx = makeCtx();
    (ctx.store as any).backups = [
      {
        id: "b1",
        label: "manual",
        backupPath: "/backups/agent-manual-20260101-120000.md",
        sourcePath: "/agents/explore.md",
        createdAt: "2026-01-01T12:00:00Z",
        sizeBytes: 100,
      },
    ];
    const wrapper = mount(wrap(ConfigInjectorBackupsTab, ctx));
    expect(wrapper.findAll(".backup-item-wrapper")).toHaveLength(1);
  });
});
