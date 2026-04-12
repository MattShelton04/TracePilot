<script setup lang="ts">
/**
 * SettingsSdk — SDK bridge configuration panel.
 *
 * Organized into three logical groups:
 *   1. Connection — status, mode selector, connect/disconnect
 *   2. TCP Servers — detect, launch, switch between servers
 *   3. Advanced — log level, diagnostics, raw state
 */
import { ActionButton, BtnGroup, FormInput, SectionPanel } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

const prefs = usePreferencesStore();
const sdk = useSdkStore();

const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));
const showAdvanced = ref(false);

// ─── Mode selection (local UI state, drives what connect() does) ────────
// "stdio" = isolated subprocess, "tcp" = connect to existing server
const selectedMode = ref<"stdio" | "tcp">(sdk.savedCliUrl ? "tcp" : "stdio");

const modeOptions = [
  { value: "stdio", label: "📦 Stdio" },
  { value: "tcp", label: "🌐 TCP" },
];

function handleModeChange(mode: string) {
  selectedMode.value = mode as "stdio" | "tcp";
  if (mode === "stdio") {
    sdk.updateSettings("", sdk.savedLogLevel);
    // If connected in TCP mode, disconnect (user explicitly chose stdio)
    if (sdk.isConnected && sdk.isTcpMode) {
      sdk.disconnect();
    }
  }
}

// Bind to persisted store settings
const cliUrl = computed({
  get: () => sdk.savedCliUrl,
  set: (v: string) => sdk.updateSettings(v, sdk.savedLogLevel),
});
const logLevel = computed({
  get: () => sdk.savedLogLevel,
  set: (v: string) => sdk.updateSettings(sdk.savedCliUrl, v),
});

// ─── Handlers ───────────────────────────────────────────────────────────

async function handleConnect() {
  await sdk.connect({
    cliUrl: cliUrl.value || undefined,
    logLevel: logLevel.value || undefined,
  });
}

async function handleDisconnect() {
  await sdk.disconnect();
}

async function handleDetect() {
  await sdk.detectUiServer();
}

async function handleConnectToServer(address: string) {
  // Don't reconnect to the same server
  if (sdk.isConnected && cliUrl.value === address) return;
  selectedMode.value = "tcp";
  await sdk.connectToServer(address);
}

