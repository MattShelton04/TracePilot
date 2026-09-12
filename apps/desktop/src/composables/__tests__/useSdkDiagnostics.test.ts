import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { type UseSdkDiagnostics, useSdkDiagnostics } from "@/composables/useSdkDiagnostics";

const mocks = vi.hoisted(() => ({
  sdk: {
    connectionState: "disconnected" as string,
    connectionMode: null as string | null,
    lastError: null as string | null,
    sdkAvailable: true,
    cliVersion: null as string | null,
    activeSessions: 0,
    sessions: [] as unknown[],
    models: [] as unknown[],
    authStatus: null as null | { isAuthenticated: boolean; login: string | null },
    detectedServers: [] as Array<{ pid: number; address: string }>,
    detectUiServer: vi.fn(async () => [] as Array<{ pid: number; address: string }>),
    connect: vi.fn(async () => true),
    fetchAuthStatus: vi.fn(async () => {}),
    fetchModels: vi.fn(async () => {}),
    fetchSessions: vi.fn(async () => {}),
    refreshStatus: vi.fn(async () => {}),
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => mocks.sdk,
}));

vi.mock("@tracepilot/ui", () => ({
  useToast: () => mocks.toast,
  toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock("@/utils/logger", () => ({
  logError: vi.fn(),
}));

function mountWithComposable(): { diag: UseSdkDiagnostics } {
  let captured!: UseSdkDiagnostics;
  const Host = defineComponent({
    setup() {
      captured = useSdkDiagnostics();
      return () => h("div");
    },
  });
  mount(Host);
  return { diag: captured };
}

describe("useSdkDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.sdk, {
      connectionState: "disconnected",
      connectionMode: null,
      lastError: null,
      sdkAvailable: true,
      cliVersion: null,
      activeSessions: 0,
      sessions: [],
      models: [],
      authStatus: null,
      detectedServers: [],
    });
  });

  it("starts with an empty log and not running", () => {
    const { diag } = mountWithComposable();
    expect(diag.diagLog.value).toEqual([]);
    expect(diag.diagRunning.value).toBe(false);
  });

  it("populates the log across the probe steps and resets running flag", async () => {
    mocks.sdk.detectUiServer.mockResolvedValueOnce([{ pid: 7, address: "127.0.0.1:9000" }]);
    mocks.sdk.connect.mockImplementationOnce(async () => {
      mocks.sdk.connectionState = "connected";
      mocks.sdk.connectionMode = "tcp";
      return true;
    });
    mocks.sdk.fetchAuthStatus.mockImplementationOnce(async () => {
      mocks.sdk.authStatus = { isAuthenticated: true, login: "octocat" };
    });

    const { diag } = mountWithComposable();
    await diag.runDiagnostics({ cliUrl: "127.0.0.1:9000", logLevel: "info" });

    expect(diag.diagRunning.value).toBe(false);
    const joined = diag.diagLog.value.join("\n");
    expect(joined).toContain("State: disconnected");
    expect(joined).toContain("Found UI server: PID 7");
    expect(joined).toContain("Connected!");
    expect(joined).toContain("authenticated");
    expect(joined).toContain("Diagnostics complete");
  });

  it("captures connect failures into the log without throwing", async () => {
    mocks.sdk.connect.mockRejectedValueOnce(new Error("boom"));
    const { diag } = mountWithComposable();
    await diag.runDiagnostics();
    const joined = diag.diagLog.value.join("\n");
    expect(joined).toContain("Connect failed: boom");
    expect(diag.diagRunning.value).toBe(false);
  });

  it("stops on the store's false connection result and allows a successful retry", async () => {
    mocks.sdk.connect.mockImplementationOnce(async () => {
      mocks.sdk.connectionState = "error";
      mocks.sdk.lastError = "Connection refused at 127.0.0.1:65534";
      return false;
    });
    const { diag } = mountWithComposable();
    await diag.runDiagnostics({ cliUrl: "127.0.0.1:65534" });
    const failedLog = diag.diagLog.value.join("\n");
    expect(failedLog).toContain("Connect failed: Connection refused at 127.0.0.1:65534");
    expect(failedLog).not.toContain("Connected!");
    expect(failedLog).not.toContain("Diagnostics complete");
    for (const action of [
      mocks.sdk.fetchAuthStatus,
      mocks.sdk.fetchModels,
      mocks.sdk.fetchSessions,
      mocks.sdk.refreshStatus,
    ])
      expect(action).not.toHaveBeenCalled();
    expect(diag.diagRunning.value).toBe(false);

    mocks.sdk.connect.mockImplementationOnce(async () => {
      mocks.sdk.connectionState = "connected";
      mocks.sdk.lastError = null;
      return true;
    });
    await diag.runDiagnostics({ cliUrl: "127.0.0.1:7000" });
    expect(diag.diagLog.value.join("\n")).toContain("Diagnostics complete");
    expect(diag.diagLog.value.join("\n")).not.toContain("Connection refused");
    expect(mocks.sdk.fetchModels).toHaveBeenCalledOnce();
    expect(diag.diagRunning.value).toBe(false);
  });

  it("explains a false connection result even when the store has no error detail", async () => {
    mocks.sdk.connect.mockResolvedValueOnce(false);
    const { diag } = mountWithComposable();
    await diag.runDiagnostics();
    expect(diag.diagLog.value.join("\n")).toContain("Connect failed: Bridge state is disconnected");
    expect(mocks.sdk.fetchAuthStatus).not.toHaveBeenCalled();
  });

  it("ignores duplicate runs while a probe is in flight without clearing its log", async () => {
    let completeScan!: (servers: Array<{ pid: number; address: string }>) => void;
    mocks.sdk.detectUiServer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeScan = resolve;
        }),
    );
    const { diag } = mountWithComposable();
    const first = diag.runDiagnostics({ cliUrl: "127.0.0.1:7000" });
    const firstLog = diag.diagLog.value;
    await diag.runDiagnostics({ cliUrl: "127.0.0.1:8000" });
    expect(mocks.sdk.detectUiServer).toHaveBeenCalledOnce();
    expect(diag.diagLog.value).toBe(firstLog);
    expect(diag.diagRunning.value).toBe(true);
    completeScan([]);
    await first;
    expect(mocks.sdk.connect).toHaveBeenCalledExactlyOnceWith({
      cliUrl: "127.0.0.1:7000",
      logLevel: undefined,
    });
    expect(diag.diagRunning.value).toBe(false);
  });

  it("copyDiagnostics is a no-op when the log is empty", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const { diag } = mountWithComposable();
    await diag.copyDiagnostics();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copyDiagnostics writes joined log lines and toasts success", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    mocks.sdk.detectUiServer.mockResolvedValueOnce([]);
    mocks.sdk.connect.mockRejectedValueOnce(new Error("nope"));

    const { diag } = mountWithComposable();
    await diag.runDiagnostics();
    await diag.copyDiagnostics();

    expect(writeText).toHaveBeenCalledOnce();
    const firstCall = writeText.mock.calls[0] as unknown as [string];
    const written = firstCall[0];
    expect(written.split("\n").length).toBe(diag.diagLog.value.length);
    expect(mocks.toast.success).toHaveBeenCalledWith("Diagnostics copied to clipboard");
  });
});
