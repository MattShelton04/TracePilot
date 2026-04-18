// ─── Alert History Store ──────────────────────────────────────────
// Stores alert events (session ended, ask_user prompts, errors) and
// provides reactive state for the alert center drawer + badge count.

import { usePersistedRef } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

/** Alert event types that trigger notifications. */
export type AlertType = "session-end" | "ask-user" | "session-error";

/** Severity used for visual treatment in the alert center. */
export type AlertSeverity = "info" | "warning" | "error";

/** A single alert event stored in history. */
export interface AlertEvent {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  sessionId: string;
  sessionSummary?: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

const MAX_HISTORY = 100;
const STORAGE_KEY = "tracepilot:alert-history";

let idCounter = 0;

function generateId(): string {
  return `alert-${Date.now()}-${++idCounter}`;
}

export const useAlertsStore = defineStore("alerts", () => {
  const alerts = usePersistedRef<AlertEvent[]>(STORAGE_KEY, [], {
    serializer: {
      read: (raw) => (JSON.parse(raw) as AlertEvent[]).slice(0, MAX_HISTORY),
      write: (value) => JSON.stringify(value.slice(0, MAX_HISTORY)),
    },
    onParseError: () => {
      // Corrupt data — start fresh
    },
  });
  const drawerOpen = ref(false);

  // ── Derived state ──────────────────────────────────────────
  const unreadCount = computed(() => alerts.value.filter((a) => !a.read).length);
  const hasUnread = computed(() => unreadCount.value > 0);

  // ── Actions ────────────────────────────────────────────────

  function push(event: Omit<AlertEvent, "id" | "timestamp" | "read">): AlertEvent {
    const alert: AlertEvent = {
      ...event,
      id: generateId(),
      timestamp: Date.now(),
      read: false,
    };
    alerts.value = [alert, ...alerts.value].slice(0, MAX_HISTORY);
    return alert;
  }

  function markRead(id: string) {
    const alert = alerts.value.find((a) => a.id === id);
    if (alert && !alert.read) {
      alert.read = true;
    }
  }

  function markAllRead() {
    for (const alert of alerts.value) {
      if (!alert.read) {
        alert.read = true;
      }
    }
  }

  function dismiss(id: string) {
    alerts.value = alerts.value.filter((a) => a.id !== id);
  }

  function clearAll() {
    alerts.value = [];
  }

  function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value;
  }

  return {
    alerts,
    drawerOpen,
    unreadCount,
    hasUnread,
    push,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    toggleDrawer,
  };
});