async function handleLaunchServer() {
  await sdk.launchUiServer();
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

// ─── Diagnostics ────────────────────────────────────────────────────────

const diagLog = ref<string[]>([]);
const diagRunning = ref(false);

function diagAppend(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  diagLog.value = [...diagLog.value, `[${ts}] ${msg}`];
}

async function runDiagnostics() {
  diagLog.value = [];
  diagRunning.value = true;

  try {
    diagAppend(`State: ${sdk.connectionState}, SDK available: ${sdk.sdkAvailable}`);
    diagAppend(`Sessions in store: ${sdk.sessions.length}, Models: ${sdk.models.length}`);

    diagAppend("Scanning for running copilot --ui-server instances...");
    const servers = await sdk.detectUiServer();
    if (servers.length > 0) {
      for (const s of servers) diagAppend(`✅ Found UI server: PID ${s.pid} @ ${s.address}`);
    } else {
      diagAppend("⏭️ No --ui-server instances detected");
    }

    diagAppend("Connecting to SDK...");
    try {
      await sdk.connect({ cliUrl: cliUrl.value || undefined, logLevel: logLevel.value || undefined });
      diagAppend(`✅ Connected! State: ${sdk.connectionState}, Mode: ${sdk.connectionMode ?? "unknown"}`);
    } catch (e) {
      diagAppend(`❌ Connect failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    diagAppend("Fetching auth status...");
    await sdk.fetchAuthStatus();
    diagAppend(sdk.authStatus
      ? `✅ Auth: ${sdk.authStatus.isAuthenticated ? "authenticated" : "NOT authenticated"} (${sdk.authStatus.login ?? "no login"})`
      : "⚠️ Auth status: null");

    diagAppend("Fetching models...");
    await sdk.fetchModels();
    diagAppend(`✅ Models: ${sdk.models.length} available`);

    diagAppend("Fetching sessions...");
    await sdk.fetchSessions();
    diagAppend(`✅ Sessions: ${sdk.sessions.length} found`);

    diagAppend("Fetching bridge status...");
    await sdk.refreshStatus();
    diagAppend(`✅ Status: state=${sdk.connectionState}, active=${sdk.activeSessions}, cli=${sdk.cliVersion ?? "unknown"}`);

    diagAppend("─── Diagnostics complete ───");
  } catch (e) {
    diagAppend(`💥 Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    diagRunning.value = false;
  }
}

// ─── Computed labels ────────────────────────────────────────────────────

const connectionLabel = computed(() => {
  if (sdk.isConnecting) return "Connecting…";
  if (!sdk.isConnected) return "Disconnected";
  const parts = ["Connected"];
  if (sdk.connectionMode === "tcp") parts.push("TCP · " + (cliUrl.value || "?"));
  else parts.push("Stdio");
  if (sdk.cliVersion) parts[1] += ` · CLI ${sdk.cliVersion}`;
  return parts.join(" · ");
});

const sessionCountLabel = computed(() => {
  const total = sdk.sessions.length;
  const active = sdk.sessions.filter(s => s.isActive).length;
  if (total === 0) return "No sessions";
  if (active === 0) return `${total} session${total !== 1 ? "s" : ""}`;
  return `${active} active / ${total} total`;
});

/** True when the user's selected mode is TCP (or has a CLI URL set). */
const isTcpSelected = computed(() => selectedMode.value === "tcp" || !!cliUrl.value);

/** True when currently connected to this specific server address. */
function isActiveServer(address: string) {
  return sdk.isConnected && cliUrl.value === address;
}
</script>

<template>
  <div v-if="isEnabled" class="settings-section">
    <div class="settings-section-title">Copilot SDK Bridge</div>

    <!-- ─── 1. Connection ─────────────────────────── -->
    <SectionPanel>
      <!-- Status row -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">
            Connection
            <span :class="['sdk-dot', `sdk-dot--${sdk.connectionState}`]" />
          </div>
          <div class="setting-description">
            {{ connectionLabel }}
            <template v-if="sdk.isConnected">
              <span class="sdk-stat"> · {{ sessionCountLabel }}</span>
              <span class="sdk-stat"> · {{ sdk.models.length }} models</span>
            </template>
          </div>
        </div>
        <div class="setting-actions">
          <ActionButton v-if="sdk.isConnected" size="sm" @click="refreshAll">
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
            v-if="sdk.isConnected"
            size="sm"
            class="btn-danger"
            @click="handleDisconnect"
          >
            Disconnect
          </ActionButton>
        </div>
      </div>

      <!-- Mode selector -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Mode</div>
          <div class="setting-description">
            {{ selectedMode === 'stdio'
              ? 'Spawns an isolated CLI subprocess — no shared state with your terminal.'
              : 'Connects to a running CLI server — steer sessions started in your terminal.' }}
          </div>
        </div>
        <BtnGroup
          :options="modeOptions"
          :model-value="selectedMode"
          @update:model-value="handleModeChange"
        />
      </div>

      <!-- Auth (when connected) -->
      <div v-if="sdk.isConnected && sdk.authStatus" class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Authentication</div>
          <div class="setting-description">
            <span :class="sdk.authStatus.isAuthenticated ? 'sdk-val-ok' : 'sdk-val-err'">
              {{ sdk.authStatus.isAuthenticated ? "Authenticated" : "Not authenticated" }}
            </span>
            <template v-if="sdk.authStatus.login"> · {{ sdk.authStatus.login }}</template>
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

    <!-- ─── 2. TCP Servers (only when TCP mode selected) ── -->
    <template v-if="isTcpSelected">
      <SectionPanel style="margin-top: 8px;">
        <div class="setting-row" style="padding-bottom: 0;">
          <div class="setting-info">
            <div class="setting-label" style="font-size: 0.8125rem; color: var(--text-tertiary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;">TCP Servers</div>
          </div>
        </div>
        <!-- Actions row -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Server Discovery</div>
            <div class="setting-description">
              Scan for running <code>copilot --ui-server</code> instances, or launch a new one.
            </div>
          </div>
          <div class="sdk-mode-actions">
            <ActionButton size="sm" :disabled="sdk.detecting" @click="handleDetect">
              {{ sdk.detecting ? "Scanning…" : "🔍 Detect" }}
            </ActionButton>
            <ActionButton size="sm" :disabled="sdk.launching" @click="handleLaunchServer">
              {{ sdk.launching ? "Starting…" : "🚀 Launch" }}
            </ActionButton>
          </div>
        </div>

        <!-- Detected servers list -->
        <div v-if="sdk.detectedServers.length > 0 || sdk.lastDetectMessage" class="setting-row setting-row-stacked">
          <div v-if="sdk.detectedServers.length > 0" class="sdk-detected-list">
            <button
              v-for="server in sdk.detectedServers"
              :key="server.pid"
              class="sdk-detected-item"
              :class="{ 'sdk-detected-item--active': isActiveServer(server.address) }"
              :disabled="isActiveServer(server.address)"
              @click="handleConnectToServer(server.address)"
            >
              <span class="sdk-detected-addr">{{ server.address }}</span>
              <span class="sdk-detected-meta">
                <span class="sdk-detected-pid">PID {{ server.pid }}</span>
                <span v-if="isActiveServer(server.address)" class="sdk-detected-badge">● Connected</span>
              </span>
            </button>
          </div>
          <div v-else-if="sdk.lastDetectMessage" class="sdk-detect-msg">
            {{ sdk.lastDetectMessage }}
          </div>
        </div>

        <!-- Manual CLI URL -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">CLI URL</div>
            <div class="setting-description">
              Detected automatically, or enter manually (e.g. <code>127.0.0.1:3333</code>)
            </div>
          </div>
          <div class="sdk-url-row">
            <FormInput
              v-model="cliUrl"
              type="text"
              placeholder="127.0.0.1:port"
              class="input-medium"
              :disabled="sdk.isConnected"
            />
            <ActionButton
              v-if="cliUrl && !sdk.isConnected"
              size="sm"
              class="btn-ghost"
              title="Clear URL"
              @click="sdk.updateSettings('', sdk.savedLogLevel)"
            >
              ✕
            </ActionButton>
          </div>
        </div>
      </SectionPanel>
    </template>

    <!-- ─── 3. Advanced (collapsible) ─────────────── -->
    <div class="sdk-advanced-toggle" style="margin-top: 12px;" @click="showAdvanced = !showAdvanced">
      <span class="sdk-toggle-arrow" :class="{ 'sdk-toggle-arrow--open': showAdvanced }">▸</span>
      <span class="sdk-advanced-label">Advanced</span>
    </div>
    <template v-if="showAdvanced">
      <SectionPanel>
        <!-- Log level -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">SDK log level</div>
            <div class="setting-description">
              Verbosity for bridge diagnostic messages
            </div>
          </div>
          <select v-model="logLevel" class="sdk-select" :disabled="sdk.isConnected">
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>

        <!-- Diagnostics -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Diagnostics</div>
            <div class="setting-description">
              Tests connection, auth, models, and session discovery step-by-step.
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
          </div>
          <div class="diag-raw">
            <div><span class="diag-key">connectionState:</span> {{ sdk.connectionState }}</div>
            <div><span class="diag-key">connectionMode:</span> {{ sdk.connectionMode ?? "null" }}</div>
            <div><span class="diag-key">sdkAvailable:</span> {{ sdk.sdkAvailable }}</div>
            <div><span class="diag-key">cliVersion:</span> {{ sdk.cliVersion ?? "null" }}</div>
            <div><span class="diag-key">activeSessions:</span> {{ sdk.activeSessions }}</div>
            <div><span class="diag-key">sessions.length:</span> {{ sdk.sessions.length }}</div>
            <div><span class="diag-key">models.length:</span> {{ sdk.models.length }}</div>
            <div><span class="diag-key">detectedServers:</span> {{ sdk.detectedServers.length }}</div>
          </div>
        </div>
      </SectionPanel>
    </template>
  </div>
</template>

<style scoped>
/* ─── Status dot ─────────────────────────────── */
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

.sdk-stat {
  color: var(--text-tertiary);
}

/* ─── Mode actions ───────────────────────────── */
.sdk-mode-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ─── Detected servers ───────────────────────── */
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
  padding: 7px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: 0.8125rem;
  color: var(--text-primary);
}
.sdk-detected-item:hover:not(:disabled) {
  background: var(--accent-subtle);
  border-color: var(--accent-emphasis);
}
.sdk-detected-item--active {
  background: var(--accent-subtle);
  border-color: var(--accent-emphasis);
  cursor: default;
}
.sdk-detected-item:disabled {
  opacity: 1; /* keep visible, just not clickable */
}
.sdk-detected-addr {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  color: var(--accent-fg);
}
.sdk-detected-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdk-detected-pid {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.sdk-detected-badge {
  font-size: 0.6875rem;
  color: var(--success-fg);
  font-weight: 500;
}
.sdk-detect-msg {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  padding: 4px 0;
}

/* ─── URL input ──────────────────────────────── */
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
.btn-ghost:hover { opacity: 1; }

/* ─── Select ─────────────────────────────────── */
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

/* ─── Values ─────────────────────────────────── */
.sdk-val-ok { color: var(--success-fg); font-weight: 500; }
.sdk-val-err { color: var(--danger-fg); font-weight: 500; }

/* ─── Advanced toggle ────────────────────────── */
.sdk-advanced-toggle {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.sdk-advanced-toggle:hover {
  color: var(--text-primary);
}
.sdk-toggle-arrow {
  display: inline-block;
  transition: transform 0.15s ease;
  font-size: 0.6875rem;
}
.sdk-toggle-arrow--open {
  transform: rotate(90deg);
}

/* ─── Code ───────────────────────────────────── */
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
