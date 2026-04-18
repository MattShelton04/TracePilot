import type { ModelInfo, SessionTemplate } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, provide, reactive, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    useConfirmDialog: () => ({ confirm: vi.fn() }),
    useClipboard: () => ({ copy: vi.fn().mockResolvedValue(true) }),
  };
});

vi.mock("@tracepilot/client", () => ({}));

import {
  SessionLauncherKey,
  type UseSessionLauncherReturn,
} from "@/composables/useSessionLauncher";
import SessionLauncherAdvanced from "../SessionLauncherAdvanced.vue";
import SessionLauncherConfig from "../SessionLauncherConfig.vue";
import SessionLauncherPreview from "../SessionLauncherPreview.vue";
import SessionLauncherPrompt from "../SessionLauncherPrompt.vue";
import SessionLauncherSaveTemplate from "../SessionLauncherSaveTemplate.vue";
import SessionLauncherTemplates from "../SessionLauncherTemplates.vue";

function makeTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
  return {
    id: "tpl-1",
    name: "🚀 Test Template",
    description: "Test description",
    category: "",
    icon: "",
    tags: [],
    config: {
      repoPath: "",
      reasoningEffort: "medium",
      headless: false,
      createWorktree: false,
      autoApprove: false,
      envVars: {},
      cliCommand: "copilot",
    },
    createdAt: "2026-01-01T00:00:00Z",
    usageCount: 3,
    ...overrides,
  } as SessionTemplate;
}

function makeCtx(overrides: Partial<UseSessionLauncherReturn> = {}): UseSessionLauncherReturn {
  const tpl = makeTemplate();
  const models: ModelInfo[] = [
    { id: "claude-sonnet-4.5", name: "Sonnet 4.5", tier: "premium" } as ModelInfo,
  ];
  const base = {
    store: reactive({
      models,
      templates: [tpl],
      recentLaunches: [],
      systemDeps: { gitAvailable: true, copilotAvailable: true },
      loading: false,
      error: null,
      isReady: true,
      modelsByTier: { premium: models },
      initialize: vi.fn(),
      launch: vi.fn().mockResolvedValue(null),
      saveTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
      restoreDefaults: vi.fn(),
      incrementUsage: vi.fn(),
    }),
    prefsStore: reactive({
      recentRepoPaths: [],
      cliCommand: "copilot",
      costPerPremiumRequest: 0.04,
      addRecentRepoPath: vi.fn(),
      getPremiumRequests: () => 1,
    }),
    worktreeStore: reactive({
      registeredRepos: [],
      branches: [],
      loadBranches: vi.fn(),
      loadRegisteredRepos: vi.fn(),
      discoverRepos: vi.fn(),
    }),
    repoPath: ref(""),
    branch: ref(""),
    selectedModel: ref(""),
    createWorktree: ref(false),
    autoApprove: ref(false),
    headless: ref(false),
    reasoningEffort: ref<"low" | "medium" | "high">("medium"),
    prompt: ref(""),
    customInstructions: ref(""),
    envVars: reactive([] as { key: string; value: string }[]),
    baseBranch: ref(""),
    launching: ref(false),
    selectedTemplateId: ref<string | null>(null),
    showAdvanced: ref(false),
    showTemplateForm: ref(false),
    templateForm: reactive({ name: "", description: "", category: "", icon: "" }),
    contextMenuTpl: ref<{ id: string; x: number; y: number } | null>(null),
    confirmingDeleteId: ref<string | null>(null),
    defaultBranch: ref("main"),
    fetchingRemote: ref(false),
    handleFetchRemote: vi.fn(),
    resetBranch: vi.fn(),
    computeWorktreePath: (b: string) => `/root/${b}`,
    selectedModelInfo: computed(() => undefined),
    selectedTemplateName: computed(() => "Custom"),
    launchConfig: computed(() => ({}) as never),
    cliCommand: computed(() => "copilot"),
    cliCommandParts: computed(() => [{ flag: "copilot" }] as { flag: string; value?: string }[]),
    worktreePreviewPath: computed(() => ""),
    estimatedCost: computed(() => "Free"),
    canLaunch: computed(() => true),
    hasDismissedDefaults: computed(() => false),
    tierLabel: (t: string) => t,
    templateIcon: () => "🚀",
    templateDisplayName: (n: string) => n,
    applyTemplate: vi.fn(),
    clearTemplateSelection: vi.fn(),
    moveTemplate: vi.fn(),
    deleteTemplateInline: vi.fn(),
    cancelDeleteInline: vi.fn(),
    selectRecentRepo: vi.fn(),
    handleBrowseRepo: vi.fn(),
    addEnvVar: vi.fn(),
    removeEnvVar: vi.fn(),
    handleLaunch: vi.fn(),
    handleSaveTemplate: vi.fn(),
    openContextMenu: vi.fn(),
    deleteContextTemplate: vi.fn(),
    closeContextMenu: vi.fn(),
    copyCommand: vi.fn(),
  } as unknown as UseSessionLauncherReturn;
  return { ...base, ...overrides } as UseSessionLauncherReturn;
}

