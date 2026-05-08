/**
 * useSdkConnectionHealth — connection-control + status-poll composable for the
 * Copilot SDK settings page.
 *
 * Owns:
 *   - Local connection-control state (`selectedMode`, `tcpConnectError`).
 *   - Writable bindings to the persisted SDK store settings (`cliUrl`, `logLevel`).
 *   - The 10-second status poller (delegated to {@link useIntervalRefresh}).
 *   - The connect / disconnect / mode-change actions used by the panels.
 *
 * Pure read-through of the SDK store's connection state is intentional — this
 * composable does not duplicate state, it just composes it into a UI-shaped
 * surface so the SettingsSdk panels stay thin.
 */
import {
  type ComputedRef,
  computed,
  onMounted,
  type Ref,
  ref,
  type WritableComputedRef,
  watch,
} from "vue";
import { useIntervalRefresh } from "@/composables/useIntervalRefresh";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

/** Cadence for the SDK status poll. Matches the historical hand-rolled `setInterval`. */
export const SDK_REFRESH_INTERVAL_MS = 10_000;

export type SdkSelectedMode = "stdio" | "tcp";

export interface UseSdkConnectionHealth {
  /** True when the `copilotSdk` feature flag is enabled. */
  isEnabled: ComputedRef<boolean>;
  /** Currently-selected mode (stdio or TCP) — may differ from store while user is choosing. */
  selectedMode: Ref<SdkSelectedMode>;
  /** Last-attempt TCP connect error surfaced inline next to the status pill. */
  tcpConnectError: Ref<string | null>;
  /** Writable proxy onto `sdk.savedCliUrl`. */
  cliUrl: WritableComputedRef<string>;
  /** Writable proxy onto `sdk.savedLogLevel`. */
  logLevel: WritableComputedRef<string>;
  /** Human-readable status line (e.g. `"Connected · TCP · 127.0.0.1:3333 · CLI 0.42"`). */
  connectionLabel: ComputedRef<string>;
  /** True while the user's selected mode is TCP, or whenever a CLI URL is set. */
  isTcpSelected: ComputedRef<boolean>;
  /** True when currently connected to this specific server address. */
  isActiveServer: (address: string) => boolean;
  /** Trigger a connect using the current `selectedMode` + `cliUrl`. */
  handleConnect: () => Promise<void>;
  /** Disconnect the SDK bridge. */
  handleDisconnect: () => Promise<void>;
  /** Switch between stdio / TCP — clears URL and disconnects when leaving TCP. */
  handleModeChange: (mode: string) => void;
  /** Connect to a specific detected server address. */
  handleConnectToServer: (address: string) => Promise<void>;
  /** Re-hydrate SDK status + (when connected) auth/quota/models/sessions. */
  refreshAll: () => Promise<void>;
  /** Realign `selectedMode` with the backend's reported `connectionMode`. */
  syncModeFromBackend: () => void;
}

export function useSdkConnectionHealth(): UseSdkConnectionHealth {
  const prefs = usePreferencesStore();
  const sdk = useSdkStore();

  const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));
  const tcpConnectError = ref<string | null>(null);
  const selectedMode = ref<SdkSelectedMode>(sdk.savedCliUrl ? "tcp" : "stdio");

  const cliUrl = computed<string>({
    get: () => sdk.savedCliUrl,
    set: (v) => sdk.updateSettings(v, sdk.savedLogLevel),
  });
  const logLevel = computed<string>({
    get: () => sdk.savedLogLevel,
    set: (v) => sdk.updateSettings(sdk.savedCliUrl, v),
  });

  const connectionLabel = computed(() => {
    if (sdk.isConnecting) return "Connecting…";
    if (!sdk.isConnected) return "Disconnected";
    const parts = ["Connected"];
    if (sdk.connectionMode === "tcp") parts.push(`TCP · ${cliUrl.value || "?"}`);
    else parts.push("Stdio");
    if (sdk.cliVersion) parts[1] += ` · CLI ${sdk.cliVersion}`;
    return parts.join(" · ");
  });

  const isTcpSelected = computed(() => selectedMode.value === "tcp" || !!cliUrl.value);

  function isActiveServer(address: string): boolean {
    return sdk.isConnected && cliUrl.value === address;
  }

  function syncModeFromBackend(): void {
    if (sdk.connectionMode === "tcp") {
      selectedMode.value = "tcp";
    } else if (sdk.connectionMode === "stdio") {
      selectedMode.value = "stdio";
    } else {
      selectedMode.value = sdk.savedCliUrl ? "tcp" : "stdio";
    }
  }

  function handleModeChange(mode: string): void {
    selectedMode.value = mode as SdkSelectedMode;
    tcpConnectError.value = null;
    if (mode === "stdio") {
      sdk.updateSettings("", sdk.savedLogLevel);
      if (sdk.isConnected && sdk.isTcpMode) {
        sdk.disconnect();
      }
    }
  }

  async function handleConnect(): Promise<void> {
    tcpConnectError.value = null;
    if (selectedMode.value === "tcp" && !cliUrl.value.trim()) {
      const servers = await sdk.detectUiServer();
      if (servers.length === 1) {
        await sdk.connectToServer(servers[0].address);
        return;
      }
      tcpConnectError.value =
        servers.length > 1
          ? "Select one detected --ui-server instance before connecting."
          : "TCP mode requires a running copilot --ui-server. Launch one, detect it, or enter its host:port.";
      return;
    }
    await sdk.connect({
      cliUrl: cliUrl.value || undefined,
      logLevel: logLevel.value || undefined,
    });
  }

  async function handleDisconnect(): Promise<void> {
    await sdk.disconnect();
  }

  async function handleConnectToServer(address: string): Promise<void> {
    if (sdk.isConnected && cliUrl.value === address) return;
    selectedMode.value = "tcp";
    await sdk.connectToServer(address);
  }

  async function refreshAll(): Promise<void> {
    const status = await sdk.hydrate();
    syncModeFromBackend();
    if (!isEnabled.value || (status?.state ?? sdk.connectionState) !== "connected") return;
    await Promise.all([
      sdk.fetchAuthStatus(),
      sdk.fetchQuota(),
      sdk.fetchModels(),
      sdk.fetchSessions(),
    ]);
  }

  const { start: startRefreshLoop, stop: stopRefreshLoop } = useIntervalRefresh(
    refreshAll,
    SDK_REFRESH_INTERVAL_MS,
    { immediate: true, enabled: isEnabled },
  );

  onMounted(() => {
    if (isEnabled.value) startRefreshLoop();
  });

  watch(
    () => sdk.connectionMode,
    () => syncModeFromBackend(),
  );

  watch(isEnabled, (enabled) => {
    if (enabled) {
      startRefreshLoop();
    } else {
      stopRefreshLoop();
    }
  });

  return {
    isEnabled,
    selectedMode,
    tcpConnectError,
    cliUrl,
    logLevel,
    connectionLabel,
    isTcpSelected,
    isActiveServer,
    handleConnect,
    handleDisconnect,
    handleModeChange,
    handleConnectToServer,
    refreshAll,
    syncModeFromBackend,
  };
}
