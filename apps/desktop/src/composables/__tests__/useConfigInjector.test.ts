import { setupPinia } from "@tracepilot/test-utils";
import type { AgentDefinition, CopilotConfig } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

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

const storeState: {
  agents: AgentDefinition[];
  copilotConfig: CopilotConfig | null;
  activeVersion: { path: string } | null;
  error: string | null;
  editingYaml: string;
  saving: boolean;
  versions: unknown[];
  backups: unknown[];
  migrationDiffs: unknown[];
  selectedAgent: AgentDefinition | null;
} = {
  agents: [],
  copilotConfig: null,
  activeVersion: null,
  error: null,
  editingYaml: "",
  saving: false,
  versions: [],
  backups: [],
  migrationDiffs: [],
  selectedAgent: null,
};

const saveAgentFn = vi.fn().mockResolvedValue(true);
const initializeFn = vi.fn().mockResolvedValue(undefined);
const createBackupFn = vi.fn().mockResolvedValue(true);
const selectAgentFn = vi.fn((a: AgentDefinition) => {
  storeState.selectedAgent = a;
});

vi.mock("@/stores/configInjector", () => ({
  useConfigInjectorStore: () => ({
    ...storeState,
    initialize: initializeFn,
    selectAgent: selectAgentFn,
    saveAgent: saveAgentFn,
    saveGlobalConfig: vi.fn(),
    createBackup: createBackupFn,
    restoreBackup: vi.fn(),
    deleteBackup: vi.fn(),
    loadMigrationDiffs: vi.fn(),
    migrateAgent: vi.fn(),
  }),
}));

import { TOOLS_COLLAPSE_LIMIT, useConfigInjector } from "../useConfigInjector";

function harness() {
  let api!: ReturnType<typeof useConfigInjector>;
  const Cmp = defineComponent({
    setup() {
      api = useConfigInjector();
      return () => h("div");
    },
  });
  const wrapper = mount(Cmp);
  return {
    wrapper,
    get api() {
      return api;
    },
  };
}

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "explore",
    filePath: "/agents/explore.md",
    description: "Fast explorer",
    model: "claude-haiku-4.5",
    tools: ["read", "grep", "glob"],
    rawYaml: "name: explore\nmodel: claude-haiku-4.5\n",
    ...overrides,
  } as AgentDefinition;
}

beforeEach(() => {
  setupPinia();
  storeState.agents = [];
  storeState.copilotConfig = null;
  storeState.activeVersion = null;
  storeState.error = null;
  storeState.editingYaml = "";
  storeState.saving = false;
  storeState.selectedAgent = null;
  saveAgentFn.mockClear();
  initializeFn.mockClear();
  createBackupFn.mockClear();
  selectAgentFn.mockClear();
});

describe("useConfigInjector", () => {
  it("visibleTools / hiddenToolCount honours the collapse limit", () => {
    const { api, wrapper } = harness();
    const manyTools = Array.from({ length: TOOLS_COLLAPSE_LIMIT + 3 }, (_, i) => `t${i}`);
    const agent = makeAgent({ tools: manyTools });

    expect(api.visibleTools(agent)).toHaveLength(TOOLS_COLLAPSE_LIMIT);
    expect(api.hiddenToolCount(agent)).toBe(3);

    api.expandedTools[agent.filePath] = true;
    expect(api.visibleTools(agent)).toHaveLength(TOOLS_COLLAPSE_LIMIT + 3);
    wrapper.unmount();
  });

  it("addFolder / removeFolder mutate the trusted folders list and clear input", () => {
    const { api, wrapper } = harness();
    api.newFolder.value = "/some/path";
    api.addFolder();
    expect(api.editTrustedFolders.value).toEqual(["/some/path"]);
    expect(api.newFolder.value).toBe("");

    // Duplicate is ignored
    api.newFolder.value = "/some/path";
    api.addFolder();
    expect(api.editTrustedFolders.value).toEqual(["/some/path"]);

    api.removeFolder(0);
    expect(api.editTrustedFolders.value).toEqual([]);
    wrapper.unmount();
  });

  it("formatBackupLabel derives a human label from the backup filename", () => {
    const { api, wrapper } = harness();
    const label = api.formatBackupLabel({
      label: "manual",
      backupPath: "/backups/explore-manual-20260101-120000.md",
      sourcePath: "/agents/explore.md",
    });
    expect(label).toContain("Explore");
    expect(label).toContain("(manual)");
    wrapper.unmount();
  });

  it("syncGlobalFields populates edit refs from store.copilotConfig", () => {
    storeState.copilotConfig = {
      model: "claude-sonnet-4.5",
      reasoningEffort: "high",
      trustedFolders: ["/a", "/b"],
      raw: { showReasoning: true, renderMarkdown: false },
    } as CopilotConfig;
    const { api, wrapper } = harness();
    api.syncGlobalFields();
    expect(api.editModel.value).toBe("claude-sonnet-4.5");
    expect(api.editReasoningEffort.value).toBe("high");
    expect(api.editTrustedFolders.value).toEqual(["/a", "/b"]);
    expect(api.editShowReasoning.value).toBe(true);
    expect(api.editRenderMarkdown.value).toBe(false);
    wrapper.unmount();
  });

  it("toggleDeleteBackup requires a second click to confirm", async () => {
    const deleteBackup = vi.fn().mockResolvedValue(true);
    // re-mock by directly driving the API surface
    const { api, wrapper } = harness();
    (api.store as any).deleteBackup = deleteBackup;
    const backup = { id: "b1", backupPath: "/p" };

    await api.toggleDeleteBackup(backup);
    expect(api.confirmingDeleteBackupId.value).toBe("b1");
    expect(deleteBackup).not.toHaveBeenCalled();

    await api.toggleDeleteBackup(backup);
    expect(deleteBackup).toHaveBeenCalledWith("/p");
    expect(api.confirmingDeleteBackupId.value).toBeNull();
    wrapper.unmount();
  });
});
