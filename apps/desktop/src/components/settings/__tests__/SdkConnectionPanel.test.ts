import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import SdkConnectionPanel from "../SdkConnectionPanel.vue";

const mocks = vi.hoisted(() => ({
  sdk: {
    savedCliUrl: "",
    savedLogLevel: "info",
    connectionState: "disconnected" as string,
    connectionMode: null as string | null,
    isConnected: false,
    isConnecting: false,
    isTcpMode: false,
    authStatus: null as null | { isAuthenticated: boolean; login: string | null },
    lastError: null as string | null,
    models: [] as unknown[],
    updateSettings: vi.fn(),
    disconnect: vi.fn(),
    detectUiServer: vi.fn(),
    connectToServer: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => mocks.sdk,
}));

function makeHealth() {
  return {
    isEnabled: computed(() => true),
    selectedMode: ref<"stdio" | "tcp">("stdio"),
    tcpConnectError: ref<string | null>(null),
    cliUrl: computed({ get: () => mocks.sdk.savedCliUrl, set: () => {} }),
    logLevel: computed({ get: () => mocks.sdk.savedLogLevel, set: () => {} }),
    connectionLabel: computed(() => "Disconnected"),
    isTcpSelected: computed(() => false),
    isActiveServer: () => false,
    handleConnect: vi.fn(async () => {}),
    handleDisconnect: vi.fn(async () => {}),
    handleModeChange: vi.fn(),
    handleConnectToServer: vi.fn(async () => {}),
    refreshAll: vi.fn(async () => {}),
    syncModeFromBackend: vi.fn(),
  };
}

describe("SdkConnectionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.sdk, {
      isConnected: false,
      isConnecting: false,
      authStatus: null,
      lastError: null,
      connectionState: "disconnected",
    });
  });

  it("renders without throwing and shows the connect button when disconnected", () => {
    const wrapper = mount(SdkConnectionPanel, {
      props: { health: makeHealth(), sessionCountLabel: "No tracked sessions" },
      global: {
        stubs: {
          ActionButton: { template: "<button><slot /></button>" },
          BtnGroup: { template: "<div data-testid='btn-group' />" },
        },
      },
    });
    expect(wrapper.text()).toContain("Connection");
    expect(wrapper.text()).toContain("Connect");
    expect(wrapper.find("[data-testid='btn-group']").exists()).toBe(true);
  });

  it("shows last error when the SDK store has one", () => {
    mocks.sdk.lastError = "boom";
    const wrapper = mount(SdkConnectionPanel, {
      props: { health: makeHealth(), sessionCountLabel: "" },
      global: {
        stubs: {
          ActionButton: { template: "<button><slot /></button>" },
          BtnGroup: { template: "<div />" },
        },
      },
    });
    expect(wrapper.text()).toContain("Last error");
    expect(wrapper.text()).toContain("boom");
  });
});
