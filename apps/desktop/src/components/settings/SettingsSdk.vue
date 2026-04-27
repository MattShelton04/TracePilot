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

async function handleStopServer(pid: number) {
  await sdk.stopUiServer(pid);
}

async function refreshAll() {
  await Promise.all([sdk.hydrate(), sdk.fetchAuthStatus(), sdk.fetchQuota(), sdk.fetchModels()]);
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
        cliUrl: cliUrl.value || undefined,
        logLevel: logLevel.value || undefined,
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

// ─── Computed labels ────────────────────────────────────────────────────

const connectionLabel = computed(() => {
  if (sdk.isConnecting) return "Connecting…";
  if (!sdk.isConnected) return "Disconnected";
  const parts = ["Connected"];
  if (sdk.connectionMode === "tcp") parts.push(`TCP · ${cliUrl.value || "?"}`);
  else parts.push("Stdio");
  if (sdk.cliVersion) parts[1] += ` · CLI ${sdk.cliVersion}`;
  return parts.join(" · ");
});

const sessionCountLabel = computed(() => {
  const active = sdk.sessions.length;
  if (active === 0) return "No tracked sessions";
  return `${active} tracked session${active === 1 ? "" : "s"}`;
});

const sessionRows = computed(() => {
  return sdk.sessions
    .map((session) => {
      const live = sdk.sessionStatesById[session.sessionId];
      return {
        id: session.sessionId,
        shortId: shortId(session.sessionId),
        model: session.model ?? "default",
        cwd: session.workingDirectory ?? "-",
        lifecycle: "active",
        liveStatus: live?.status ?? "-",
        isActive: session.isActive,
        isForeground: sdk.foregroundSessionId === session.sessionId,
      };
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive));
});

const hasSessionRows = computed(() => sessionRows.value.length > 0);

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

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

    <SectionPanel>
      <!-- ─── Connection ───────────────────────────── -->
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

      <!-- ─── TCP Servers (only when TCP mode) ─────── -->
      <template v-if="isTcpSelected">
        <div class="sdk-divider" />
        <div class="sdk-subsection-title">TCP Servers</div>

        <!-- Server discovery -->
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
            <div
              v-for="server in sdk.detectedServers"
              :key="server.pid"
              class="sdk-detected-item"
              :class="{ 'sdk-detected-item--active': isActiveServer(server.address) }"
            >
              <button
                class="sdk-detected-connect"
                :disabled="isActiveServer(server.address)"
                @click="handleConnectToServer(server.address)"
              >
                <span class="sdk-detected-addr">{{ server.address }}</span>
              </button>
              <span class="sdk-detected-meta">
                <span class="sdk-detected-pid">PID {{ server.pid }}</span>
                <span v-if="isActiveServer(server.address)" class="sdk-detected-badge">● Connected</span>
                <button
                  class="sdk-stop-server"
                  :disabled="sdk.stoppingServerPid === server.pid"
                  title="Stop this copilot --ui-server process"
                  @click.stop="handleStopServer(server.pid)"
                >
                  {{ sdk.stoppingServerPid === server.pid ? "Stopping…" : "Stop" }}
                </button>
              </span>
            </div>
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
      </template>

      <!-- ─── SDK Sessions / process visibility ─────── -->
      <div class="sdk-divider" />
      <div class="sdk-subsection-title">SDK Sessions & Processes</div>

      <div class="sdk-lifecycle-note">
        <strong>Unlink</strong> removes TracePilot's steering handle and keeps the SDK-owned
        session alive. <strong>Shutdown</strong> asks the SDK/CLI to stop that session. The
        bridge itself is one process/transport; stdio child PIDs are owned by the SDK, while
        TCP <code>--ui-server</code> PIDs appear under detected servers.
      </div>

      <div v-if="hasSessionRows" class="sdk-session-list" data-testid="sdk-session-list">
        <div v-for="row in sessionRows" :key="row.id" class="sdk-session-item">
          <div class="sdk-session-main">
              <span class="sdk-session-dot sdk-session-dot--active" />
            <span class="sdk-session-id" :title="row.id">{{ row.shortId }}</span>
            <span v-if="row.isForeground" class="sdk-session-badge">Foreground</span>
          </div>
          <div class="sdk-session-meta">
            <span>{{ row.lifecycle }}</span>
            <span>{{ row.liveStatus }}</span>
            <span>{{ row.model }}</span>
            <span :title="row.cwd">{{ row.cwd }}</span>
          </div>
        </div>
      </div>

      <div v-else class="sdk-empty-state" data-testid="sdk-session-list-empty">
        No SDK sessions are active in this bridge process. Connect the bridge, link a session, or
        launch a headless SDK session to populate this list.
      </div>

      <!-- ─── Advanced (collapsible) ───────────────── -->
      <div class="sdk-divider" />
      <div class="sdk-advanced-toggle" @click="showAdvanced = !showAdvanced">
        <span class="sdk-toggle-arrow" :class="{ 'sdk-toggle-arrow--open': showAdvanced }">▸</span>
        <span>Advanced</span>
      </div>

      <template v-if="showAdvanced">
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
            <div><span class="diag-key">trackedSessions:</span> {{ sdk.sessions.length }}</div>
            <div><span class="diag-key">models.length:</span> {{ sdk.models.length }}</div>
            <div><span class="diag-key">detectedServers:</span> {{ sdk.detectedServers.length }}</div>
          </div>
        </div>
      </template>
    </SectionPanel>
  </div>
</template>

<style scoped>
/* Override global setting-row borders — SDK panel uses .sdk-divider for subsection breaks */
:deep(.setting-row) {
  border-bottom: none !important;
}

/* ─── Internal divider / subsection ──────────── */
.sdk-divider {
  height: 1px;
  background: var(--border-muted);
  margin: 4px 12px;
}
.sdk-subsection-title {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 6px 12px 2px;
}

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
  transition: all var(--transition-fast);
  font-size: 0.8125rem;
  color: var(--text-primary);
}
.sdk-detected-item:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-emphasis);
}
.sdk-detected-item--active {
  background: var(--accent-subtle);
  border-color: var(--accent-emphasis);
  cursor: default;
}
.sdk-detected-connect {
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.sdk-detected-connect:disabled {
  cursor: default;
  opacity: 1;
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
.sdk-stop-server {
  padding: 2px 7px;
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--danger-fg);
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.sdk-stop-server:hover:not(:disabled) {
  background: rgba(251, 113, 133, 0.1);
  border-color: var(--danger-emphasis);
}
.sdk-stop-server:disabled {
  opacity: 0.6;
  cursor: wait;
}
.sdk-detect-msg {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  padding: 4px 0;
}

/* ─── Session/process monitor ───────────────────── */
.sdk-lifecycle-note {
  margin: 6px 12px 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background:
    linear-gradient(135deg, rgba(99, 102, 241, 0.08), transparent 55%),
    var(--canvas-subtle);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.55;
}

.sdk-lifecycle-note strong {
  color: var(--text-secondary);
}

.sdk-session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 6px;
}

.sdk-session-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.025);
}

.sdk-session-main,
.sdk-session-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sdk-session-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.sdk-session-dot--active {
  background: var(--success-fg);
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
}

.sdk-session-id {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
}

.sdk-session-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sdk-session-badge--muted {
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
}

.sdk-session-meta {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.sdk-session-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-empty-state {
  margin: 0 12px 6px;
  padding: 10px 12px;
  border: 1px dashed var(--border-muted);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.5;
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
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 6px 12px 2px;
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
