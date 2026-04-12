<script setup lang="ts">
/**
 * SettingsSdk — SDK bridge configuration panel with built-in diagnostics.
 *
 * Visible only when the copilotSdk feature flag is enabled.
 * Follows the same setting-row / SectionPanel pattern used in
 * SettingsGeneral and SettingsLogging for visual consistency.
 */
import { ActionButton, FormInput, SectionPanel } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

const prefs = usePreferencesStore();
const sdk = useSdkStore();

const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));

// Connection mode: "auto" (stdio), "detect" (auto-detect --ui-server), "manual" (custom TCP)
const connectionMode = computed({
  get: () => {
    if (!sdk.savedCliUrl) return "auto";
    return "manual";
  },
  set: (_v: string) => {
    // Handled by mode-specific actions
  },
});

// Bind to persisted store settings
const cliUrl = computed({
  get: () => sdk.savedCliUrl,
  set: (v: string) => sdk.updateSettings(v, sdk.savedLogLevel),
});
const logLevel = computed({
  get: () => sdk.savedLogLevel,
  set: (v: string) => sdk.updateSettings(sdk.savedCliUrl, v),
});

// Diagnostics
const diagLog = ref<string[]>([]);
const diagRunning = ref(false);

function diagAppend(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  diagLog.value = [...diagLog.value, `[${ts}] ${msg}`];
}

async function handleConnect() {
  await sdk.connect({
    cliUrl: cliUrl.value || undefined,
    logLevel: logLevel.value || undefined,
  });
}

async function handleDisconnect() {
  await sdk.disconnect();
}

async function handleDetectAndConnect() {
  await sdk.detectAndConnect();
}

async function handleDetect() {
  const servers = await sdk.detectUiServer();
  if (servers.length > 0) {
    // Auto-fill the first detected server's address
    sdk.updateSettings(servers[0].address, sdk.savedLogLevel);
  }
}

function handleClearUrl() {
  sdk.updateSettings("", sdk.savedLogLevel);
}

async function refreshAll() {
  await Promise.all([
    sdk.refreshStatus(),
    sdk.fetchAuthStatus(),
    sdk.fetchQuota(),
    sdk.fetchSessions(),
    sdk.fetchModels(),
  ]);
}

