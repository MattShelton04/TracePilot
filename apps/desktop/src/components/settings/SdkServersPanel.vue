<script setup lang="ts">
/**
 * SdkServersPanel — TCP server discovery + manual CLI URL section.
 *
 * Visible only when the user's selected mode is TCP (or a CLI URL is set).
 * Lists detected `copilot --ui-server` instances with switch / stop affordances
 * and exposes the manual CLI URL input.
 */
import { ActionButton, FormInput } from "@tracepilot/ui";
import { Rocket, Search } from "lucide-vue-next";
import type { UseSdkConnectionHealth } from "@/composables/useSdkConnectionHealth";
import { useSdkStore } from "@/stores/sdk";

defineProps<{
  health: UseSdkConnectionHealth;
}>();

const sdk = useSdkStore();

async function handleDetect(): Promise<void> {
  await sdk.detectUiServer();
}

async function handleLaunchServer(): Promise<void> {
  await sdk.launchUiServer();
}

async function handleStopServer(pid: number): Promise<void> {
  await sdk.stopUiServer(pid);
}
</script>

<template>
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
        <template v-if="sdk.detecting">Scanning…</template>
        <template v-else><Search :size="14" aria-hidden="true" /> Detect</template>
      </ActionButton>
      <ActionButton size="sm" :disabled="sdk.launching" @click="handleLaunchServer">
        <template v-if="sdk.launching">Starting…</template>
        <template v-else><Rocket :size="14" aria-hidden="true" /> Launch</template>
      </ActionButton>
    </div>
  </div>

  <!-- Detected servers list -->
  <div
    v-if="sdk.detectedServers.length > 0 || sdk.lastDetectMessage"
    class="setting-row setting-row-stacked"
  >
    <div v-if="sdk.detectedServers.length > 0" class="sdk-detected-list">
      <div
        v-for="server in sdk.detectedServers"
        :key="server.pid"
        class="sdk-detected-item"
        :class="{ 'sdk-detected-item--active': health.isActiveServer(server.address) }"
      >
        <button
          class="sdk-detected-connect"
          :disabled="health.isActiveServer(server.address)"
          @click="health.handleConnectToServer(server.address)"
        >
          <span class="sdk-detected-addr">{{ server.address }}</span>
        </button>
        <span class="sdk-detected-meta">
          <span class="sdk-detected-pid">PID {{ server.pid }}</span>
          <span v-if="health.isActiveServer(server.address)" class="sdk-detected-badge">● Connected</span>
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
        v-model="health.cliUrl.value"
        type="text"
        placeholder="127.0.0.1:port"
        class="input-medium"
        :disabled="sdk.isConnected"
      />
      <ActionButton
        v-if="health.cliUrl.value && !sdk.isConnected"
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

<style scoped>
:deep(.setting-row) {
  border-bottom: none !important;
}

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

.sdk-mode-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
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

code {
  background: var(--neutral-subtle);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-size: 0.8em;
  font-family: 'JetBrains Mono', monospace;
}
</style>
