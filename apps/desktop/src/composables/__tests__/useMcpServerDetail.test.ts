import type { McpHealthResult, McpServerConfig, McpServerDetail } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
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
  };
});

vi.mock("@tracepilot/client", () => ({}));

const routerPush = vi.fn();
const routerReplace = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { name: "github" } }),
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));

const storeState = {
  loading: false,
  error: null as string | null,
  serverList: [] as McpServerDetail[],
};

const detailRef = ref<McpServerDetail | undefined>(undefined);

const storeActions = {
  loadServers: vi.fn().mockResolvedValue(undefined),
  addServer: vi.fn().mockResolvedValue(true),
  updateServer: vi.fn().mockResolvedValue(true),
  removeServer: vi.fn().mockResolvedValue(true),
  checkServerHealth: vi.fn().mockResolvedValue({}),
  getServerDetail: vi.fn(() => detailRef.value),
};

vi.mock("@/stores/mcp", () => ({
  useMcpStore: () =>
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

import { useMcpServerDetail } from "../useMcpServerDetail";

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    type: "stdio",
    command: "node",
    args: ["--flag"],
    env: { API_KEY: "x" },
    ...overrides,
  } as McpServerConfig;
}

function makeDetail(overrides: Partial<McpServerDetail> = {}): McpServerDetail {
  return {
    name: "github",
    config: makeConfig(),
    health: { status: "healthy", latencyMs: 30, checkedAt: "2026-04-10T10:00:00Z" } as McpHealthResult,
    tools: [
      { name: "read_file", description: "Reads a file", estimatedTokens: 120 },
      { name: "write_file", description: "Writes a file", estimatedTokens: 200 },
    ],
    totalTokens: 1500,
    ...overrides,
  } as McpServerDetail;
}

function harness() {
  let api!: ReturnType<typeof useMcpServerDetail>;
  const Cmp = defineComponent({
    setup() {
      api = useMcpServerDetail();
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
  storeState.loading = false;
  storeState.error = null;
  storeState.serverList = [];
  detailRef.value = makeDetail();
  routerPush.mockClear();
  routerReplace.mockClear();
  Object.values(storeActions).forEach((fn) => fn.mockClear?.());
  storeActions.addServer.mockResolvedValue(true);
  storeActions.updateServer.mockResolvedValue(true);
  storeActions.removeServer.mockResolvedValue(true);
  storeActions.getServerDetail.mockImplementation(() => detailRef.value);
});

describe("useMcpServerDetail", () => {
  it("derives status text, colour and dot class across health states", async () => {
    const { api, wrapper } = harness();
    expect(api.statusText.value).toBe("Connected");
    expect(api.statusColor.value).toBe("success");
    expect(api.statusDotClass.value).toBe("dot-connected");

    detailRef.value = makeDetail({
      health: { status: "unreachable", errorMessage: "x" } as McpHealthResult,
    });
    await nextTick();
    expect(api.statusText.value).toBe("Error");
    expect(api.statusColor.value).toBe("danger");
    expect(api.statusDotClass.value).toBe("dot-error");

    detailRef.value = makeDetail({ health: undefined });
    await nextTick();
    expect(api.statusText.value).toBe("Unknown");
    expect(api.statusColor.value).toBe("neutral");
    expect(api.statusDotClass.value).toBe("");
    wrapper.unmount();
  });

  it("formats tokensFormatted with a 1000-token boundary", async () => {
    detailRef.value = makeDetail({ totalTokens: 500 });
    const { api, wrapper } = harness();
    expect(api.tokensFormatted.value).toBe("~500");
    detailRef.value = makeDetail({ totalTokens: 2500 });
    await nextTick();
    expect(api.tokensFormatted.value).toBe("~2.5k");
    wrapper.unmount();
  });

  it("filteredTools narrows by name or description substring", async () => {
    const { api, wrapper } = harness();
    expect(api.filteredTools.value).toHaveLength(2);
    api.toolSearch.value = "write";
    await nextTick();
    expect(api.filteredTools.value).toHaveLength(1);
    expect(api.filteredTools.value[0].name).toBe("write_file");
    api.toolSearch.value = "reads";
    await nextTick();
    expect(api.filteredTools.value).toHaveLength(1);
    expect(api.filteredTools.value[0].name).toBe("read_file");
    wrapper.unmount();
  });

  it("toggleReveal adds then removes a key on subsequent calls", () => {
    const { api, wrapper } = harness();
    expect(api.revealedKeys.value.has("API_KEY")).toBe(false);
    api.toggleReveal("API_KEY");
    expect(api.revealedKeys.value.has("API_KEY")).toBe(true);
    api.toggleReveal("API_KEY");
    expect(api.revealedKeys.value.has("API_KEY")).toBe(false);
    wrapper.unmount();
  });

  it("handleSave rolls back the new entry when old-entry removal fails", async () => {
    const { api, wrapper } = harness();
    api.startEditing();
    api.editName.value = "github-renamed";
    storeActions.addServer.mockResolvedValueOnce(true);
    storeActions.removeServer
      .mockResolvedValueOnce(false) // old entry remove fails
      .mockResolvedValueOnce(true); // rollback succeeds
    await api.handleSave();
    expect(storeActions.addServer).toHaveBeenCalledWith("github-renamed", expect.any(Object));
    // First remove targets the old name; rollback removes the just-added new name.
    expect(storeActions.removeServer).toHaveBeenNthCalledWith(1, "github");
    expect(storeActions.removeServer).toHaveBeenNthCalledWith(2, "github-renamed");
    expect(routerReplace).not.toHaveBeenCalled();
    expect(api.editing.value).toBe(true);
    wrapper.unmount();
  });
});
