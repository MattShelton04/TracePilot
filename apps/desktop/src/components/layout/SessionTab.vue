<script setup lang="ts">
/**
 * SessionTab — single tab in the SessionTabStrip.
 *
 * Owns the tab DOM (label, optional live dot, close button, optional
 * insertion indicator). All interaction (click/keydown/pointer/contextmenu)
 * is forwarded to the parent so the strip-level state machines (drag,
 * keyboard nav, context menu) stay in one place.
 */

import { ref } from "vue";
import type { SessionTab as SessionTabModel } from "@/stores/sessionTabs";

const props = defineProps<{
  tab: SessionTabModel;
  index: number;
  active: boolean;
  focused: boolean;
  isDragSource: boolean;
  dragOffset: number;
  showInsertionIndicator: boolean;
}>();

const emit = defineEmits<{
  activate: [];
  close: [event: MouseEvent];
  middleMouseDown: [event: MouseEvent];
  contextmenu: [event: MouseEvent];
  keydown: [event: KeyboardEvent];
  pointerdown: [event: PointerEvent];
  pointermove: [event: PointerEvent];
  pointerup: [event: PointerEvent];
  pointercancel: [event: PointerEvent];
}>();

const rootEl = ref<HTMLElement | null>(null);

defineExpose({
  rootEl,
  focus: () => rootEl.value?.focus(),
});

function onClose(event: MouseEvent) {
  event.stopPropagation();
  emit("close", event);
}
</script>

<template>
  <div
    ref="rootEl"
    role="tab"
    :aria-selected="active"
    :tabindex="focused ? 0 : -1"
    class="session-tab"
    :class="{
      active,
      'is-live': tab.isActive,
      'is-dragging': isDragSource,
    }"
    :style="isDragSource
      ? { transform: `translateX(${dragOffset}px)`, zIndex: 10, position: 'relative' }
      : undefined"
    @click="emit('activate')"
    @mousedown="emit('middleMouseDown', $event)"
    @contextmenu="emit('contextmenu', $event)"
    @keydown="emit('keydown', $event)"
    @pointerdown="emit('pointerdown', $event)"
    @pointermove="emit('pointermove', $event)"
    @pointerup="emit('pointerup', $event)"
    @pointercancel="emit('pointercancel', $event)"
  >
    <div v-if="showInsertionIndicator" class="insertion-indicator" />
    <span v-if="tab.isActive" class="tab-live-dot" title="Session is active" />
    <span class="tab-label" :title="tab.label">{{ tab.label }}</span>
    <button
      class="tab-close"
      tabindex="-1"
      :aria-label="`Close ${tab.label}`"
      @click="onClose"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
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
</style>
