/**
 * Session Tabs Store — manages open session tabs for multi-tab viewing.
 *
 * Tracks which sessions are open as tabs, which tab is active, and
 * persists tab state to localStorage for session continuity across reloads.
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export interface SessionTab {
  /** Session ID (unique per tab) */
  sessionId: string;
  /** Display label (summary or truncated ID) */
  label: string;
  /** Active inner sub-tab (overview, conversation, etc.) */
  activeSubTab: string;
  /** Whether this session is currently running (live indicator) */
  isActive?: boolean;
}

const STORAGE_KEY = "tracepilot:session-tabs";
const MAX_TABS = 20;

/** Default sub-tab for newly opened sessions */
const DEFAULT_SUB_TAB = "overview";

function loadPersistedTabs(): { tabs: SessionTab[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
        activeId: parsed.activeId ?? null,
      };
    }
  } catch { /* ignore corrupt data */ }
  return { tabs: [], activeId: null };
}

function persistTabs(tabs: SessionTab[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
  } catch { /* quota exceeded — best effort */ }
}

export const useSessionTabsStore = defineStore("sessionTabs", () => {
  const persisted = loadPersistedTabs();
  const tabs = ref<SessionTab[]>(persisted.tabs);
  const activeTabId = ref<string | null>(persisted.activeId);

  // Auto-persist on changes
  watch(
    [tabs, activeTabId],
    () => persistTabs(tabs.value, activeTabId.value),
    { deep: true },
  );

  const activeTab = computed(() =>
    tabs.value.find((t) => t.sessionId === activeTabId.value) ?? null,
  );

  const tabCount = computed(() => tabs.value.length);

  /**
   * Open a session in a new tab (or activate it if already open).
   * Returns true if a new tab was created, false if existing tab was activated.
   */
  function openTab(sessionId: string, label?: string): boolean {
    const existing = tabs.value.find((t) => t.sessionId === sessionId);
    if (existing) {
      activeTabId.value = sessionId;
      if (label && existing.label !== label) {
        existing.label = label;
      }
      return false;
    }

    if (tabs.value.length >= MAX_TABS) {
      // Evict the oldest non-active tab
      const evictIdx = tabs.value.findIndex((t) => t.sessionId !== activeTabId.value);
      if (evictIdx >= 0) {
        tabs.value.splice(evictIdx, 1);
      }
    }

    tabs.value.push({
      sessionId,
      label: label ?? sessionId.slice(0, 8) + "…",
      activeSubTab: DEFAULT_SUB_TAB,
    });
    activeTabId.value = sessionId;
    return true;
  }

  /** Close a tab by session ID. Activates an adjacent tab if the closed tab was active. */
  function closeTab(sessionId: string) {
    const idx = tabs.value.findIndex((t) => t.sessionId === sessionId);
    if (idx < 0) return;

    const wasActive = activeTabId.value === sessionId;
    tabs.value.splice(idx, 1);

    if (wasActive) {
      if (tabs.value.length === 0) {
        activeTabId.value = null;
      } else {
        // Activate the tab at the same position (or the last one)
        const nextIdx = Math.min(idx, tabs.value.length - 1);
        activeTabId.value = tabs.value[nextIdx].sessionId;
      }
    }
  }

  /** Close all tabs except the one with the given session ID. */
  function closeOtherTabs(keepSessionId: string) {
    if (!tabs.value.some((t) => t.sessionId === keepSessionId)) return;
    tabs.value = tabs.value.filter((t) => t.sessionId === keepSessionId);
    activeTabId.value = keepSessionId;
  }

  /** Close all tabs. */
  function closeAllTabs() {
    tabs.value = [];
    activeTabId.value = null;
  }

  /** Activate a specific tab. */
  function activateTab(sessionId: string) {
    if (tabs.value.some((t) => t.sessionId === sessionId)) {
      activeTabId.value = sessionId;
    }
  }

  /** Update the active sub-tab for a given session tab. */
  function setSubTab(sessionId: string, subTab: string) {
    const tab = tabs.value.find((t) => t.sessionId === sessionId);
    if (tab) {
      tab.activeSubTab = subTab;
    }
  }

  /** Update the label for a tab (e.g., when session summary loads). */
  function updateLabel(sessionId: string, label: string) {
    const tab = tabs.value.find((t) => t.sessionId === sessionId);
    if (tab) {
      tab.label = label;
    }
  }

  /** Update the live/active status for a tab. */
  function setTabActive(sessionId: string, isActive: boolean) {
    const tab = tabs.value.find((t) => t.sessionId === sessionId);
    if (tab) {
      tab.isActive = isActive;
    }
  }

  /** Move a tab to a new position (for drag-and-drop reordering). */
  function moveTab(fromIndex: number, toIndex: number) {
    if (
      fromIndex < 0 || fromIndex >= tabs.value.length ||
      toIndex < 0 || toIndex >= tabs.value.length ||
      fromIndex === toIndex
    ) return;
    const [moved] = tabs.value.splice(fromIndex, 1);
    tabs.value.splice(toIndex, 0, moved);
  }

  /** Deactivate all tabs (return to session list). Tabs remain open. */
  function deactivateAll() {
    activeTabId.value = null;
  }

  // ── Popup window tracking ────────────────────────────────────────
  // Tracks session IDs that are open in popup (viewer) windows so the
  // alert system can include them in "monitored" scope.
  const popupSessionIds = ref<Set<string>>(new Set());

  function registerPopup(sessionId: string) {
    popupSessionIds.value = new Set([...popupSessionIds.value, sessionId]);
  }

  function unregisterPopup(sessionId: string) {
    const next = new Set(popupSessionIds.value);
    next.delete(sessionId);
    popupSessionIds.value = next;
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    tabCount,
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    activateTab,
    deactivateAll,
    setSubTab,
    updateLabel,
    setTabActive,
    moveTab,
    popupSessionIds,
    registerPopup,
    unregisterPopup,
  };
});