function wrap(child: unknown, ctx: UseSessionLauncherReturn) {
  return defineComponent({
    setup() {
      provide(SessionLauncherKey, ctx);
      return () => h(child as never);
    },
  });
}

beforeEach(() => {
  setupPinia();
});

describe("SessionLauncherTemplates", () => {
  it("renders template cards with icon, name and usage count", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherTemplates, ctx));
    expect(wrapper.findAll(".tpl-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("Test Template");
    expect(wrapper.text()).toContain("Used 3 times");
  });

  it("invokes applyTemplate when a template card is clicked", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherTemplates, ctx));
    await wrapper.find(".tpl-card").trigger("click");
    expect(ctx.applyTemplate).toHaveBeenCalledWith("tpl-1");
  });
});

describe("SessionLauncherConfig", () => {
  it("renders repo, branch, model and reasoning controls", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherConfig, ctx));
    expect(wrapper.find('input[type="text"]').exists()).toBe(true);
    expect(wrapper.findAll(".btn-group-item")).toHaveLength(3);
    expect(wrapper.find(".form-select").exists()).toBe(true);
  });

  it("sets reasoningEffort when a level button is clicked", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherConfig, ctx));
    const buttons = wrapper.findAll(".btn-group-item");
    await buttons[2].trigger("click"); // high
    expect(ctx.reasoningEffort.value).toBe("high");
    expect(ctx.clearTemplateSelection).toHaveBeenCalled();
  });
});

describe("SessionLauncherPrompt", () => {
  it("binds the prompt textarea to the shared context ref", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherPrompt, ctx));
    const ta = wrapper.find("textarea");
    await ta.setValue("Do the thing");
    expect(ctx.prompt.value).toBe("Do the thing");
  });
});

describe("SessionLauncherAdvanced", () => {
  it("toggles the advanced panel open when trigger is clicked", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherAdvanced, ctx));
    expect(wrapper.find(".adv-panel").exists()).toBe(false);
    await wrapper.find(".advanced-trigger").trigger("click");
    expect(ctx.showAdvanced.value).toBe(true);
  });

  it("flips autoApprove when its toggle switch is clicked", async () => {
    const ctx = makeCtx();
    ctx.showAdvanced.value = true;
    const wrapper = mount(wrap(SessionLauncherAdvanced, ctx));
    const toggles = wrapper.findAll(".toggle-switch");
    await toggles[0].trigger("click");
    expect(ctx.autoApprove.value).toBe(true);
  });

  it("invokes addEnvVar from the + Add Variable button", async () => {
    const ctx = makeCtx();
    ctx.showAdvanced.value = true;
    const wrapper = mount(wrap(SessionLauncherAdvanced, ctx));
    await wrapper.find(".btn-add-var").trigger("click");
    expect(ctx.addEnvVar).toHaveBeenCalled();
  });
});

describe("SessionLauncherSaveTemplate", () => {
  it("renders the save-as-template toggle", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherSaveTemplate, ctx));
    expect(wrapper.find(".tpl-save-toggle").exists()).toBe(true);
    expect(wrapper.text()).toContain("Save as Template");
  });

  it("calls handleSaveTemplate when Save Template button is clicked", async () => {
    const ctx = makeCtx();
    ctx.showTemplateForm.value = true;
    ctx.templateForm.name = "My tpl";
    const wrapper = mount(wrap(SessionLauncherSaveTemplate, ctx));
    await wrapper.find(".btn-primary").trigger("click");
    expect(ctx.handleSaveTemplate).toHaveBeenCalled();
  });
});

describe("SessionLauncherPreview", () => {
  it("renders meta grid, config summary and CLI command section", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherPreview, ctx));
    expect(wrapper.findAll(".meta-card")).toHaveLength(4);
    expect(wrapper.find(".cmd-block").exists()).toBe(true);
    expect(wrapper.text()).toContain("Live Preview");
    expect(wrapper.text()).toContain("Command Preview");
  });

  it("invokes handleLaunch when the footer primary button is clicked", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherPreview, ctx));
    await wrapper.find(".footer-btn-primary").trigger("click");
    expect(ctx.handleLaunch).toHaveBeenCalledWith(false);
  });

  it("invokes copyCommand from the Copy button", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(SessionLauncherPreview, ctx));
    await wrapper.find(".cmd-copy").trigger("click");
    expect(ctx.copyCommand).toHaveBeenCalled();
  });
});
