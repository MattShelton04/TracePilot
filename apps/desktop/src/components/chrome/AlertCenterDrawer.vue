<script setup lang="ts">
import { Drawer, EmptyState, StatusPill, type StatusPillTone } from "@tracepilot/ui";
import {
  AlertTriangle,
  BellOff,
  Check,
  Gauge,
  Lock,
  type LucideIcon,
  MessageSquare,
  OctagonX,
  Pause,
} from "lucide-vue-next";
import { computed } from "vue";
import { useShortcut } from "@/composables/useShortcut";
import { type AlertEvent, type AlertSeverity, useAlertsStore } from "@/stores/alerts";
import { useSessionTabsStore } from "@/stores/sessionTabs";

const alertsStore = useAlertsStore();
const tabStore = useSessionTabsStore();

interface AlertGroup {
  label: string;
  severity: AlertSeverity;
  items: AlertEvent[];
}

const groups = computed<AlertGroup[]>(() => {
  const order: AlertSeverity[] = ["error", "warning", "info"];
  const labels: Record<AlertSeverity, string> = {
    error: "Errors",
    warning: "Warnings",
    info: "Info",
  };
  return order
    .map<AlertGroup>((sev) => ({
      label: labels[sev],
      severity: sev,
      items: alertsStore.alerts.filter((a) => a.severity === sev),
    }))
    .filter((g) => g.items.length > 0);
});

function iconFor(type: AlertEvent["type"]): LucideIcon {
  switch (type) {
    case "session-end":
      return Check;
    case "ask-user":
    case "sdk-user-input-required":
      return MessageSquare;
    case "sdk-permission-required":
      return Lock;
    case "session-error":
    case "sdk-session-error":
      return OctagonX;
    case "sdk-event-lag":
      return Gauge;
    case "sdk-session-idle":
      return Pause;
  }
  return AlertTriangle;
}

function toneFor(severity: AlertSeverity): StatusPillTone {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function handleClick(alert: AlertEvent) {
  alertsStore.markRead(alert.id);
  if (alert.sessionId && alert.sessionId !== "test" && alert.sessionId !== "sdk-bridge") {
    tabStore.openTab(
      alert.sessionId,
      alert.sessionSummary ?? `Session ${alert.sessionId.slice(0, 8)}`,
    );
    alertsStore.drawerOpen = false;
  }
}

const visible = computed({
  get: () => alertsStore.drawerOpen,
  set: (v: boolean) => {
    alertsStore.drawerOpen = v;
  },
});

useShortcut("Mod+Shift+A", () => alertsStore.toggleDrawer(), {
  description: "Toggle alert center",
  group: "Global",
});
</script>

<template>
  <Drawer
    v-model:visible="visible"
    placement="right"
    width="400px"
    title="Alerts"
    :modal="false"
  >
    <template #header>
      <div class="alerts-header">
        <h2 class="alerts-title">Alerts</h2>
        <div class="alerts-meta">
          <span v-if="alertsStore.hasUnread" class="alerts-unread">
            {{ alertsStore.unreadCount }} unread
          </span>
          <button
            v-if="alertsStore.hasUnread"
            type="button"
            class="alerts-action"
            @click="alertsStore.markAllRead()"
          >
            Mark all read
          </button>
          <button
            v-if="alertsStore.alerts.length"
            type="button"
            class="alerts-action alerts-action--muted"
            @click="alertsStore.clearAll()"
          >
            Clear
          </button>
        </div>
      </div>
    </template>

    <EmptyState
      v-if="alertsStore.alerts.length === 0"
      title="No alerts"
      description="You're caught up. Alerts appear here when sessions complete, need input, or encounter errors."
    >
      <template #icon>
        <BellOff :size="32" :stroke-width="1.5" aria-hidden="true" />
      </template>
    </EmptyState>

    <div v-else class="alerts-list" aria-live="polite">
      <section v-for="group in groups" :key="group.severity" class="alerts-group">
        <div class="alerts-group-label">{{ group.label }}</div>
        <div
          v-for="alert in group.items"
          :key="alert.id"
          class="alert-row"
          :class="{ 'alert-row--unread': !alert.read }"
          role="button"
          tabindex="0"
          :aria-label="`${group.label}: ${alert.title} — ${formatTime(alert.timestamp)}`"
          @click="handleClick(alert)"
          @keydown.enter="handleClick(alert)"
          @keydown.space.prevent="handleClick(alert)"
        >
          <span class="alert-row-icon" aria-hidden="true">
            <component :is="iconFor(alert.type)" :size="16" :stroke-width="1.5" />
          </span>
          <div class="alert-row-content">
            <div class="alert-row-title-line">
              <StatusPill :tone="toneFor(alert.severity)" size="xs" :label="alert.severity" />
              <span class="alert-row-title">{{ alert.title }}</span>
            </div>
            <div v-if="alert.body" class="alert-row-body">{{ alert.body }}</div>
            <div class="alert-row-meta">
              <span v-if="alert.sessionSummary">{{ alert.sessionSummary }}</span>
              <span class="alert-row-time">{{ formatTime(alert.timestamp) }}</span>
            </div>
          </div>
          <button
            type="button"
            class="alert-row-dismiss"
            aria-label="Dismiss alert"
            @click.stop="alertsStore.dismiss(alert.id)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </section>
    </div>
  </Drawer>
</template>

<style scoped>
.alerts-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.alerts-title {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: var(--text-primary);
}
.alerts-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}
.alerts-unread { color: var(--text-secondary); }
.alerts-action {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  color: var(--accent-fg);
  cursor: pointer;
  padding: 0;
}
.alerts-action:hover { color: var(--accent-emphasis-hover); }
.alerts-action--muted { color: var(--text-tertiary); }
.alerts-action--muted:hover { color: var(--danger-fg); }
.alerts-action:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.alerts-list { padding: 4px 0 16px; }
.alerts-group { padding-top: 8px; }
.alerts-group-label {
  padding: 8px 20px 4px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.alert-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 20px;
  min-height: 64px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.alert-row:hover { background: var(--surface-tertiary); }
.alert-row:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}
.alert-row--unread { background: var(--accent-subtle); }
.alert-row--unread:hover { background: var(--surface-tertiary); }

.alert-row-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.alert-row--unread .alert-row-icon { color: var(--accent-fg); }

.alert-row-content { flex: 1; min-width: 0; }
.alert-row-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.alert-row-title {
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.alert-row-body {
  margin-top: 4px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alert-row-meta {
  margin-top: 4px;
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}
.alert-row-time { font-variant-numeric: tabular-nums; }

.alert-row-dismiss {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition:
    opacity 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.alert-row:hover .alert-row-dismiss,
.alert-row:focus-within .alert-row-dismiss { opacity: 1; }
.alert-row-dismiss:hover { color: var(--text-primary); }
.alert-row-dismiss:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
  opacity: 1;
}
</style>
