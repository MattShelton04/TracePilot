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
      models: [],
    });
  });

  it("shows status with a connect button, and says terminal sessions still work", () => {
    const wrapper = mount(SdkConnectionPanel, {
      props: { health: makeHealth(), sessionCountLabel: "no sessions open" },
      global: { stubs: { ActionButton: { template: "<button><slot /></button>" } } },
    });
    expect(wrapper.text()).toContain("Status");
    expect(wrapper.text()).toContain("Connect");
    expect(wrapper.get('[data-testid="sdk-status-line"]').text()).toContain(
      "terminal sessions can still be watched live",
    );
  });

  it("folds sign-in, models and sessions into the status line when connected", () => {
    Object.assign(mocks.sdk, {
      isConnected: true,
      connectionState: "connected",
      authStatus: { isAuthenticated: true, login: "octocat" },
      models: [{}, {}],
    });
    const wrapper = mount(SdkConnectionPanel, {
      props: { health: makeHealth(), sessionCountLabel: "1 session open" },
      global: { stubs: { ActionButton: { template: "<button><slot /></button>" } } },
    });
    const status = wrapper.get('[data-testid="sdk-status-line"]').text();
    expect(status).toContain("signed in as octocat");
    expect(status).toContain("2 models");
    expect(status).toContain("1 session open");
    expect(wrapper.text()).toContain("Disconnect");
  });

  it("explains a closed CLI server and offers the private CLI instead", async () => {
    mocks.sdk.savedCliUrl = "127.0.0.1:5555";
    mocks.sdk.lastError =
      "Connection failed: No connection could be made because the target machine actively refused it. (os error 10061)";
    const health = makeHealth();
    const wrapper = mount(SdkConnectionPanel, {
      props: { health, sessionCountLabel: "" },
      global: { stubs: { ActionButton: { template: "<button><slot /></button>" } } },
    });
    expect(wrapper.text()).toContain("Nothing is listening at 127.0.0.1:5555");
    expect(wrapper.text()).toContain("Retry");

    await wrapper.get('[data-testid="sdk-use-private-cli"]').trigger("click");
    expect(health.handleModeChange).toHaveBeenCalledWith("stdio");
    expect(health.handleConnect).toHaveBeenCalled();
    mocks.sdk.savedCliUrl = "";
  });

  it("shows last error when the SDK store has one", () => {
    mocks.sdk.lastError = "boom";
    const wrapper = mount(SdkConnectionPanel, {
      props: { health: makeHealth(), sessionCountLabel: "" },
      global: { stubs: { ActionButton: { template: "<button><slot /></button>" } } },
    });
    expect(wrapper.text()).toContain("Last error");
    expect(wrapper.text()).toContain("boom");
  });
});
