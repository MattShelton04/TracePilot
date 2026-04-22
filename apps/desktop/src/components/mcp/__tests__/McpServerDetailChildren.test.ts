import { setupPinia } from "@tracepilot/test-utils";
import type { McpHealthResult, McpServerConfig, McpServerDetail, McpTool } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive, ref } from "vue";

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

vi.mock("@tracepilot/client", () => ({}));

import {
  McpServerDetailKey,
  type UseMcpServerDetailReturn,
} from "@/composables/useMcpServerDetail";
import McpServerDetailActions from "../McpServerDetailActions.vue";
import McpServerDetailConnection from "../McpServerDetailConnection.vue";
import McpServerDetailHeader from "../McpServerDetailHeader.vue";
import McpServerDetailHealth from "../McpServerDetailHealth.vue";
import McpServerDetailMetadata from "../McpServerDetailMetadata.vue";
import McpServerDetailTools from "../McpServerDetailTools.vue";

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    type: "stdio",
    command: "node",
    args: ["--flag"],
    description: "Local MCP",
    env: { API_KEY: "secret-value" },
    ...overrides,
  } as McpServerConfig;
}

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: "read_file",
    description: "Reads a file",
    estimatedTokens: 120,
    inputSchema: { type: "object" },
    ...overrides,
  } as McpTool;
}

function makeDetail(overrides: Partial<McpServerDetail> = {}): McpServerDetail {
  return {
    name: "github",
    config: makeConfig(),
    health: {
      status: "healthy",
      latencyMs: 42,
      checkedAt: "2026-04-10T10:00:00Z",
    } as McpHealthResult,
    tools: [makeTool()],
    totalTokens: 1200,
    ...overrides,
  } as McpServerDetail;
}

function makeCtx(overrides: Partial<UseMcpServerDetailReturn> = {}): UseMcpServerDetailReturn {
  const detail = makeDetail();
  const base = {
    store: reactive({ loading: false, error: null, serverList: [] }),
    serverName: ref(detail.name),
    server: ref(detail),
    saving: ref(false),
    deleting: ref(false),
    healthChecking: ref(false),
    toolSearch: ref(""),
    revealedKeys: ref(new Set<string>()),
    expandedTools: ref(new Set<string>()),
    editing: ref(false),
    editName: ref(detail.name),
    editConfig: ref(makeConfig()),
    healthStatus: ref("healthy"),
    statusText: ref("Connected"),
    statusColor: ref("success"),
    statusDotClass: ref("dot-connected"),
    latencyDisplay: ref<number | null>(42),
    lastCheckedDisplay: ref("Apr 10, 2026"),
    transportLabel: ref("stdio"),
    iconLetter: ref("G"),
    envEntries: ref<[string, string][]>([["API_KEY", "secret-value"]]),
    configToolFilters: ref<string[]>(["read_*"]),
    configHeaders: ref<[string, string][]>([["Authorization", "Bearer abc"]]),
    filteredTools: ref(detail.tools),
    tokensFormatted: ref("~1.2k"),
    toggleReveal: vi.fn(),
    toggleToolExpand: vi.fn(),
    handleCheckHealth: vi.fn(),
    handleDelete: vi.fn(),
    handleExportJson: vi.fn(),
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    onEditConfigUpdate: vi.fn(),
    handleSave: vi.fn(),
    goBack: vi.fn(),
  } as unknown as UseMcpServerDetailReturn;
  return { ...base, ...overrides } as UseMcpServerDetailReturn;
}

function wrap(child: unknown, ctx: UseMcpServerDetailReturn) {
  return defineComponent({
    setup() {
      provide(McpServerDetailKey, ctx);
      return () => h(child as never);
    },
  });
}

beforeEach(() => {
  setupPinia();
});

describe("McpServerDetailHeader", () => {
  it("renders the server name, icon letter and status text", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(McpServerDetailHeader, ctx));
    expect(wrapper.find(".detail-server-name").text()).toBe("github");
    expect(wrapper.find(".detail-server-icon").text()).toBe("G");
    expect(wrapper.text()).toContain("Connected");
    expect(wrapper.find(".status-dot-sm").classes()).toContain("dot-connected");
  });
});

