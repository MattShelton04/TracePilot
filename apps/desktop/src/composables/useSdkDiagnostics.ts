/**
 * useSdkDiagnostics — encapsulates the multi-step "Run Diagnostics" probe used
 * by the SDK settings page.
 *
 * State: `diagLog` (append-only string buffer) and `diagRunning` (in-flight flag).
 * Actions: {@link UseSdkDiagnostics.runDiagnostics} executes the probe and
 * appends a timestamped line per step; {@link UseSdkDiagnostics.copyDiagnostics}
 * copies the buffer to the clipboard via {@link runUiAction}.
 */
import { type Ref, readonly, ref } from "vue";
import { runUiAction } from "@/composables/useAsyncAction";
import { useSdkStore } from "@/stores/sdk";

export interface UseSdkDiagnostics {
  /** Timestamped log lines from the most recent probe. */
  diagLog: Readonly<Ref<readonly string[]>>;
  /** True while a probe is in flight. */
  diagRunning: Readonly<Ref<boolean>>;
  /**
   * Run the multi-step probe. Appends one line per step; failures are
   * captured into the log rather than re-thrown.
   */
  runDiagnostics: (opts?: { cliUrl?: string; logLevel?: string }) => Promise<void>;
  /** Copy the current `diagLog` contents to the clipboard. */
  copyDiagnostics: () => Promise<void>;
}

export function useSdkDiagnostics(): UseSdkDiagnostics {
  const sdk = useSdkStore();

  const diagLog = ref<string[]>([]);
  const diagRunning = ref(false);

  function diagAppend(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    diagLog.value = [...diagLog.value, `[${ts}] ${msg}`];
  }

  async function runDiagnostics(opts: { cliUrl?: string; logLevel?: string } = {}): Promise<void> {
    diagLog.value = [];
    diagRunning.value = true;

    try {
      diagAppend(`State: ${sdk.connectionState}, SDK available: ${sdk.sdkAvailable}`);
      diagAppend(`Tracked sessions: ${sdk.sessions.length}, Models: ${sdk.models.length}`);

      diagAppend("Scanning for running copilot --ui-server instances...");
      const servers = await sdk.detectUiServer();
      if (servers.length > 0) {
        for (const s of servers) diagAppend(`✅ Found UI server: PID ${s.pid} @ ${s.address}`);
      } else {
        diagAppend("⏭️ No --ui-server instances detected");
      }

      diagAppend("Connecting to SDK...");
      try {
        await sdk.connect({
          cliUrl: opts.cliUrl || undefined,
          logLevel: opts.logLevel || undefined,
        });
        diagAppend(
          `✅ Connected! State: ${sdk.connectionState}, Mode: ${sdk.connectionMode ?? "unknown"}`,
        );
      } catch (e) {
        diagAppend(`❌ Connect failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      diagAppend("Fetching auth status...");
      await sdk.fetchAuthStatus();
      diagAppend(
        sdk.authStatus
          ? `✅ Auth: ${sdk.authStatus.isAuthenticated ? "authenticated" : "NOT authenticated"} (${sdk.authStatus.login ?? "no login"})`
          : "⚠️ Auth status: null",
      );

      diagAppend("Fetching models...");
      await sdk.fetchModels();
      diagAppend(`✅ Models: ${sdk.models.length} available`);

      diagAppend("Fetching tracked sessions...");
      await sdk.fetchSessions();
      diagAppend(`✅ Tracked sessions: ${sdk.sessions.length} active in this bridge`);

      diagAppend("Fetching bridge status...");
      await sdk.refreshStatus();
      diagAppend(
        `✅ Status: state=${sdk.connectionState}, active=${sdk.activeSessions}, cli=${sdk.cliVersion ?? "unknown"}`,
      );

      diagAppend("─── Diagnostics complete ───");
    } catch (e) {
      diagAppend(`💥 Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      diagRunning.value = false;
    }
  }

  async function copyDiagnostics(): Promise<void> {
    if (diagLog.value.length === 0) return;
    const text = diagLog.value.join("\n");
    await runUiAction({
      errorLabel: "[sdk-diagnostics:copy]",
      toastSuccess: "Diagnostics copied to clipboard",
      run: async () => {
        await navigator.clipboard.writeText(text);
      },
    });
  }

  return {
    diagLog: readonly(diagLog),
    diagRunning: readonly(diagRunning),
    runDiagnostics,
    copyDiagnostics,
  };
}
