<script setup lang="ts">
/**
 * SdkConnectionPanel — top section of the SDK settings page.
 *
 * Renders the status row (connect/disconnect/refresh), mode selector,
 * authentication line, and last-error banner. All connection-control state
 * is driven by the parent's {@link useSdkConnectionHealth} composable.
 */
import { ActionButton, BtnGroup } from "@tracepilot/ui";
import type { UseSdkConnectionHealth } from "@/composables/useSdkConnectionHealth";
import { useSdkStore } from "@/stores/sdk";

defineProps<{
  health: UseSdkConnectionHealth;
  sessionCountLabel: string;
}>();

const sdk = useSdkStore();

const modeOptions = [
  { value: "stdio", label: "📦 Stdio" },
  { value: "tcp", label: "🌐 TCP" },
];
</script>

<template>
  <!-- Status row -->
  <div class="setting-row">
    <div class="setting-info">
      <div class="setting-label">
        Connection
        <span :class="['sdk-dot', `sdk-dot--${sdk.connectionState}`]" />
      </div>
      <div class="setting-description">
        {{ health.connectionLabel.value }}
        <template v-if="sdk.isConnected">
          <span class="sdk-stat"> · {{ sessionCountLabel }}</span>
          <span class="sdk-stat"> · {{ sdk.models.length }} models</span>
        </template>
        <template v-if="health.tcpConnectError.value">
          <span class="sdk-stat sdk-stat--error"> · {{ health.tcpConnectError.value }}</span>
        </template>
      </div>
    </div>
    <div class="setting-actions">
      <ActionButton v-if="sdk.isConnected" size="sm" @click="health.refreshAll">
        Refresh
      </ActionButton>
      <ActionButton
        v-if="!sdk.isConnected"
        size="sm"
        :disabled="sdk.isConnecting"
        @click="health.handleConnect"
      >
        {{ sdk.isConnecting ? "Connecting…" : "Connect" }}
      </ActionButton>
      <ActionButton
        v-if="sdk.isConnected"
        size="sm"
        class="btn-danger"
        @click="health.handleDisconnect"
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
        {{ health.selectedMode.value === 'stdio'
          ? 'Spawns an isolated CLI subprocess — no shared state with your terminal.'
          : 'Connects to a running CLI server — steer sessions started in your terminal.' }}
      </div>
    </div>
    <BtnGroup
      :options="modeOptions"
      :model-value="health.selectedMode.value"
      @update:model-value="health.handleModeChange"
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
</template>

<style scoped>
:deep(.setting-row) {
  border-bottom: none !important;
}

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
.sdk-stat--error {
  color: var(--danger-fg);
}

.sdk-val-ok { color: var(--success-fg); font-weight: 500; }
.sdk-val-err { color: var(--danger-fg); font-weight: 500; }
</style>
