import { setupPinia } from "@tracepilot/test-utils";
import type { ModelInfo, SessionTemplate } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

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
    useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue({ confirmed: true }) }),
    useClipboard: () => ({ copy: vi.fn().mockResolvedValue(true) }),
  };
});

vi.mock("@tracepilot/client", () => ({
  fetchRemote: vi.fn(),
  getDefaultBranch: vi.fn().mockResolvedValue(""),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
}));

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/composables/useGitRepository", () => ({
  useGitRepository: () => ({
    defaultBranch: ref("main"),
    fetchingRemote: ref(false),
    fetchRemote: vi.fn(),
    computeWorktreePath: (b: string) => `/root/${b}`,
  }),
}));

const storeState: {
  models: ModelInfo[];
  templates: SessionTemplate[];
  recentLaunches: unknown[];
  systemDeps: { gitAvailable: boolean; copilotAvailable: boolean } | null;
  loading: boolean;
  error: string | null;
  isReady: boolean;
  modelsByTier: Record<string, ModelInfo[]>;
} = {
  models: [],
  templates: [],
  recentLaunches: [],
  systemDeps: { gitAvailable: true, copilotAvailable: true },
  loading: false,
  error: null,
  isReady: true,
  modelsByTier: {},
};

const storeActions = {
  initialize: vi.fn(),
  launch: vi.fn().mockResolvedValue(null),
  saveTemplate: vi.fn().mockResolvedValue(undefined),
  deleteTemplate: vi.fn().mockResolvedValue(undefined),
  restoreDefaults: vi.fn(),
  incrementUsage: vi.fn(),
};

vi.mock("@/stores/launcher", () => ({
  useLauncherStore: () =>
    new Proxy(
      { ...storeState, ...storeActions },
      {
        get: (_t, p: string) =>
          (storeState as Record<string, unknown>)[p] ??
          (storeActions as Record<string, unknown>)[p],
        set: (_t, p: string, v) => {
          (storeState as Record<string, unknown>)[p] = v;
          return true;
        },
      },
    ),
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    recentRepoPaths: [],
    cliCommand: "copilot",
    costPerPremiumRequest: 0.04,
    addRecentRepoPath: vi.fn(),
    getPremiumRequests: () => 1,
  }),
}));

