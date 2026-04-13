<script setup lang="ts">
/**
 * SessionTabStrip — horizontal tab bar for open session tabs.
 *
 * Features:
 *  - "Sessions" home pill to return to the session list at any time
 *  - Keyboard navigation (arrow keys, Home/End, Delete)
 *  - Middle-click to close tabs
 *  - Context menu (Close, Close Others, Close All, Pop Out to Window)
 *  - Pointer-based drag to reorder tabs (reliable in WebView2)
 *  - Drag a tab out of the strip to pop it into its own window
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { openSessionWindow } from "@tracepilot/client";
import { logError } from "@/utils/logger";

const props = defineProps<{
  /** Whether the current route is a session-compatible route (home, session list, session detail) */
  isSessionRoute?: boolean;
}>();

const emit = defineEmits<{
  /** Emitted when "Sessions" pill is clicked — parent should show router-view */
  "go-home": [];
}>();

const router = useRouter();
const tabStore = useSessionTabsStore();

const tabRefs = ref<HTMLElement[]>([]);
const focusedIndex = ref(0);
const contextMenuTab = ref<string | null>(null);
const contextMenuPos = ref({ x: 0, y: 0 });

// ── Pointer-based drag state ─────────────────────────────────────────
const stripRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const dragIndex = ref(-1);
const dragSessionId = ref<string | null>(null);
const dragOffset = ref(0);
const dragCurrentX = ref(0);
const insertionIndex = ref<number | null>(null);
const DRAG_THRESHOLD = 5; // px before drag starts
let pointerStartX = 0;
let pointerStartY = 0;
let tabStartLeft = 0;
let tabWidths: number[] = [];
let tabLeftEdges: number[] = [];
let dragStarted = false;

const tabs = computed(() => tabStore.tabs);
const activeTabId = computed(() => tabStore.activeTabId);

// Trim tabRefs to match current tab count (prevents stale DOM refs on close)
watch(tabs, () => { tabRefs.value.length = tabs.value.length; });

/** Home pill is "active" only when no tab is selected AND we're on a session route */
const isHomeActive = computed(
  () => activeTabId.value === null && (props.isSessionRoute ?? true),
);

watch(activeTabId, (id) => {
  const idx = tabs.value.findIndex((t) => t.sessionId === id);
  if (idx >= 0) focusedIndex.value = idx;
}, { immediate: true });

function activate(sessionId: string) {
  tabStore.activateTab(sessionId);
}

function close(sessionId: string, event?: MouseEvent) {
  event?.stopPropagation();
  tabStore.closeTab(sessionId);
}

function goHome() {
  tabStore.deactivateAll();
  emit("go-home");
  router.push("/");
}

