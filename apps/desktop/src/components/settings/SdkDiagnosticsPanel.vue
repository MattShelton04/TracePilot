<script setup lang="ts">
/**
 * SdkDiagnosticsPanel — collapsible "Advanced" section for the SDK settings.
 *
 * Renders the SDK log-level selector, the multi-step probe runner, the probe
 * log preview, the copy-to-clipboard action, and the raw-state dump.
 * State + the probe action are sourced from {@link useSdkDiagnostics}; the
 * log-level binding comes from the parent's connection-health composable.
 */
import { ActionButton } from "@tracepilot/ui";
import { ref } from "vue";
import type { UseSdkConnectionHealth } from "@/composables/useSdkConnectionHealth";
import type { UseSdkDiagnostics } from "@/composables/useSdkDiagnostics";
import { useSdkStore } from "@/stores/sdk";

const props = defineProps<{
  health: UseSdkConnectionHealth;
  diagnostics: UseSdkDiagnostics;
}>();

const sdk = useSdkStore();
const showAdvanced = ref(false);

function runProbe(): void {
  void props.diagnostics.runDiagnostics({
    cliUrl: props.health.cliUrl.value,
    logLevel: props.health.logLevel.value,
  });
}
</script>

<template>
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
      <select v-model="health.logLevel.value" class="sdk-select" :disabled="sdk.isConnected">
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
      <div class="sdk-mode-actions">
        <ActionButton
          v-if="diagnostics.diagLog.value.length > 0"
          size="sm"
          class="btn-ghost"
          title="Copy diagnostics log to clipboard"
          @click="diagnostics.copyDiagnostics"
        >
          📋 Copy
        </ActionButton>
        <ActionButton size="sm" :disabled="diagnostics.diagRunning.value" @click="runProbe">
          {{ diagnostics.diagRunning.value ? "Running…" : "Run Diagnostics" }}
        </ActionButton>
      </div>
    </div>

    <div v-if="diagnostics.diagLog.value.length > 0" class="diag-log-wrap">
      <div class="diag-log">
        <div
          v-for="(line, i) in diagnostics.diagLog.value"
          :key="i"
          class="diag-line"
          :class="{
            'diag-ok': line.includes('✅'),
            'diag-warn': line.includes('⚠️'),
            'diag-err': line.includes('❌') || line.includes('💥'),
          }"
        >{{ line }}</div>
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

    <!-- Bridge metrics -->
    <div class="setting-row setting-row-stacked">
      <div class="setting-info">
        <div class="setting-label">Bridge Metrics</div>
        <div class="setting-description">
          Cumulative broadcast-channel counters. Diff snapshots to derive rates.
          State-channel lag indicates the desktop fell behind <code>state_tx</code>
          live-state snapshots (w4-8).
        </div>
      </div>
      <div class="diag-raw">
        <div><span class="diag-key">eventsForwarded:</span> {{ sdk.bridgeMetrics?.eventsForwarded ?? 0 }}</div>
        <div><span class="diag-key">eventsDroppedDueToLag:</span> {{ sdk.bridgeMetrics?.eventsDroppedDueToLag ?? 0 }}</div>
        <div><span class="diag-key">lagOccurrences:</span> {{ sdk.bridgeMetrics?.lagOccurrences ?? 0 }}</div>
        <div :class="{ 'diag-warn': (sdk.bridgeMetrics?.stateEventsDroppedDueToLag ?? 0) > 0 }">
          <span class="diag-key">stateEventsDroppedDueToLag:</span>
          {{ sdk.bridgeMetrics?.stateEventsDroppedDueToLag ?? 0 }}
        </div>
        <div :class="{ 'diag-warn': (sdk.bridgeMetrics?.stateLagOccurrences ?? 0) > 0 }">
          <span class="diag-key">stateLagOccurrences:</span>
          {{ sdk.bridgeMetrics?.stateLagOccurrences ?? 0 }}
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
:deep(.setting-row) {
  border-bottom: none !important;
}

.sdk-divider {
  height: 1px;
  background: var(--border-muted);
  margin: 4px 12px;
}

.sdk-mode-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.btn-ghost {
  background: transparent !important;
  border: none !important;
  padding: 2px 6px !important;
  opacity: 0.6;
  font-size: 0.875rem;
}
.btn-ghost:hover { opacity: 1; }

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
