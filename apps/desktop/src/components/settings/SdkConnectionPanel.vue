<script setup lang="ts">
/**
 * SdkConnectionPanel — status row at the top of the SDK settings page.
 *
 * One line of health (connection, CLI version, sign-in, models) with the
 * connect/disconnect action, plus the last error. Choosing *where* the bridge
 * connects lives under Advanced ({@link SdkServersPanel}), because terminal
 * sessions are joined directly and need no connection setup.
 */
import { ActionButton } from "@tracepilot/ui";
import { computed } from "vue";
import type { UseSdkConnectionHealth } from "@/composables/useSdkConnectionHealth";
import { useSdkStore } from "@/stores/sdk";

const props = defineProps<{
  health: UseSdkConnectionHealth;
  sessionCountLabel: string;
}>();

const sdk = useSdkStore();

const details = computed(() => {
  if (!sdk.isConnected) return [];
  const parts: string[] = [];
  const auth = sdk.authStatus;
  if (auth?.isAuthenticated) parts.push(auth.login ? `signed in as ${auth.login}` : "signed in");
  else if (auth) parts.push("not signed in");
  const models = sdk.models.length;
  if (models) parts.push(`${models} model${models === 1 ? "" : "s"}`);
  parts.push(props.sessionCountLabel);
  return parts;
});

/** A saved CLI server that is gone (its terminal closed) is the usual failure. */
const savedServerGone = computed(
  () =>
    !sdk.isConnected &&
    !!props.health.cliUrl.value &&
    /actively refused|connection refused|os error (10061|111)\b/i.test(sdk.lastError ?? ""),
);

const errorText = computed(() =>
  savedServerGone.value
    ? `Nothing is listening at ${props.health.cliUrl.value}; the CLI server was probably closed.`
    : sdk.lastError,
);

async function usePrivateCli(): Promise<void> {
  props.health.handleModeChange("stdio");
  await props.health.handleConnect();
}
</script>

<template>
  <div class="setting-row">
    <div class="setting-info">
      <div class="setting-label">
        Status
        <span :class="['sdk-dot', `sdk-dot--${sdk.connectionState}`]" />
      </div>
      <div class="setting-description" data-testid="sdk-status-line">
        {{ health.connectionLabel.value }}
        <span v-for="part in details" :key="part" class="sdk-stat"> · {{ part }}</span>
        <template v-if="!sdk.isConnected && !sdk.isConnecting">
          — terminal sessions can still be watched live; steering other sessions needs a
          connection.
        </template>
        <span v-if="health.tcpConnectError.value" class="sdk-stat sdk-stat--error">
          · {{ health.tcpConnectError.value }}
        </span>
      </div>
    </div>
    <div class="setting-actions">
      <ActionButton
        v-if="savedServerGone"
        size="sm"
        :disabled="sdk.isConnecting"
        data-testid="sdk-use-private-cli"
        @click="usePrivateCli"
      >
        Use private CLI
      </ActionButton>
      <ActionButton
        v-if="!sdk.isConnected"
        size="sm"
        :disabled="sdk.isConnecting"
        @click="health.handleConnect"
      >
        {{ sdk.isConnecting ? "Connecting…" : savedServerGone ? "Retry" : "Connect" }}
      </ActionButton>
      <ActionButton v-else size="sm" class="btn-danger" @click="health.handleDisconnect">
        Disconnect
      </ActionButton>
    </div>
  </div>

  <div v-if="sdk.lastError" class="setting-row">
    <div class="setting-info">
      <div class="setting-label setting-label-danger">Last error</div>
      <div class="setting-description setting-result-danger">{{ errorText }}</div>
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
</style>