vi.mock("@/stores/worktrees", () => ({
  useWorktreesStore: () => ({
    registeredRepos: [],
    branches: [],
    loadBranches: vi.fn(),
    loadRegisteredRepos: vi.fn().mockResolvedValue(undefined),
    discoverRepos: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { useSessionLauncher } from "../useSessionLauncher";

function makeTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
  return {
    id: "tpl-1",
    name: "🚀 Review",
    description: "Review task",
    category: "",
    icon: "",
    tags: [],
    config: {
      repoPath: "C:\\repo",
      branch: "feat/x",
      model: "claude-sonnet-4.5",
      reasoningEffort: "high",
      headless: false,
      createWorktree: true,
      baseBranch: "main",
      autoApprove: true,
      prompt: "hello",
      customInstructions: "",
      envVars: { FOO: "bar" },
      cliCommand: "copilot",
    },
    createdAt: "2026-01-01T00:00:00Z",
    usageCount: 0,
    ...overrides,
  } as SessionTemplate;
}

function harness() {
  let api!: ReturnType<typeof useSessionLauncher>;
  const Cmp = defineComponent({
    setup() {
      api = useSessionLauncher();
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

beforeEach(() => {
  setupPinia();
  storeState.templates = [];
  storeState.models = [];
  storeState.recentLaunches = [];
  storeState.loading = false;
  storeState.error = null;
  Object.values(storeActions).forEach((fn) => {
    fn.mockClear?.();
  });
});

describe("useSessionLauncher", () => {
  it("tierLabel handles tier and reasoning-effort strings", () => {
    const { api, wrapper } = harness();
    expect(api.tierLabel("low")).toBe("Low");
    expect(api.tierLabel("high")).toBe("High");
    // Known tier strings pass through getTierLabel — still produce a non-empty label
    expect(api.tierLabel("premium").length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("templateIcon falls back to the leading emoji when no icon is set", () => {
    const { api, wrapper } = harness();
    expect(api.templateIcon(makeTemplate({ icon: "" }))).toBe("🚀");
    expect(api.templateIcon(makeTemplate({ icon: "🐛", name: "No emoji" }))).toBe("🐛");
    expect(api.templateDisplayName("🚀 Review")).toBe("Review");
    wrapper.unmount();
  });

  it("applyTemplate copies config into form state; clicking same id clears it", () => {
    const { api, wrapper } = harness();
    const tpl = makeTemplate();
    storeState.templates = [tpl];

    api.applyTemplate("tpl-1");
    expect(api.selectedTemplateId.value).toBe("tpl-1");
    expect(api.repoPath.value).toBe("C:\\repo");
    expect(api.branch.value).toBe("feat/x");
    expect(api.selectedModel.value).toBe("claude-sonnet-4.5");
    expect(api.reasoningEffort.value).toBe("high");
    expect(api.createWorktree.value).toBe(true);
    expect(api.autoApprove.value).toBe(true);
    expect(api.baseBranch.value).toBe("main");
    expect(api.envVars).toEqual([{ key: "FOO", value: "bar" }]);

    // Second click on same id acts as a toggle-off
    api.applyTemplate("tpl-1");
    expect(api.selectedTemplateId.value).toBeNull();
    wrapper.unmount();
  });

  it("moveTemplate reorders templates in both directions and respects bounds", () => {
    const { api, wrapper } = harness();
    storeState.templates = [
      makeTemplate({ id: "a", name: "A" }),
      makeTemplate({ id: "b", name: "B" }),
      makeTemplate({ id: "c", name: "C" }),
    ];

    api.moveTemplate(0, "up"); // no-op
    expect(api.store.templates.map((t) => t.id)).toEqual(["a", "b", "c"]);

    api.moveTemplate(0, "down");
    expect(api.store.templates.map((t) => t.id)).toEqual(["b", "a", "c"]);

    api.moveTemplate(2, "down"); // no-op at bottom
    expect(api.store.templates.map((t) => t.id)).toEqual(["b", "a", "c"]);
    wrapper.unmount();
  });

  it("deleteTemplateInline is a two-click confirm", async () => {
    const { api, wrapper } = harness();
    storeState.templates = [makeTemplate()];

    await api.deleteTemplateInline("tpl-1");
    expect(api.confirmingDeleteId.value).toBe("tpl-1");
    expect(storeActions.deleteTemplate).not.toHaveBeenCalled();

    await api.deleteTemplateInline("tpl-1");
    expect(storeActions.deleteTemplate).toHaveBeenCalledWith("tpl-1");
    expect(api.confirmingDeleteId.value).toBeNull();
    wrapper.unmount();
  });

  it("cliCommandParts reflects the launch config flags", () => {
    const { api, wrapper } = harness();
    api.selectedModel.value = "claude-sonnet-4.5";
    api.autoApprove.value = true;
    api.prompt.value = "do it";
    const parts = api.cliCommandParts.value;
    const flags = parts.map((p) => p.flag);
    expect(flags).toContain("--model");
    expect(flags).toContain("--allow-all");
    expect(flags).toContain("--reasoning-effort");
    expect(flags).toContain("--interactive");
    wrapper.unmount();
  });

  it("canLaunch requires repoPath (and branch when createWorktree is on)", () => {
    const { api, wrapper } = harness();
    expect(api.canLaunch.value).toBe(false);
    api.repoPath.value = "C:\\repo";
    expect(api.canLaunch.value).toBe(true);
    api.createWorktree.value = true;
    expect(api.canLaunch.value).toBe(false);
    api.branch.value = "feat/x";
    expect(api.canLaunch.value).toBe(true);
    wrapper.unmount();
  });
});
