// ─── Alert History Store ──────────────────────────────────────────
// Stores alert events (session ended, ask_user prompts, errors) and
// provides reactive state for the alert center drawer + badge count.

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
  const alerts = ref<AlertEvent[]>([]);
  const drawerOpen = ref(false);

  // ── Derived state ──────────────────────────────────────────
  const unreadCount = computed(() => alerts.value.filter((a) => !a.read).length);
  const hasUnread = computed(() => unreadCount.value > 0);

  // ── Persistence ────────────────────────────────────────────
  function hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AlertEvent[];
        alerts.value = parsed.slice(0, MAX_HISTORY);
      }
    } catch {
      // Corrupt data — start fresh
      alerts.value = [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts.value.slice(0, MAX_HISTORY)));
    } catch {
      // localStorage full or unavailable — silently skip
    }
  }

  // Hydrate on creation
  hydrate();

  // ── Actions ────────────────────────────────────────────────

  function push(event: Omit<AlertEvent, "id" | "timestamp" | "read">): AlertEvent {
    const alert: AlertEvent = {
      ...event,
      id: generateId(),
      timestamp: Date.now(),
      read: false,
    };
    alerts.value = [alert, ...alerts.value].slice(0, MAX_HISTORY);
    persist();
    return alert;
  }

  function markRead(id: string) {
    const alert = alerts.value.find((a) => a.id === id);
    if (alert && !alert.read) {
      alert.read = true;
      persist();
    }
  }

  function markAllRead() {
    let changed = false;
    for (const alert of alerts.value) {
      if (!alert.read) {
        alert.read = true;
        changed = true;
      }
    }
    if (changed) persist();
  }

  function dismiss(id: string) {
    alerts.value = alerts.value.filter((a) => a.id !== id);
    persist();
  }

  function clearAll() {
    alerts.value = [];
    persist();
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