function handleMiddleClick(event: MouseEvent, sessionId: string) {
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
function onPointerDown(event: PointerEvent, index: number) {
  // Only primary button; ignore right-click and middle-click
  if (event.button !== 0) return;
  // Ignore clicks on the close button
  if ((event.target as HTMLElement).closest(".tab-close")) return;

  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  dragIndex.value = index;
  dragSessionId.value = tabs.value[index].sessionId;
  dragStarted = false;

  // Capture pointer to receive events outside the element
  const el = event.currentTarget as HTMLElement;
  el.setPointerCapture(event.pointerId);

  // Snapshot tab positions for hit-testing during drag
  tabWidths = [];
  tabLeftEdges = [];
  for (const ref of tabRefs.value) {
    if (ref) {
      const rect = ref.getBoundingClientRect();
      tabWidths.push(rect.width);
      tabLeftEdges.push(rect.left);
    }
  }
  tabStartLeft = tabLeftEdges[index] ?? 0;
}

function onPointerMove(event: PointerEvent) {
  if (dragIndex.value < 0) return;

  const dx = event.clientX - pointerStartX;
  const dy = event.clientY - pointerStartY;

  if (!dragStarted) {
    // Check if movement exceeds threshold
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragStarted = true;
    isDragging.value = true;
    dragOffset.value = 0;
  }

  dragOffset.value = dx;
  dragCurrentX.value = event.clientX;

  // Calculate the insertion target based on horizontal position
  const dragCenterX = tabStartLeft + (tabWidths[dragIndex.value] ?? 0) / 2 + dx;
  let targetIdx = tabs.value.length; // default: append at end
  for (let i = 0; i < tabs.value.length; i++) {
    const midpoint = (tabLeftEdges[i] ?? 0) + (tabWidths[i] ?? 0) / 2;
    if (dragCenterX < midpoint) {
      targetIdx = i;
      break;
    }
  }
  insertionIndex.value = targetIdx === dragIndex.value || targetIdx === dragIndex.value + 1
    ? null // no visual indicator when over the same position
    : targetIdx;
}

function onPointerUp(event: PointerEvent) {
  if (dragIndex.value < 0) return;

  const el = event.currentTarget as HTMLElement;
  el.releasePointerCapture(event.pointerId);

  if (!dragStarted) {
    // No drag — treat as a normal click (already handled by @click)
    cleanupDrag();
    return;
  }

  // Check if the pointer is outside the strip (pop-out)
  const stripRect = stripRef.value?.getBoundingClientRect();
  const sessionId = dragSessionId.value;
  const outside = stripRect
    ? event.clientY < stripRect.top - 20 || event.clientY > stripRect.bottom + 20
    : false;

  if (outside && sessionId) {
    // Pop out to new window — only close the tab on success
    const tab = tabs.value.find((t) => t.sessionId === sessionId);
    openSessionWindow(sessionId, tab?.label)
      .then(() => {
        tabStore.registerPopup(sessionId);
        tabStore.closeTab(sessionId);
      })
      .catch((e) => logError("[tab-strip] Failed to pop out via drag:", e));
  } else if (insertionIndex.value !== null) {
    // Reorder within the strip
    let toIdx = insertionIndex.value;
    // If inserting after the source, account for removal shift
    if (toIdx > dragIndex.value) toIdx -= 1;
    if (toIdx !== dragIndex.value) {
      tabStore.moveTab(dragIndex.value, toIdx);
    }
  }

  cleanupDrag();
}

function onPointerCancel() {
  cleanupDrag();
}

function cleanupDrag() {
  isDragging.value = false;
  dragIndex.value = -1;
  dragSessionId.value = null;
  dragOffset.value = 0;
  insertionIndex.value = null;
  dragStarted = false;
  tabWidths = [];
  tabLeftEdges = [];
}

// Cleanup on unmount
onBeforeUnmount(() => cleanupDrag());

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
  try {
    const tab = tabs.value.find((t) => t.sessionId === contextMenuTab.value);
    await openSessionWindow(contextMenuTab.value, tab?.label);
    tabStore.registerPopup(contextMenuTab.value);
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
    <!-- "Sessions" home pill — always visible, returns to session list -->
    <div
      class="session-tab home-tab"
      :class="{ active: isHomeActive }"
      role="tab"
      :aria-selected="activeTabId === null"
      title="All Sessions"
      @click="goHome"
    >
      <span class="tab-label">Sessions</span>
    </div>

    <div class="tab-separator" />

    <!-- Session tabs -->
    <div
      v-for="(tab, index) in tabs"
      :key="tab.sessionId"
      :ref="(el) => { if (el) tabRefs[index] = el as HTMLElement }"
      role="tab"
      :aria-selected="activeTabId === tab.sessionId"
      :tabindex="index === focusedIndex ? 0 : -1"
      class="session-tab"
      :class="{
        active: activeTabId === tab.sessionId,
        'is-live': tab.isActive,
        'is-dragging': isDragging && dragIndex === index,
      }"
      :style="isDragging && dragIndex === index
        ? { transform: `translateX(${dragOffset}px)`, zIndex: 10, position: 'relative' }
        : undefined"
      @click="activate(tab.sessionId)"
      @mousedown="handleMiddleClick($event, tab.sessionId)"
      @contextmenu="showContextMenu($event, tab.sessionId)"
      @keydown="handleKeydown($event, index)"
      @pointerdown="onPointerDown($event, index)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <!-- Insertion indicator (left edge) -->
      <div
        v-if="insertionIndex === index"
        class="insertion-indicator"
      />
      <span v-if="tab.isActive" class="tab-live-dot" title="Session is active" />
      <span class="tab-label" :title="tab.label">{{ tab.label }}</span>
      <button
        class="tab-close"
        tabindex="-1"
        :aria-label="`Close ${tab.label}`"
        @click="close(tab.sessionId, $event)"
      >
        ×
      </button>
    </div>

    <!-- Insertion indicator at the very end -->
    <div
      v-if="insertionIndex !== null && insertionIndex >= tabs.length"
      class="insertion-indicator insertion-indicator--end"
    />

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenuTab"
        class="tab-context-menu"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="contextClose">Close</button>
        <button class="ctx-item" @click="contextCloseOthers">Close Others</button>
        <button class="ctx-item" @click="contextCloseAll">Close All</button>
        <div class="ctx-separator" />
        <button class="ctx-item" @click="contextPopOut">Pop Out to Window</button>
      </div>
      <div v-if="contextMenuTab" class="tab-context-backdrop" @click="hideContextMenu" />
    </Teleport>
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
  max-width: 200px;
  min-width: 80px;
  transition: all 0.15s ease;
  user-select: none;
  position: relative;
}

.session-tab.home-tab {
  min-width: auto;
  max-width: none;
  padding: 6px 12px;
  font-weight: 600;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-tertiary);
}

.session-tab.home-tab.active {
  color: var(--text-primary);
}

.session-tab:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.session-tab.active {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  border-color: var(--border-default);
  font-weight: 600;
}

/* Active tab covers the strip bottom border */
.session-tab.active::after {
  content: "";
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--canvas-subtle);
}

/* Drag-and-drop visual feedback */
.session-tab.is-dragging {
  opacity: 0.85;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  cursor: grabbing;
}

.insertion-indicator {
  position: absolute;
  left: -2px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent-fg);
  border-radius: 1px;
  z-index: 5;
  pointer-events: none;
}

.insertion-indicator--end {
  position: relative;
  flex-shrink: 0;
  width: 2px;
  margin: 4px 0;
  background: var(--accent-fg);
  border-radius: 1px;
}

.tab-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  animation: tab-pulse 2s ease-in-out infinite;
}

@keyframes tab-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: var(--text-tertiary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  transition: all 0.1s;
  flex-shrink: 0;
}

.session-tab:hover .tab-close,
.session-tab.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

/* Context menu */
.tab-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.tab-context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 4px 0;
}

.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  font-size: 0.75rem;
  color: var(--text-primary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.ctx-item:hover {
  background: var(--canvas-subtle);
}

.ctx-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-default);
}
</style>
