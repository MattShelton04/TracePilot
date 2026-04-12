<script setup lang="ts">
/**
 * SdkStatusIndicator — compact connection status shown in the sidebar footer.
 *
 * Only visible when the copilotSdk feature flag is enabled.
 * Shows connection state with a coloured dot and can toggle connection.
 */
import { computed } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

const prefs = usePreferencesStore();
const sdk = useSdkStore();

const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));

const stateLabel = computed(() => {
  switch (sdk.connectionState) {
    case "connected":
      return "SDK Connected";
    case "connecting":
      return "Connecting…";
    case "error":
      return `Error: ${sdk.lastError ?? "Unknown"}`;
    default:
      return "SDK Disconnected";
  }
});

const dotClass = computed(() => `sdk-dot sdk-dot--${sdk.connectionState}`);

async function handleClick() {
  if (sdk.isConnected) {
    await sdk.disconnect();
  } else if (!sdk.isConnecting) {
    await sdk.connect();
  }
}
</script>

<template>
  <button
    v-if="isEnabled"
    class="sdk-status-indicator"
    :title="stateLabel"
    @click="handleClick"
  >
    <span :class="dotClass" />
    <span class="sdk-status-label">SDK</span>
  </button>
</template>

<style scoped>
.sdk-status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sdk-status-indicator:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sdk-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sdk-dot--disconnected {
  background: var(--text-tertiary, #888);
}

.sdk-dot--connecting {
  background: var(--status-warning, #f59e0b);
  animation: sdk-pulse 1.2s ease-in-out infinite;
}

.sdk-dot--connected {
  background: var(--status-success, #22c55e);
}

.sdk-dot--error {
  background: var(--status-error, #ef4444);
}

.sdk-status-label {
  font-weight: 600;
  letter-spacing: 0.03em;
}

@keyframes sdk-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