describe("McpServerDetailConnection", () => {
  it("renders transport + command in read-only mode and triggers startEditing", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(McpServerDetailConnection, ctx));
    expect(wrapper.find(".transport-badge").text()).toBe("stdio");
    expect(wrapper.find(".config-code").text()).toBe("node");
    await wrapper.find(".btn-edit-inline").trigger("click");
    expect(ctx.startEditing).toHaveBeenCalled();
  });

  it("renders the edit form and wires Save/Cancel buttons", async () => {
    const ctx = makeCtx();
    ctx.editing.value = true;
    const wrapper = mount(wrap(McpServerDetailConnection, ctx));
    expect(wrapper.find(".edit-name-input").exists()).toBe(true);
    const buttons = wrapper.findAll(".edit-actions button");
    await buttons[0].trigger("click");
    expect(ctx.handleSave).toHaveBeenCalled();
    await buttons[1].trigger("click");
    expect(ctx.cancelEditing).toHaveBeenCalled();
  });
});

describe("McpServerDetailMetadata", () => {
  it("renders env, headers and tool-filter rows and toggles reveal on click", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(McpServerDetailMetadata, ctx));
    expect(wrapper.text()).toContain("API_KEY");
    expect(wrapper.text()).toContain("Authorization");
    expect(wrapper.text()).toContain("read_*");
    await wrapper.findAll(".toggle-vis")[0].trigger("click");
    expect(ctx.toggleReveal).toHaveBeenCalled();
  });

  it("hides metadata sections while editing", () => {
    const ctx = makeCtx();
    ctx.editing.value = true;
    const wrapper = mount(wrap(McpServerDetailMetadata, ctx));
    expect(wrapper.find(".config-section").exists()).toBe(false);
  });
});

describe("McpServerDetailActions", () => {
  it("invokes handleCheckHealth, handleExportJson and handleDelete", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(McpServerDetailActions, ctx));
    const actionBtns = wrapper.findAll(".actions-row .btn");
    await actionBtns[0].trigger("click");
    expect(ctx.handleCheckHealth).toHaveBeenCalled();
    await actionBtns[1].trigger("click");
    expect(ctx.handleExportJson).toHaveBeenCalled();
    await wrapper.find(".btn-danger-action").trigger("click");
    expect(ctx.handleDelete).toHaveBeenCalled();
  });
});

describe("McpServerDetailTools", () => {
  it("renders tool rows and toggles expand on click", async () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(McpServerDetailTools, ctx));
    expect(wrapper.findAll(".tool-item")).toHaveLength(1);
    expect(wrapper.text()).toContain("read_file");
    await wrapper.find(".tool-item").trigger("click");
    expect(ctx.toggleToolExpand).toHaveBeenCalledWith("read_file");
  });

  it("shows the empty state when no tools are discovered", () => {
    const ctx = makeCtx({
      server: ref(makeDetail({ tools: [] })),
      filteredTools: ref([]),
    } as unknown as Partial<UseMcpServerDetailReturn>);
    const wrapper = mount(wrap(McpServerDetailTools, ctx));
    expect(wrapper.find(".tool-empty").text()).toBe("No tools discovered");
  });
});

describe("McpServerDetailHealth", () => {
  it("renders the four health stat cards with derived values", () => {
    const ctx = makeCtx();
    const wrapper = mount(wrap(McpServerDetailHealth, ctx));
    const stats = wrapper.findAll(".health-stat");
    expect(stats).toHaveLength(4);
    expect(stats[0].text()).toContain("Connected");
    expect(stats[1].text()).toContain("42");
    expect(stats[2].text()).toContain("1");
    expect(stats[3].text()).toContain("~1.2k");
  });

  it("renders the error panel when health has an errorMessage", () => {
    const ctx = makeCtx({
      server: ref(
        makeDetail({
          health: {
            status: "unreachable",
            errorMessage: "connection refused",
          } as McpHealthResult,
        }),
      ),
    } as unknown as Partial<UseMcpServerDetailReturn>);
    const wrapper = mount(wrap(McpServerDetailHealth, ctx));
    expect(wrapper.find(".health-error").text()).toContain("connection refused");
  });
});
