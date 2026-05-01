import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SettingsSdk from "../SettingsSdk.vue";

const mocks = vi.hoisted(() => {
  const enabled = { value: false };
  const sdk = {
    savedCliUrl: "",
    savedLogLevel: "info",
    connectionState: "disconnected",
    connectionMode: null as string | null,
    sdkAvailable: true,
    isConnected: false,
    isConnecting: false,
    isTcpMode: false,
    authStatus: null,
    sessions: [],
    models: [],
    sessionStatesById: {},
    foregroundSessionId: null,
    activeSessions: 0,
    lastError: null,
    detectedServers: [],
    detecting: false,
    launching: false,
    stoppingServerPid: null as number | null,
    hydrate: vi.fn(),
    fetchAuthStatus: vi.fn(),
    fetchQuota: vi.fn(),
    fetchModels: vi.fn(),
    fetchSessions: vi.fn(),
    refreshStatus: vi.fn(),
    detectUiServer: vi.fn(),
    connectToServer: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    updateSettings: vi.fn(),
    launchUiServer: vi.fn(),
    stopUiServer: vi.fn(),
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

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ sessions: [] }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function mountPanel() {
  return mount(SettingsSdk, {
    global: {
      stubs: {
        ActionButton: { template: "<button><slot /></button>" },
        BtnGroup: { template: "<div />" },
        FormInput: { template: "<input />" },
        SectionPanel: { template: "<section><slot /></section>" },
      },
    },
  });
}

describe("SettingsSdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.value = false;
    Object.assign(mocks.sdk, {
      connectionState: "disconnected",
      connectionMode: null,
      isConnected: false,
      isConnecting: false,
      hydrate: vi.fn(async () => ({
        state: mocks.sdk.connectionState,
        sdkAvailable: true,
        enabledByPreference: mocks.enabled.value,
        cliVersion: null,
        protocolVersion: null,
        activeSessions: 0,
        error: null,
        connectionMode: mocks.sdk.connectionMode,
      })),
      fetchAuthStatus: vi.fn(),
      fetchQuota: vi.fn(),
      fetchModels: vi.fn(),
      fetchSessions: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not refresh SDK client data while the feature is disabled", async () => {
    mountPanel();
    await nextTick();

    expect(mocks.sdk.hydrate).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchAuthStatus).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchQuota).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchModels).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchSessions).not.toHaveBeenCalled();
  });

  it("hydrates but skips client-only fetches while disconnected", async () => {
    mocks.enabled.value = true;

    mountPanel();
    await nextTick();
    await flushPromises();

    expect(mocks.sdk.hydrate).toHaveBeenCalledOnce();
    expect(mocks.sdk.fetchAuthStatus).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchQuota).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchModels).not.toHaveBeenCalled();
    expect(mocks.sdk.fetchSessions).not.toHaveBeenCalled();
  });

  it("fetches SDK client data after hydration confirms a connection", async () => {
    mocks.enabled.value = true;
    mocks.sdk.connectionState = "connected";
    mocks.sdk.connectionMode = "stdio";
    mocks.sdk.isConnected = true;

    mountPanel();
    await nextTick();
    await flushPromises();

    expect(mocks.sdk.hydrate).toHaveBeenCalledOnce();
    expect(mocks.sdk.fetchAuthStatus).toHaveBeenCalledOnce();
    expect(mocks.sdk.fetchQuota).toHaveBeenCalledOnce();
    expect(mocks.sdk.fetchModels).toHaveBeenCalledOnce();
    expect(mocks.sdk.fetchSessions).toHaveBeenCalledOnce();
  });
});
