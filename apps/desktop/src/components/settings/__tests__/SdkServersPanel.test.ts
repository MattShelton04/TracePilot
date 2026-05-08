import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import SdkServersPanel from "../SdkServersPanel.vue";

const mocks = vi.hoisted(() => ({
  sdk: {
    savedCliUrl: "",
    savedLogLevel: "info",
    isConnected: false,
    detecting: false,
    launching: false,
    detectedServers: [] as Array<{ pid: number; address: string }>,
    lastDetectMessage: null as string | null,
    stoppingServerPid: null as number | null,
    detectUiServer: vi.fn(),
    launchUiServer: vi.fn(),
    stopUiServer: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => mocks.sdk,
}));

function makeHealth() {
  return {
    isEnabled: computed(() => true),
    selectedMode: ref<"stdio" | "tcp">("tcp"),
    tcpConnectError: ref<string | null>(null),
    cliUrl: computed({ get: () => mocks.sdk.savedCliUrl, set: () => {} }),
    logLevel: computed({ get: () => mocks.sdk.savedLogLevel, set: () => {} }),
    connectionLabel: computed(() => "Disconnected"),
    isTcpSelected: computed(() => true),
    isActiveServer: (addr: string) => mocks.sdk.isConnected && mocks.sdk.savedCliUrl === addr,
    handleConnect: vi.fn(),
    handleDisconnect: vi.fn(),
    handleModeChange: vi.fn(),
    handleConnectToServer: vi.fn(async () => {}),
    refreshAll: vi.fn(),
    syncModeFromBackend: vi.fn(),
  };
}

describe("SdkServersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.sdk, {
      isConnected: false,
      detectedServers: [],
      lastDetectMessage: null,
    });
  });

  it("renders without throwing and shows the discovery title", () => {
    const wrapper = mount(SdkServersPanel, {
      props: { health: makeHealth() },
      global: {
        stubs: {
          ActionButton: { template: "<button><slot /></button>" },
          FormInput: { template: "<input />" },
        },
      },
    });
    expect(wrapper.text()).toContain("TCP Servers");
    expect(wrapper.text()).toContain("Server Discovery");
  });

  it("lists detected servers", () => {
    mocks.sdk.detectedServers = [
      { pid: 100, address: "127.0.0.1:7000" },
      { pid: 200, address: "127.0.0.1:7001" },
    ];
    const wrapper = mount(SdkServersPanel, {
      props: { health: makeHealth() },
      global: {
        stubs: {
          ActionButton: { template: "<button><slot /></button>" },
          FormInput: { template: "<input />" },
        },
      },
    });
    expect(wrapper.text()).toContain("127.0.0.1:7000");
    expect(wrapper.text()).toContain("127.0.0.1:7001");
    expect(wrapper.text()).toContain("PID 100");
  });
});
