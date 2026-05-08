import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import {
  type UseSdkConnectionHealth,
  useSdkConnectionHealth,
} from "@/composables/useSdkConnectionHealth";

const mocks = vi.hoisted(() => {
  // Use a Vue ref so isEnabled (a computed in the composable) reacts when toggled.
  // We can't import `ref` here (vi.hoisted runs before imports), so re-create at runtime via a getter.
  const enabled = { value: false };
  const sdk = {
    savedCliUrl: "",
    savedLogLevel: "info",
    connectionState: "disconnected",
    connectionMode: null as string | null,
    cliVersion: null as string | null,
    isConnected: false,
    isConnecting: false,
    isTcpMode: false,
    detectUiServer: vi.fn(async () => [] as Array<{ pid: number; address: string }>),
    connectToServer: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    updateSettings: vi.fn(),
    hydrate: vi.fn(async () => ({
      state: "disconnected" as string,
      sdkAvailable: true,
      enabledByPreference: enabled.value,
      cliVersion: null,
      protocolVersion: null,
      activeSessions: 0,
      error: null,
      connectionMode: null as string | null,
    })),
    fetchAuthStatus: vi.fn(async () => {}),
    fetchQuota: vi.fn(async () => {}),
    fetchModels: vi.fn(async () => {}),
    fetchSessions: vi.fn(async () => {}),
  };
  return { enabled, sdk };
});

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    isFeatureEnabled: (flag: string) => flag === "copilotSdk" && mocks.enabled.value,
  }),
}));

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => mocks.sdk,
}));

function mountWithComposable(): {
  wrapper: ReturnType<typeof mount>;
  health: UseSdkConnectionHealth;
} {
  let captured!: UseSdkConnectionHealth;
  const Host = defineComponent({
    setup() {
      captured = useSdkConnectionHealth();
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, health: captured };
}

describe("useSdkConnectionHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.value = false;
    Object.assign(mocks.sdk, {
      savedCliUrl: "",
      savedLogLevel: "info",
      connectionState: "disconnected",
      connectionMode: null,
      cliVersion: null,
      isConnected: false,
      isConnecting: false,
      isTcpMode: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds selectedMode from saved CLI URL", () => {
    mocks.sdk.savedCliUrl = "127.0.0.1:9999";
    const { health } = mountWithComposable();
    expect(health.selectedMode.value).toBe("tcp");
  });

  it("connectionLabel reflects connecting / connected / disconnected", () => {
    mocks.sdk.isConnecting = true;
    let { health } = mountWithComposable();
    expect(health.connectionLabel.value).toBe("Connecting…");

    mocks.sdk.isConnecting = false;
    mocks.sdk.isConnected = true;
    mocks.sdk.connectionMode = "tcp";
    mocks.sdk.savedCliUrl = "127.0.0.1:1234";
    mocks.sdk.cliVersion = "0.42";
    ({ health } = mountWithComposable());
    expect(health.connectionLabel.value).toContain("Connected");
    expect(health.connectionLabel.value).toContain("TCP");
    expect(health.connectionLabel.value).toContain("CLI 0.42");
  });

  it("handleModeChange to stdio clears the URL and disconnects when in TCP", () => {
    mocks.sdk.isConnected = true;
    mocks.sdk.isTcpMode = true;
    const { health } = mountWithComposable();
    health.handleModeChange("stdio");
    expect(mocks.sdk.updateSettings).toHaveBeenCalledWith("", "info");
    expect(mocks.sdk.disconnect).toHaveBeenCalledOnce();
  });

  it("handleConnect with empty TCP URL surfaces a hint when no servers detected", async () => {
    const { health } = mountWithComposable();
    health.selectedMode.value = "tcp";
    await health.handleConnect();
    expect(health.tcpConnectError.value).toMatch(/TCP mode requires/);
    expect(mocks.sdk.connect).not.toHaveBeenCalled();
  });

  it("handleConnect auto-connects to a single detected server", async () => {
    mocks.sdk.detectUiServer.mockResolvedValueOnce([{ pid: 1, address: "127.0.0.1:7000" }]);
    const { health } = mountWithComposable();
    health.selectedMode.value = "tcp";
    await health.handleConnect();
    expect(mocks.sdk.connectToServer).toHaveBeenCalledWith("127.0.0.1:7000");
  });

  it("starts the polling loop on mount when feature enabled", async () => {
    vi.useFakeTimers();
    mocks.enabled.value = true;
    mocks.sdk.connectionState = "connected";
    mocks.sdk.isConnected = true;
    mocks.sdk.connectionMode = "stdio";

    const { wrapper } = mountWithComposable();
    await nextTick();
    await flushPromises();
    expect(mocks.sdk.hydrate).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();
    expect(mocks.sdk.hydrate).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    expect(mocks.sdk.hydrate).toHaveBeenCalledTimes(2);
  });

  it("does not poll when the feature flag is disabled at mount time", async () => {
    vi.useFakeTimers();
    mocks.enabled.value = false;

    const { wrapper } = mountWithComposable();
    await nextTick();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    expect(mocks.sdk.hydrate).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("isActiveServer matches only when connected at the same address", () => {
    mocks.sdk.isConnected = true;
    mocks.sdk.savedCliUrl = "127.0.0.1:5555";
    const { health } = mountWithComposable();
    expect(health.isActiveServer("127.0.0.1:5555")).toBe(true);
    expect(health.isActiveServer("127.0.0.1:6666")).toBe(false);
  });
});
