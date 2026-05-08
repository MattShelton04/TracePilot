<script setup lang="ts">
/**
 * SettingsSdk — SDK bridge configuration panel.
 *
 * Thin layout shell: composes the three sub-panels and renders the SDK
 * Sessions/Processes section inline. Connection-control state and the 10-second
 * status poll live in {@link useSdkConnectionHealth}; the diagnostics probe
 * lives in {@link useSdkDiagnostics}.
 */
import { SectionPanel } from "@tracepilot/ui";
import { computed } from "vue";
import { useRouter } from "vue-router";
import SdkConnectionPanel from "@/components/settings/SdkConnectionPanel.vue";
import SdkDiagnosticsPanel from "@/components/settings/SdkDiagnosticsPanel.vue";
import SdkServersPanel from "@/components/settings/SdkServersPanel.vue";
import { useSdkConnectionHealth } from "@/composables/useSdkConnectionHealth";
import { useSdkDiagnostics } from "@/composables/useSdkDiagnostics";
import { ROUTE_NAMES } from "@/config/routes";
import { useSdkStore } from "@/stores/sdk";
import { useSessionsStore } from "@/stores/sessions";

const sdk = useSdkStore();
const sessionsStore = useSessionsStore();
const router = useRouter();

const health = useSdkConnectionHealth();
const diagnostics = useSdkDiagnostics();

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

const sessionCountLabel = computed(() => {
  const active = sdk.sessions.length;
  if (active === 0) return "No tracked sessions";
  return `${active} tracked session${active === 1 ? "" : "s"}`;
});

const sessionRows = computed(() => {
  return sdk.sessions
    .map((session) => {
      const live = sdk.sessionStatesById[session.sessionId];
      const summary = sessionsStore.sessions
        .find((s) => s.id === session.sessionId)
        ?.summary?.trim();
      return {
        id: session.sessionId,
        shortId: shortId(session.sessionId),
        title: summary || `SDK session ${shortId(session.sessionId)}`,
        summary: summary || null,
        model: session.model ?? null,
        cwd: session.workingDirectory ?? null,
        liveStatus: live?.status ?? "tracked",
        isActive: session.isActive,
        isForeground: sdk.foregroundSessionId === session.sessionId,
      };
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive));
});

const hasSessionRows = computed(() => sessionRows.value.length > 0);

async function openSession(rowId: string): Promise<void> {
  await router.push({
    name: ROUTE_NAMES.sessionConversation,
    params: { id: rowId },
  });
}
</script>

<template>
  <div v-if="health.isEnabled.value" class="settings-section">
    <div class="settings-section-title">Copilot SDK Bridge</div>

    <SectionPanel>
      <SdkConnectionPanel :health="health" :session-count-label="sessionCountLabel" />

      <SdkServersPanel v-if="health.isTcpSelected.value" :health="health" />

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
        <button
          v-for="row in sessionRows"
          :key="row.id"
          class="sdk-session-item"
          type="button"
          :title="`Open ${row.title}`"
          @click="openSession(row.id)"
        >
          <div class="sdk-session-main">
            <span class="sdk-session-dot sdk-session-dot--active" />
            <span class="sdk-session-title">{{ row.title }}</span>
            <span class="sdk-session-id" :title="row.id">{{ row.shortId }}</span>
            <span v-if="row.isForeground" class="sdk-session-badge">Foreground</span>
          </div>
          <div class="sdk-session-meta">
            <span>Status: {{ row.liveStatus.replaceAll('_', ' ') }}</span>
            <span v-if="row.model">Model: {{ row.model }}</span>
            <span v-if="row.cwd" :title="row.cwd">cwd: {{ row.cwd }}</span>
            <span class="sdk-session-open">Open conversation →</span>
          </div>
        </button>
      </div>

      <div v-else class="sdk-empty-state" data-testid="sdk-session-list-empty">
        No SDK sessions are active in this bridge process. Connect the bridge, link a session, or
        launch a headless SDK session to populate this list.
      </div>

      <SdkDiagnosticsPanel :health="health" :diagnostics="diagnostics" />
    </SectionPanel>
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
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.025);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast);
}

.sdk-session-item:hover {
  border-color: var(--accent-muted);
  background: rgba(99, 102, 241, 0.08);
  transform: translateY(-1px);
}

.sdk-session-item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
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

.sdk-session-title {
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 650;
}

.sdk-session-id {
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
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

.sdk-session-open {
  margin-left: auto;
  color: var(--accent-fg);
  font-weight: 600;
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

code {
  background: var(--neutral-subtle);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-size: 0.8em;
  font-family: 'JetBrains Mono', monospace;
}
</style>
