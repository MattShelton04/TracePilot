<script setup lang="ts">
/**
 * SdkStatusIndicator — compact connection status shown in the sidebar footer.
 *
 * Only visible when the copilotSdk feature flag is enabled. The dot shows the
 * bridge state; hovering spells out what a click does (Connect / Disconnect /
 * Retry), and a spinner replaces the dot while that is in progress.
 * Disconnecting keeps sessions attached to terminals (they don't use it).
 * In the collapsed sidebar (`compact`) it shows only the dot or spinner and
 * "SDK"; the tooltip says the rest.
 */
import { computed, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

const props = defineProps<{
  /** Collapsed sidebar: no room for labels, so the tooltip carries them. */
  compact?: boolean;
}>();

const prefs = usePreferencesStore();
const sdk = useSdkStore();

const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));
const disconnecting = ref(false);
const busy = computed(() => sdk.isConnecting || disconnecting.value);

const busyLabel = computed(() => (disconnecting.value ? "Disconnecting" : "Connecting"));
const actionLabel = computed(() => {
  if (sdk.isConnected) return "Disconnect";
  return sdk.connectionState === "error" ? "Retry" : "Connect";
});

const stateLabel = computed(() => {
  switch (sdk.connectionState) {
    case "connected":
      return "SDK connected";
    case "error":
      return `SDK error: ${sdk.lastError ?? "Unknown"}`;
    default:
      return "SDK disconnected";
  }
});

const title = computed(() =>
  busy.value
    ? `${busyLabel.value}…`
    : `${stateLabel.value}. Click to ${actionLabel.value.toLowerCase()}.`,
);

async function handleClick() {
  if (busy.value) return;
  if (sdk.isConnected) {
    disconnecting.value = true;
    try {
      await sdk.disconnect();
    } finally {
      disconnecting.value = false;
    }
    return;
  }
  // Same target as startup: the saved CLI server, or the private CLI.
  await sdk.connect({
    cliUrl: sdk.savedCliUrl || undefined,
    logLevel: sdk.savedLogLevel || undefined,
  });
}
</script>

<template>
  <button
    v-if="isEnabled"
    class="sdk-status-indicator"
    :class="{ 'is-busy': busy, 'is-compact': props.compact }"
    :title="title"
    :aria-label="title"
    :aria-busy="busy"
    data-testid="sdk-status-indicator"
    @click="handleClick"
  >
    <span v-if="busy" class="sdk-spinner" aria-hidden="true" />
    <span v-else :class="['sdk-dot', `sdk-dot--${sdk.connectionState}`]" aria-hidden="true" />
    <span v-if="busy && !props.compact" class="sdk-status-label">{{ busyLabel }}…</span>
    <template v-else>
      <span class="sdk-status-label sdk-status-label--idle">SDK</span>
      <span v-if="!props.compact" class="sdk-status-label sdk-status-label--action">
        {{ actionLabel }}
      </span>
    </template>
  </button>
</template>

<style scoped>
.sdk-status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sdk-status-indicator:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.sdk-status-indicator.is-busy {
  cursor: progress;
}

.sdk-status-indicator:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

/* The click action replaces "SDK" on hover/focus so the button says what it does. */
.sdk-status-label--action {
  display: none;
}
.sdk-status-indicator:not(.is-compact):is(:hover, :focus-visible) .sdk-status-label--idle {
  display: none;
}
.sdk-status-indicator:is(:hover, :focus-visible) .sdk-status-label--action {
  display: inline;
}

.sdk-status-indicator.is-compact {
  gap: 3px;
  padding: 2px 5px;
  font-size: 0.625rem;
}
.is-compact .sdk-dot,
.is-compact .sdk-spinner {
  width: 6px;
  height: 6px;
}

.sdk-spinner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--border-default);
  border-top-color: var(--accent-fg);
  flex-shrink: 0;
  animation: sdk-spin 0.8s linear infinite;
}

.sdk-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sdk-dot--disconnected {
  background: var(--text-tertiary);
}

.sdk-dot--connecting {
  background: var(--warning-fg);
  animation: sdk-pulse 1.2s ease-in-out infinite;
}

.sdk-dot--connected {
  background: var(--success-fg);
}

.sdk-dot--error {
  background: var(--danger-fg);
}

.sdk-status-label {
  font-weight: 600;
  letter-spacing: 0.03em;
}

@keyframes sdk-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sdk-spinner,
  .sdk-dot--connecting {
    animation: none;
  }
}

@keyframes sdk-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
