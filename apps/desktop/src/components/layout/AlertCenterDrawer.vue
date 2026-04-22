<script setup lang="ts">
import { ActionButton } from "@tracepilot/ui";
import { computed } from "vue";
import { type AlertEvent, useAlertsStore } from "@/stores/alerts";
import { useSessionTabsStore } from "@/stores/sessionTabs";

const alertsStore = useAlertsStore();
const tabStore = useSessionTabsStore();

const alerts = computed(() => alertsStore.alerts);
const hasAlerts = computed(() => alerts.value.length > 0);

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function iconForType(type: AlertEvent["type"]): string {
  switch (type) {
    case "session-end":
      return "✓";
    case "ask-user":
      return "💬";
    case "session-error":
      return "⚠";
  }
}

function severityClass(severity: AlertEvent["severity"]): string {
  return `severity-${severity}`;
}

function handleAlertClick(alert: AlertEvent) {
  alertsStore.markRead(alert.id);
  if (alert.sessionId && alert.sessionId !== "test") {
    tabStore.openTab(
      alert.sessionId,
      alert.sessionSummary ?? `Session ${alert.sessionId.slice(0, 8)}`,
    );
  }
}

function handleClose() {
  alertsStore.drawerOpen = false;
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="alertsStore.drawerOpen" class="alert-drawer-overlay" @click.self="handleClose">
      <aside class="alert-drawer" role="complementary" aria-label="Alert center">
        <div class="alert-drawer-header">
          <h2 class="alert-drawer-title">Alerts</h2>
          <div class="alert-drawer-actions">
            <button
              v-if="alertsStore.hasUnread"
              class="alert-drawer-action"
              title="Mark all as read"
              @click="alertsStore.markAllRead()"
            >
              ✓ Read all
            </button>
            <button
              v-if="hasAlerts"
              class="alert-drawer-action alert-drawer-action-danger"
              title="Clear all alerts"
              @click="alertsStore.clearAll()"
            >
              Clear
            </button>
            <button
              class="alert-drawer-close"
              aria-label="Close alert center"
              @click="handleClose"
            >
              ×
            </button>
          </div>
        </div>

        <div v-if="!hasAlerts" class="alert-drawer-empty">
          <div class="alert-drawer-empty-icon">🔔</div>
          <div class="alert-drawer-empty-text">No alerts yet</div>
          <div class="alert-drawer-empty-hint">
            Alerts appear here when sessions complete, need input, or encounter errors.
          </div>
        </div>

        <div v-else class="alert-drawer-list">
          <div
            v-for="alert in alerts"
            :key="alert.id"
            class="alert-item"
            :class="[severityClass(alert.severity), { unread: !alert.read }]"
            role="button"
            tabindex="0"
            @click="handleAlertClick(alert)"
            @keydown.enter="handleAlertClick(alert)"
          >
            <div class="alert-item-icon">{{ iconForType(alert.type) }}</div>
            <div class="alert-item-content">
              <div class="alert-item-title">{{ alert.title }}</div>
              <div class="alert-item-body">{{ alert.body }}</div>
              <div class="alert-item-time">{{ formatTime(alert.timestamp) }}</div>
            </div>
            <button
              class="alert-item-dismiss"
              title="Dismiss"
              @click.stop="alertsStore.dismiss(alert.id)"
            >
              ×
            </button>
          </div>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.alert-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--backdrop-color);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: flex-end;
}

.alert-drawer {
  width: 360px;
  max-width: 90vw;
  height: 100%;
  background: var(--canvas-overlay);
  border-left: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.alert-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.alert-drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.alert-drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.alert-drawer-action {
  background: none;
  border: none;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.alert-drawer-action:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}
.alert-drawer-action-danger:hover {
  color: var(--danger-fg);
}

.alert-drawer-close {
  background: none;
  border: none;
  font-size: 18px;
  line-height: 1;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0 4px;
  margin-left: 4px;
}
.alert-drawer-close:hover {
  color: var(--text-primary);
}

.alert-drawer-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  text-align: center;
}
.alert-drawer-empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
  opacity: 0.5;
}
.alert-drawer-empty-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.alert-drawer-empty-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  max-width: 240px;
  line-height: 1.5;
}

.alert-drawer-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
  border-bottom: 1px solid var(--border-subtle);
}
.alert-item:hover {
  background: var(--neutral-subtle);
}
.alert-item.unread {
  background: var(--accent-subtle, rgba(99, 102, 241, 0.06));
}
.alert-item.unread:hover {
  background: var(--accent-subtle-hover, rgba(99, 102, 241, 0.1));
}

.alert-item-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: 50%;
  background: var(--neutral-subtle);
}
.severity-warning .alert-item-icon {
  background: var(--warning-subtle, rgba(234, 179, 8, 0.1));
}
.severity-error .alert-item-icon {
  background: var(--danger-subtle, rgba(239, 68, 68, 0.1));
}

.alert-item-content {
  flex: 1;
  min-width: 0;
}

.alert-item-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.alert-item-body {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-item-time {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}

.alert-item-dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.alert-item:hover .alert-item-dismiss {
  opacity: 1;
}
.alert-item-dismiss:hover {
  color: var(--text-primary);
}

/* Transition */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-enter-active .alert-drawer,
.drawer-leave-active .alert-drawer {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .alert-drawer,
.drawer-leave-to .alert-drawer {
  transform: translateX(100%);
}
</style>
