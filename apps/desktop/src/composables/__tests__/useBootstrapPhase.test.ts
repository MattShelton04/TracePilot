import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive, ref, shallowRef } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import { useAlertWatcher } from "@/composables/useAlertWatcher";
import { useBootstrapPhase } from "@/composables/useBootstrapPhase";
import { useAlertWatcherStore } from "@/stores/alertWatcher";

const mocks = vi.hoisted(() => ({
  checkConfigExists: vi.fn(),
  getConfig: vi.fn(),
  fetchSessions: vi.fn(),
  updateConfigFields: vi.fn(),
  registerNotificationClickHandler: vi.fn(),
  checkSdkSessionStateAlerts: vi.fn(),
  checkSdkBridgeMetricsAlerts: vi.fn(),
  runUpdateCheck: vi.fn(),
  isMain: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function route(id: string) {
  return { params: { id } } as unknown as RouteLocationNormalizedLoaded;
}

function createPreferences(whenReady: Promise<void>) {
  return reactive({
    whenReady,
    alertsEnabled: true,
    alertsScope: "monitored",
    alertsOnAskUser: true,
    alertsOnSessionEnd: true,
    alertsOnSessionError: true,
    checkForUpdates: true,
    lastSeenVersion: "dev",
    hydrate: vi.fn(),
    updateConfigFields: mocks.updateConfigFields,
  });
}

let prefs: ReturnType<typeof createPreferences>;
let sdk: {
  sessionStatesById: Record<string, unknown>;
  sessions: unknown[];
  bridgeMetrics: Record<string, unknown> | null;
};
let router: Pick<Router, "currentRoute">;

vi.mock("@tracepilot/client", () => ({
  checkConfigExists: mocks.checkConfigExists,
  getConfig: mocks.getConfig,
}));
vi.mock("vue-router", () => ({ useRouter: () => router }));
vi.mock("@/stores/preferences", () => ({ usePreferencesStore: () => prefs }));
vi.mock("@/stores/sdk", () => ({ useSdkStore: () => sdk }));
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ fetchSessions: mocks.fetchSessions }),
}));
vi.mock("@/composables/useAlertDispatcher", () => ({
  registerNotificationClickHandler: mocks.registerNotificationClickHandler,
}));
vi.mock("@/composables/alertWatcherSdk", () => ({
  checkSdkSessionStateAlerts: mocks.checkSdkSessionStateAlerts,
  checkSdkBridgeMetricsAlerts: mocks.checkSdkBridgeMetricsAlerts,
}));
vi.mock("@/composables/useAppVersion", () => ({
  initAppVersion: vi.fn().mockResolvedValue(undefined),
  useAppVersion: () => ({ appVersion: ref("dev") }),
}));
vi.mock("@/composables/useUpdateCheck", () => ({ runUpdateCheck: mocks.runUpdateCheck }));
vi.mock("@/composables/useWhatsNew", () => ({
  useWhatsNew: () => ({ openWhatsNew: vi.fn() }),
}));
vi.mock("@/composables/useWindowRole", () => ({
  resolveWindowRole: vi.fn().mockResolvedValue(undefined),
  useWindowRole: () => ({ isMain: mocks.isMain }),
}));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));
vi.mock("@/utils/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

describe("bootstrap alert ownership", () => {
  let wrapper: VueWrapper | undefined;
  let bootstrap: ReturnType<typeof useBootstrapPhase>;
  let preferencesReady: ReturnType<typeof deferred<void>>;

  function mountBootstrap() {
    wrapper = mount(
      defineComponent({
        setup() {
          bootstrap = useBootstrapPhase();
          return () => null;
        },
      }),
    );
  }

  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    preferencesReady = deferred<void>();
    prefs = createPreferences(preferencesReady.promise);
    sdk = reactive({ sessionStatesById: {}, sessions: [], bridgeMetrics: null });
    router = { currentRoute: shallowRef(route("sdk-1")) };
    mocks.checkConfigExists.mockResolvedValue(true);
    mocks.getConfig.mockResolvedValue({ general: { setupComplete: true } });
    mocks.fetchSessions.mockResolvedValue(undefined);
    mocks.updateConfigFields.mockResolvedValue(undefined);
    mocks.isMain.mockReturnValue(true);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  it("owns all delayed watches and resets their state when the component unmounts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountBootstrap();
    await flushPromises();
    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();

    preferencesReady.resolve();
    await flushPromises();
    const store = useAlertWatcherStore();
    expect(mocks.checkSdkSessionStateAlerts).toHaveBeenCalledWith(sdk.sessionStatesById, {
      baselineOnly: true,
    });
    expect(store.capturedRoute?.params.id).toBe("sdk-1");
    expect(mocks.registerNotificationClickHandler).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    sdk.sessionStatesById = {};
    sdk.bridgeMetrics = {};
    prefs.alertsOnAskUser = false;
    router.currentRoute.value = route("sdk-2");
    await nextTick();
    expect(mocks.checkSdkSessionStateAlerts).toHaveBeenCalledTimes(3);
    expect(mocks.checkSdkBridgeMetricsAlerts).toHaveBeenCalledTimes(2);
    expect(store.capturedRoute?.params.id).toBe("sdk-2");
    store.markSdkStateAlerted("sdk-2:waiting");
    store.setLastSdkStatus("sdk-2", "waiting");

    wrapper?.unmount();
    wrapper = undefined;
    expect(store.capturedRoute).toBeNull();
    expect(store.hasAlertedSdkState("sdk-2:waiting")).toBe(false);
    expect(store.getLastSdkStatus("sdk-2")).toBeNull();
    vi.clearAllMocks();
    sdk.sessionStatesById = {};
    sdk.sessions = [];
    sdk.bridgeMetrics = {};
    prefs.alertsOnAskUser = true;
    router.currentRoute.value = route("sdk-3");
    await nextTick();
    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();
    expect(mocks.checkSdkBridgeMetricsAlerts).not.toHaveBeenCalled();
    expect(store.capturedRoute).toBeNull();
  });

  it("does not initialize alerts or update checks when preferences finish after unmount", async () => {
    mountBootstrap();
    await flushPromises();
    wrapper?.unmount();
    wrapper = undefined;
    preferencesReady.resolve();
    await flushPromises();

    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();
    expect(mocks.registerNotificationClickHandler).not.toHaveBeenCalled();
    expect(mocks.runUpdateCheck).not.toHaveBeenCalled();
    expect(useAlertWatcherStore().capturedRoute).toBeNull();
  });

  it.each([
    "resolve",
    "reject",
  ] as const)("does not resume bootstrap when a pending config read settles via %s after unmount", async (settlement) => {
    const config = deferred<{ general: { setupComplete: boolean } }>();
    mocks.getConfig.mockReturnValue(config.promise);
    mountBootstrap();
    await flushPromises();
    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
    wrapper?.unmount();
    wrapper = undefined;
    if (settlement === "resolve") config.resolve({ general: { setupComplete: true } });
    else config.reject(new Error("config unavailable"));
    preferencesReady.resolve();
    await flushPromises();

    expect(bootstrap.phase.value).toBe("loading");
    expect(mocks.fetchSessions).not.toHaveBeenCalled();
    expect(mocks.registerNotificationClickHandler).not.toHaveBeenCalled();
    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();
  });

  it("does not start alerts when setup completion finishes after unmount", async () => {
    mocks.checkConfigExists.mockResolvedValue(false);
    mountBootstrap();
    await flushPromises();
    const save = deferred<void>();
    mocks.updateConfigFields.mockReturnValue(save.promise);
    const completing = bootstrap.onIndexingComplete();
    wrapper?.unmount();
    wrapper = undefined;
    save.resolve();
    await completing;

    expect(bootstrap.phase.value).toBe("setup");
    expect(mocks.fetchSessions).not.toHaveBeenCalled();
    expect(mocks.registerNotificationClickHandler).not.toHaveBeenCalled();
    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();
  });

  it("does not start the main window alerts in a viewer window", async () => {
    mocks.isMain.mockReturnValue(false);
    preferencesReady.resolve();
    mountBootstrap();
    await flushPromises();
    expect(mocks.registerNotificationClickHandler).not.toHaveBeenCalled();
    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();
  });

  it("refuses to create unowned watches outside an effect scope", () => {
    expect(() => useAlertWatcher(router as Router)).toThrow("requires an active effect scope");
    expect(useAlertWatcherStore().capturedRoute).toBeNull();
    expect(mocks.checkSdkSessionStateAlerts).not.toHaveBeenCalled();
  });
});
