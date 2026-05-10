<script setup lang="ts">
/**
 * SessionTabStrip — horizontal tab bar for open session tabs.
 *
 * Orchestrator: iterates `tabStore.tabs` and renders a `<SessionTab>` per
 * entry, keeps the "Sessions" home pill, and wires up the context menu and
 * the drag-reorder composable. Per-tab presentation lives in `SessionTab.vue`,
 * the context menu in `SessionTabContextMenu.vue`, and pointer-drag state in
 * `useTabReorderDrag`.
 *
 * Features:
 *  - "Sessions" home pill to return to the session list at any time
 *  - Keyboard navigation (arrow keys, Home/End, Delete)
 *  - Middle-click to close tabs
 *  - Context menu (Close, Close Others, Close All, Pop Out to Window)
 *  - Pointer-based drag to reorder tabs (reliable in WebView2)
 *  - Drag a tab out of the strip to pop it into its own window
 */

import { openSessionWindow } from "@tracepilot/client";
import { Home } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { useTabReorderDrag } from "@/composables/useTabReorderDrag";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { logError } from "@/utils/logger";
import SessionTab from "./SessionTab.vue";
import SessionTabContextMenu from "./SessionTabContextMenu.vue";

const props = defineProps<{
  /** Whether the current route is a session-compatible route (home, session list, session detail) */
  isSessionRoute?: boolean;
}>();

const emit = defineEmits<{
  /** Emitted when "Sessions" pill is clicked — parent should show router-view */
  "go-home": [];
}>();

const tabStore = useSessionTabsStore();

const stripRef = ref<HTMLElement | null>(null);
const tabRefs = ref<(HTMLElement | null)[]>([]);
const focusedIndex = ref(0);
const contextMenuTab = ref<string | null>(null);
const contextMenuPos = ref({ x: 0, y: 0 });

const tabs = computed(() => tabStore.tabs);
const activeTabId = computed(() => tabStore.activeTabId);

// Trim tabRefs to match current tab count (prevents stale DOM refs on close)
watch(tabs, () => {
  tabRefs.value.length = tabs.value.length;
});

/** Home pill is "active" only when no tab is selected AND we're on a session route */
const isHomeActive = computed(() => activeTabId.value === null && (props.isSessionRoute ?? true));

watch(
  activeTabId,
  (id) => {
    const idx = tabs.value.findIndex((t) => t.sessionId === id);
    if (idx >= 0) focusedIndex.value = idx;
  },
  { immediate: true },
);

function activate(sessionId: string) {
  tabStore.activateTab(sessionId);
}

function close(sessionId: string) {
  tabStore.closeTab(sessionId);
}

function goHome() {
  emit("go-home");
}

function handleMiddleMouseDown(event: MouseEvent, sessionId: string) {
  if (event.button === 1) {
    event.preventDefault();
    close(sessionId);
  }
}

function handleKeydown(e: KeyboardEvent, index: number) {
  let target = -1;
  switch (e.key) {
    case "ArrowRight":
      e.preventDefault();
      target = (index + 1) % tabs.value.length;
      break;
    case "ArrowLeft":
      e.preventDefault();
      target = (index - 1 + tabs.value.length) % tabs.value.length;
      break;
    case "Home":
      e.preventDefault();
      target = 0;
      break;
    case "End":
      e.preventDefault();
      target = tabs.value.length - 1;
      break;
    case "Delete":
    case "Backspace":
      e.preventDefault();
      close(tabs.value[index].sessionId);
      return;
  }
  if (target >= 0) {
    focusedIndex.value = target;
    activate(tabs.value[target].sessionId);
    nextTick(() => tabRefs.value[target]?.focus());
  }
}

// ── Pointer-based drag-and-drop ──────────────────────────────────────
function popOutSession(sessionId: string) {
  const tab = tabs.value.find((t) => t.sessionId === sessionId);
  openSessionWindow(sessionId, tab?.label)
    .then(() => {
      tabStore.registerPopup(sessionId);
      tabStore.closeTab(sessionId);
    })
    .catch((e) => logError("[tab-strip] Failed to pop out via drag:", e));
}

const {
  isDragging,
  dragIndex,
  dragOffset,
  insertionIndex,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
} = useTabReorderDrag({
  tabs,
  tabEls: tabRefs,
  stripRef,
  onReorder: (from, to) => tabStore.moveTab(from, to),
  onDragOut: popOutSession,
});