/** Run full diagnostics — tests each SDK operation step-by-step and logs results. */
async function runDiagnostics() {
  diagLog.value = [];
  diagRunning.value = true;

  try {
    // Step 1: Check current state
    diagAppend(`State: ${sdk.connectionState}, SDK available: ${sdk.sdkAvailable}`);
    diagAppend(`Sessions in store: ${sdk.sessions.length}, Models: ${sdk.models.length}`);

    // Step 2: Detect UI servers
    diagAppend("Scanning for running copilot --ui-server instances...");
    const servers = await sdk.detectUiServer();
    if (servers.length > 0) {
      for (const s of servers) {
        diagAppend(`✅ Found UI server: PID ${s.pid} @ ${s.address}`);
      }
    } else {
      diagAppend("⏭️ No --ui-server instances detected");
    }

    // Step 3: Connect (or reconnect)
    diagAppend("Connecting to SDK...");
    try {
      await sdk.connect({
        cliUrl: cliUrl.value || undefined,
        logLevel: logLevel.value || undefined,
      });
      diagAppend(`✅ Connected! State: ${sdk.connectionState}, Mode: ${sdk.connectionMode ?? "unknown"}`);
    } catch (e) {
      diagAppend(`❌ Connect failed: ${e instanceof Error ? e.message : String(e)}`);
      diagAppend(`Last error: ${sdk.lastError}`);
      return;
    }

    // Step 4: Auth status
    diagAppend("Fetching auth status...");
    await sdk.fetchAuthStatus();
    if (sdk.authStatus) {
      diagAppend(`✅ Auth: ${sdk.authStatus.isAuthenticated ? "authenticated" : "NOT authenticated"} (${sdk.authStatus.login ?? "no login"} @ ${sdk.authStatus.host ?? "no host"})`);
    } else {
      diagAppend("⚠️ Auth status: null (could not retrieve)");
    }

    // Step 5: Models
    diagAppend("Fetching models...");
    await sdk.fetchModels();
    diagAppend(`✅ Models: ${sdk.models.length} available`);
    if (sdk.models.length > 0) {
      diagAppend(`   First 5: ${sdk.models.slice(0, 5).map(m => m.id).join(", ")}`);
    }

    // Step 6: Sessions
    diagAppend("Fetching sessions...");
    await sdk.fetchSessions();
    diagAppend(`✅ Sessions: ${sdk.sessions.length} found`);
    if (sdk.sessions.length > 0) {
      const active = sdk.sessions.filter(s => s.isActive).length;
      diagAppend(`   Active (resumed): ${active}, Listed: ${sdk.sessions.length - active}`);
      diagAppend(`   First 3: ${sdk.sessions.slice(0, 3).map(s => s.sessionId.slice(0, 8) + "…").join(", ")}`);
    }

    // Step 7: Status
    diagAppend("Fetching bridge status...");
    await sdk.refreshStatus();
    diagAppend(`✅ Status: state=${sdk.connectionState}, active=${sdk.activeSessions}, cli=${sdk.cliVersion ?? "unknown"}`);

    // Step 8: Quota (expected to fail)
    diagAppend("Fetching quota (may fail — expected on most CLI versions)...");
    await sdk.fetchQuota();
    if (sdk.quota) {
      diagAppend(`✅ Quota: ${sdk.quota.quotas?.length ?? 0} entries`);
    } else {
      diagAppend("⚠️ Quota: not available (expected — account.get_quota not supported)");
    }

    // Step 9: Session summary (no resume — too risky)
    if (sdk.sessions.length > 0) {
      const first3 = sdk.sessions.slice(0, 3).map(s => {
        const id = s.sessionId.slice(0, 8) + "…";
        const flags = [s.isActive ? "active" : "listed", s.isRemote ? "remote" : "local"].join(", ");
        return `${id} (${flags})`;
      });
      diagAppend(`📋 Sessions: ${first3.join(" · ")}${sdk.sessions.length > 3 ? ` +${sdk.sessions.length - 3} more` : ""}`);
      diagAppend("ℹ️ Session resume is triggered when you click 'Link for Steering' in a session.");
    } else {
      diagAppend("⏭️ No sessions found. Start a Copilot CLI session first.");
    }

    diagAppend("─── Diagnostics complete ───");
  } catch (e) {
    diagAppend(`💥 Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    diagRunning.value = false;
  }
}

const connectionLabel = computed(() => {
  switch (sdk.connectionState) {
    case "connected": return "Connected";
    case "connecting": return "Connecting…";
    case "error": return "Error";
    default: return "Disconnected";
  }
});

const sessionCountLabel = computed(() => {
  const total = sdk.sessions.length;
  const active = sdk.sessions.filter(s => s.isActive).length;
  if (total === 0) return "0 sessions";
  if (active === 0) return `${total} session${total !== 1 ? "s" : ""} (none resumed)`;
  return `${active} resumed / ${total} total`;
});
</script>

<template>
  <div v-if="isEnabled" class="settings-section">
    <div class="settings-section-title">Copilot SDK Bridge</div>
    <SectionPanel>
      <!-- Connection status -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">
            Connection
            <span :class="['sdk-dot', `sdk-dot--${sdk.connectionState}`]" />
          </div>
          <div class="setting-description">
            {{ connectionLabel }}
            <template v-if="sdk.connectionMode"> · {{ sdk.connectionMode === 'tcp' ? '🌐 TCP (shared server)' : '📦 Stdio (isolated subprocess)' }}</template>
            <template v-if="sdk.cliVersion"> · CLI {{ sdk.cliVersion }}</template>
            <template v-if="sdk.isConnected"> · {{ sessionCountLabel }}</template>
            <template v-if="sdk.isConnected"> · {{ sdk.models.length }} models</template>
          </div>
        </div>
        <div class="setting-actions">
          <ActionButton
            v-if="sdk.isConnected"
            size="sm"
            @click="refreshAll"
          >
            Refresh
          </ActionButton>
          <ActionButton
            v-if="!sdk.isConnected"
            size="sm"
            :disabled="sdk.isConnecting"
            @click="handleConnect"
          >
            {{ sdk.isConnecting ? "Connecting…" : "Connect" }}
          </ActionButton>
          <ActionButton
            v-else
            size="sm"
            class="btn-danger"
            @click="handleDisconnect"
          >
            Disconnect
          </ActionButton>
        </div>
      </div>

      <!-- Connection Mode -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Connection Mode</div>
          <div class="setting-description">
            <strong>Stdio</strong> spawns an isolated CLI subprocess (default).
            <strong>TCP</strong> connects to an existing <code>copilot --ui-server</code> — both TracePilot and the terminal share the same server.
          </div>
        </div>
        <div class="sdk-mode-actions">
          <ActionButton
            size="sm"
            :class="{ 'btn-active': !cliUrl }"
            :disabled="sdk.isConnected"
            @click="handleClearUrl"
          >
            📦 Stdio
          </ActionButton>
          <ActionButton
            size="sm"
            :disabled="sdk.isConnected || sdk.detecting"
            @click="handleDetectAndConnect"
          >
            {{ sdk.detecting ? "Scanning…" : "🔍 Detect UI Server" }}
          </ActionButton>
        </div>
      </div>

      <!-- Detected servers (shown after detection) -->
      <div v-if="sdk.detectedServers.length > 0 && !sdk.isConnected" class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Detected Servers</div>
          <div class="setting-description">
            Found {{ sdk.detectedServers.length }} running instance{{ sdk.detectedServers.length !== 1 ? 's' : '' }}
          </div>
        </div>
        <div class="sdk-detected-list">
          <button
            v-for="server in sdk.detectedServers"
            :key="server.pid"
            class="sdk-detected-item"
            @click="sdk.updateSettings(server.address, sdk.savedLogLevel)"
          >
            <span class="sdk-detected-addr">{{ server.address }}</span>
            <span class="sdk-detected-pid">PID {{ server.pid }}</span>
          </button>
        </div>
      </div>

      <!-- CLI URL (shown when in TCP mode or manually set) -->
      <div v-if="cliUrl || connectionMode === 'manual'" class="setting-row">
        <div class="setting-info">
          <div class="setting-label">CLI URL</div>
          <div class="setting-description">
            TCP address of a running Copilot CLI server.
            Use <code>Detect UI Server</code> above or enter manually.
          </div>
        </div>
        <div class="sdk-url-row">
          <FormInput
            v-model="cliUrl"
            type="text"
            placeholder="e.g. 127.0.0.1:60381"
            class="input-medium"
            :disabled="sdk.isConnected"
          />
          <ActionButton
            v-if="cliUrl && !sdk.isConnected"
            size="sm"
            class="btn-ghost"
            title="Clear URL and switch to stdio mode"
            @click="handleClearUrl"
          >
            ✕
          </ActionButton>
        </div>
      </div>

      <!-- SDK Log Level -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">SDK log level</div>
          <div class="setting-description">
            Verbosity for SDK bridge diagnostic messages
          </div>
        </div>
        <select v-model="logLevel" class="sdk-select" :disabled="sdk.isConnected">
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
      </div>

      <!-- Auth (shown when connected) -->
      <div v-if="sdk.isConnected && sdk.authStatus" class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Authentication</div>
          <div class="setting-description">
            <span :class="sdk.authStatus.isAuthenticated ? 'sdk-val-ok' : 'sdk-val-err'">
              {{ sdk.authStatus.isAuthenticated ? "Authenticated" : "Not authenticated" }}
            </span>
            <template v-if="sdk.authStatus.login"> · {{ sdk.authStatus.login }}</template>
            <template v-if="sdk.authStatus.host"> · {{ sdk.authStatus.host }}</template>
          </div>
        </div>
      </div>

      <!-- Quota (shown when connected and available) -->
      <div v-if="sdk.isConnected && sdk.quota?.quotas?.length" class="setting-row setting-row-stacked">
        <div class="setting-info">
          <div class="setting-label">Quota</div>
          <div class="setting-description">Current API usage limits</div>
        </div>
        <div class="sdk-quota-grid">
          <div v-for="q in sdk.quota.quotas" :key="q.quotaType" class="sdk-quota-item">
            <span class="sdk-quota-type">{{ q.quotaType }}</span>
            <span class="sdk-quota-val">
              {{ q.used ?? "?" }} / {{ q.limit ?? "∞" }}
              <template v-if="q.remaining != null"> ({{ q.remaining }} left)</template>
            </span>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="sdk.lastError" class="setting-row">
        <div class="setting-info">
          <div class="setting-label setting-label-danger">Last error</div>
          <div class="setting-description setting-result-danger">{{ sdk.lastError }}</div>
        </div>
      </div>
    </SectionPanel>

    <!-- How to use -->
    <div class="settings-section-title" style="margin-top: 16px;">How to Use</div>
    <SectionPanel>
      <div class="setting-row setting-row-stacked">
        <div class="setting-info">
          <div class="setting-description sdk-howto">
            <p><strong>Stdio mode (default)</strong> — TracePilot spawns its own isolated Copilot CLI process. Good for creating new sessions. No shared state with your terminal.</p>
            <p><strong>TCP mode (recommended for steering)</strong> — Connect to an existing CLI server to steer sessions started in your terminal:</p>
            <ol>
              <li>Run <code>copilot --ui-server</code> in a terminal. It starts a background server and prints its port.</li>
              <li>Click <strong>Detect UI Server</strong> above — TracePilot will find it automatically.</li>
              <li>Or manually run <code>copilot --server --port 3333</code> and enter <code>127.0.0.1:3333</code> as the CLI URL.</li>
            </ol>
            <p>Once connected in TCP mode, open any session's conversation view and click <strong>Link for Steering</strong> to send messages and change modes in real time.</p>
          </div>
        </div>
      </div>
    </SectionPanel>

    <!-- Diagnostics -->
    <div class="settings-section-title" style="margin-top: 16px;">SDK Diagnostics</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Connection Test</div>
          <div class="setting-description">
            Scans for UI servers, connects, and tests auth, models, and sessions.
          </div>
        </div>
        <ActionButton size="sm" :disabled="diagRunning" @click="runDiagnostics">
          {{ diagRunning ? "Running…" : "Run Diagnostics" }}
        </ActionButton>
      </div>

      <div v-if="diagLog.length > 0" class="diag-log-wrap">
        <div class="diag-log">
          <div v-for="(line, i) in diagLog" :key="i" class="diag-line" :class="{
            'diag-ok': line.includes('✅'),
            'diag-warn': line.includes('⚠️'),
            'diag-err': line.includes('❌') || line.includes('💥'),
          }">{{ line }}</div>
        </div>
      </div>

      <!-- Raw state dump -->
      <div class="setting-row setting-row-stacked">
        <div class="setting-info">
          <div class="setting-label">Raw State</div>
          <div class="setting-description">Current SDK store values</div>
        </div>
        <div class="diag-raw">
          <div><span class="diag-key">connectionState:</span> {{ sdk.connectionState }}</div>
          <div><span class="diag-key">connectionMode:</span> {{ sdk.connectionMode ?? "null" }}</div>
          <div><span class="diag-key">sdkAvailable:</span> {{ sdk.sdkAvailable }}</div>
          <div><span class="diag-key">cliVersion:</span> {{ sdk.cliVersion ?? "null" }}</div>
          <div><span class="diag-key">protocolVersion:</span> {{ sdk.protocolVersion ?? "null" }}</div>
          <div><span class="diag-key">activeSessions:</span> {{ sdk.activeSessions }}</div>
          <div><span class="diag-key">sessions.length:</span> {{ sdk.sessions.length }}</div>
          <div><span class="diag-key">models.length:</span> {{ sdk.models.length }}</div>
          <div><span class="diag-key">authStatus:</span> {{ sdk.authStatus ? `${sdk.authStatus.isAuthenticated ? 'yes' : 'no'} (${sdk.authStatus.login})` : 'null' }}</div>
          <div><span class="diag-key">lastError:</span> {{ sdk.lastError ?? "null" }}</div>
          <div><span class="diag-key">detectedServers:</span> {{ sdk.detectedServers.length }} servers</div>
          <div><span class="diag-key">sendingMessage:</span> {{ sdk.sendingMessage }}</div>
          <div><span class="diag-key">recentEvents:</span> {{ sdk.recentEvents.length }} events</div>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.sdk-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-left: 6px;
  vertical-align: middle;
}
.sdk-dot--connected { background: var(--success-fg); box-shadow: 0 0 4px var(--success-muted); }
.sdk-dot--connecting { background: var(--warning-fg); }
.sdk-dot--error { background: var(--danger-fg); }
.sdk-dot--disconnected { background: var(--text-placeholder); }

.sdk-mode-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.btn-active {
  background: var(--accent-subtle) !important;
  border-color: var(--accent-emphasis) !important;
  color: var(--accent-fg) !important;
}

.sdk-detected-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sdk-detected-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: 0.8125rem;
  color: var(--text-primary);
}
.sdk-detected-item:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-emphasis);
}
.sdk-detected-addr {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  color: var(--accent-fg);
}
.sdk-detected-pid {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.sdk-url-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.btn-ghost {
  background: transparent !important;
  border: none !important;
  padding: 2px 6px !important;
  opacity: 0.6;
  font-size: 0.875rem;
}
.btn-ghost:hover {
  opacity: 1;
}

.sdk-select {
  padding: 5px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
  outline: none;
  transition: all var(--transition-fast);
}
.sdk-select:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
}
.sdk-select option {
  background: var(--canvas-overlay);
  color: var(--text-primary);
}
.sdk-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sdk-val-ok { color: var(--success-fg); font-weight: 500; }
.sdk-val-err { color: var(--danger-fg); font-weight: 500; }

.sdk-quota-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.sdk-quota-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
}
.sdk-quota-type {
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.6875rem;
  font-weight: 500;
}
.sdk-quota-val {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.sdk-howto {
  line-height: 1.7;
}
.sdk-howto p {
  margin: 0 0 8px;
}
.sdk-howto p:last-child {
  margin-bottom: 0;
}
.sdk-howto ol {
  margin: 4px 0 8px 16px;
  padding: 0;
}
.sdk-howto li {
  margin: 2px 0;
}

code {
  background: var(--neutral-subtle);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-size: 0.8em;
  font-family: 'JetBrains Mono', monospace;
}

/* ─── Diagnostics ────────────────────────────── */
.diag-log-wrap {
  padding: 0 12px 12px;
}
.diag-log {
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  max-height: 300px;
  overflow-y: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6875rem;
  line-height: 1.6;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}
.diag-line {
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}
.diag-line.diag-ok { color: var(--success-fg); }
.diag-line.diag-warn { color: var(--warning-fg); }
.diag-line.diag-err { color: var(--danger-fg); }

.diag-raw {
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6875rem;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-top: 6px;
}
.diag-key {
  color: var(--accent-fg);
  font-weight: 500;
  margin-right: 4px;
}
</style>
