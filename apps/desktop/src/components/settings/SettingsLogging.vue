<script setup lang="ts">
import { save } from "@tauri-apps/plugin-dialog";
import { exportLogs, getLogPath } from "@tracepilot/client";
import { ActionButton, SectionPanel, toErrorMessage } from "@tracepilot/ui";
import { onMounted, ref, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

const prefsStore = usePreferencesStore();

const logPath = ref("—");
const exportResult = ref<string | null>(null);
const exporting = ref(false);
const logLevel = ref("info");

onMounted(async () => {
  try {
    logPath.value = await getLogPath();
  } catch {
    logPath.value = "Unable to determine";
  }

  await prefsStore.whenReady;
  logLevel.value = prefsStore.logLevel;
});

watch(logLevel, (value) => {
  prefsStore.logLevel = value;
});

async function openLogDirectory() {
  try {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    await tauriInvoke("plugin:tracepilot|open_in_explorer", { path: logPath.value });
  } catch (e) {
    exportResult.value = `Failed to open directory: ${toErrorMessage(e)}`;
  }
}

async function doExportLogs() {
  exporting.value = true;
  exportResult.value = null;
  try {
    const dest = await save({
      title: "Export TracePilot Logs",
      defaultPath: "tracepilot-logs.txt",
      filters: [{ name: "Text Files", extensions: ["txt", "log"] }],
    });
    if (!dest) {
      exporting.value = false;
      return;
    }
    exportResult.value = await exportLogs(dest);
  } catch (e) {
    exportResult.value = `Export failed: ${toErrorMessage(e)}`;
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Logs &amp; Diagnostics</div>
    <SectionPanel>
      <div class="setting-row setting-row-stacked">
        <div class="setting-info setting-label-spaced">
          <div class="setting-label">Log directory</div>
          <div class="setting-description">
            Application logs are written to this directory
          </div>
        </div>
        <code class="log-path">{{ logPath }}</code>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Open log directory</div>
          <div class="setting-description">
            View raw log files in your file explorer
          </div>
        </div>
        <ActionButton size="sm" @click="openLogDirectory">
          Open Directory
        </ActionButton>
      </div>

      <div class="setting-row setting-row-stacked">
        <div class="setting-row-inline">
          <div class="setting-info">
            <div class="setting-label">Export logs</div>
            <div class="setting-description">
              Combine all log files into a single file for sharing when reporting issues
            </div>
          </div>
          <ActionButton size="sm" :disabled="exporting" @click="doExportLogs">
            {{ exporting ? 'Exporting…' : 'Export Logs…' }}
          </ActionButton>
        </div>
        <div v-if="exportResult" class="export-result">{{ exportResult }}</div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Log level</div>
          <div class="setting-description">
            Controls verbosity of logged messages.
            <span class="restart-hint">Takes effect after restart.</span>
          </div>
        </div>
        <select v-model="logLevel" class="log-level-select">
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
          <option value="trace">Trace</option>
        </select>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.log-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  word-break: break-all;
  line-height: 1.5;
}

.setting-row-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.export-result {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin-top: 6px;
  word-break: break-all;
  line-height: 1.4;
}

.restart-hint {
  color: var(--text-placeholder);
  font-style: italic;
}

.log-level-select {
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

.log-level-select:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
}

.log-level-select option {
  background: var(--canvas-overlay);
  color: var(--text-primary);
}
</style>