function assignTabRef(inst: unknown, index: number) {
  const el = (inst as { rootEl?: HTMLElement | null } | null)?.rootEl ?? null;
  tabRefs.value[index] = el;
}

// ── Context menu ─────────────────────────────────────────────────────
function showContextMenu(event: MouseEvent, sessionId: string) {
  event.preventDefault();
  contextMenuTab.value = sessionId;
  contextMenuPos.value = { x: event.clientX, y: event.clientY };
}

function hideContextMenu() {
  contextMenuTab.value = null;
}

function contextClose() {
  if (contextMenuTab.value) tabStore.closeTab(contextMenuTab.value);
  hideContextMenu();
}
function contextCloseOthers() {
  if (contextMenuTab.value) tabStore.closeOtherTabs(contextMenuTab.value);
  hideContextMenu();
}
function contextCloseAll() {
  tabStore.closeAllTabs();
  hideContextMenu();
}

async function contextPopOut() {
  if (!contextMenuTab.value) return;
  const sessionId = contextMenuTab.value;
  try {
    const tab = tabs.value.find((t) => t.sessionId === sessionId);
    await openSessionWindow(sessionId, tab?.label);
    tabStore.registerPopup(sessionId);
    tabStore.closeTab(sessionId);
  } catch (e) {
    logError("[tab-strip] Failed to pop out session:", e);
  }
  hideContextMenu();
}
</script>

<template>
  <div
    v-if="tabs.length > 0"
    ref="stripRef"
    class="session-tab-strip"
    role="tablist"
    aria-label="Open sessions"
    @click.self="hideContextMenu"
  >
    <!-- Home pill — always visible, returns to session list. Icon-only per
         design-system §1.3 (CC-5: avoid label collision with sidebar
         "Sessions" item; the strip shows open work, not navigation). -->
    <div
      class="session-tab home-tab"
      :class="{ active: isHomeActive }"
      role="tab"
      :aria-selected="activeTabId === null"
      aria-label="All sessions"
      title="All sessions"
      @click="goHome"
    >
      <Home :size="16" :stroke-width="1.5" aria-hidden="true" />
    </div>

    <div class="tab-separator" />

    <!-- Session tabs -->
    <SessionTab
      v-for="(tab, index) in tabs"
      :key="tab.sessionId"
      :ref="(inst) => assignTabRef(inst, index)"
      :tab="tab"
      :index="index"
      :active="activeTabId === tab.sessionId"
      :focused="index === focusedIndex"
      :is-drag-source="isDragging && dragIndex === index"
      :drag-offset="dragOffset"
      :show-insertion-indicator="insertionIndex === index"
      @activate="activate(tab.sessionId)"
      @close="close(tab.sessionId)"
      @middle-mouse-down="handleMiddleMouseDown($event, tab.sessionId)"
      @contextmenu="showContextMenu($event, tab.sessionId)"
      @keydown="handleKeydown($event, index)"
      @pointerdown="onPointerDown($event, index)"
      @pointermove="onPointerMove($event)"
      @pointerup="onPointerUp($event)"
      @pointercancel="onPointerCancel($event)"
    />

    <!-- Insertion indicator at the very end -->
    <div
      v-if="insertionIndex !== null && insertionIndex >= tabs.length"
      class="insertion-indicator insertion-indicator--end"
    />

    <SessionTabContextMenu
      :visible="contextMenuTab !== null"
      :position="contextMenuPos"
      @close="contextClose"
      @close-others="contextCloseOthers"
      @close-all="contextCloseAll"
      @pop-out="contextPopOut"
      @dismiss="hideContextMenu"
    />
  </div>
</template>

<style scoped>
.session-tab-strip {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  background: var(--canvas-default);
  border-bottom: 1px solid var(--border-default);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  min-height: 36px;
  flex-shrink: 0;
}

.tab-separator {
  width: 1px;
  margin: 6px 4px;
  background: var(--border-muted);
  flex-shrink: 0;
}

.session-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  position: relative;
}

.session-tab.home-tab {
  min-width: 32px;
  max-width: none;
  width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.session-tab.home-tab.active {
  color: var(--text-primary);
}

.session-tab.home-tab:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.insertion-indicator--end {
  position: relative;
  flex-shrink: 0;
  width: 2px;
  margin: 4px 0;
  background: var(--accent-fg);
  border-radius: 1px;
}
</style>
