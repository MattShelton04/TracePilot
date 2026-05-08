import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, readonly, ref } from "vue";
import SdkDiagnosticsPanel from "../SdkDiagnosticsPanel.vue";

const mocks = vi.hoisted(() => ({
  sdk: {
    savedCliUrl: "",
    savedLogLevel: "info",
    isConnected: false,
    connectionState: "disconnected" as string,
    connectionMode: null as string | null,
    sdkAvailable: true,
    cliVersion: null as string | null,
    activeSessions: 0,
    sessions: [] as unknown[],
    models: [] as unknown[],
    detectedServers: [] as unknown[],
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
    handleConnect: vi.fn(),
    handleDisconnect: vi.fn(),
    handleModeChange: vi.fn(),
    handleConnectToServer: vi.fn(async () => {}),
    refreshAll: vi.fn(),
    syncModeFromBackend: vi.fn(),
  };
}

function makeDiagnostics(log: string[] = []) {
  return {
    diagLog: readonly(ref(log)),
    diagRunning: readonly(ref(false)),
    runDiagnostics: vi.fn(async () => {}),
    copyDiagnostics: vi.fn(async () => {}),
  };
}

describe("SdkDiagnosticsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the collapsed Advanced toggle without throwing", () => {
    const wrapper = mount(SdkDiagnosticsPanel, {
      props: { health: makeHealth(), diagnostics: makeDiagnostics() },
      global: {
        stubs: {
          ActionButton: { template: "<button><slot /></button>" },
        },
      },
    });
    expect(wrapper.text()).toContain("Advanced");
    expect(wrapper.text()).not.toContain("Run Diagnostics");
  });

  it("expands to show the run / log-level controls when toggled", async () => {
    const wrapper = mount(SdkDiagnosticsPanel, {
      props: { health: makeHealth(), diagnostics: makeDiagnostics() },
      global: {
        stubs: {
          ActionButton: { template: "<button><slot /></button>" },
        },
      },
    });
    await wrapper.find(".sdk-advanced-toggle").trigger("click");
    expect(wrapper.text()).toContain("SDK log level");
    expect(wrapper.text()).toContain("Run Diagnostics");
    expect(wrapper.text()).toContain("Raw State");
  });
});
