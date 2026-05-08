<script setup lang="ts">
/**
 * SessionTabContextMenu — right-click action menu for a session tab.
 *
 * Teleported to <body>. Visibility and anchor position are owned by the
 * parent strip; this component only emits action events. The backdrop sits
 * underneath the menu and dismisses on click; the parent dismisses on
 * outside-click of the strip and after each action.
 */

defineProps<{
  visible: boolean;
  position: { x: number; y: number };
}>();

const emit = defineEmits<{
  close: [];
  closeOthers: [];
  closeAll: [];
  popOut: [];
  dismiss: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="tab-context-menu"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @click.stop
    >
      <button class="ctx-item" @click="emit('close')">Close</button>
      <button class="ctx-item" @click="emit('closeOthers')">Close Others</button>
      <button class="ctx-item" @click="emit('closeAll')">Close All</button>
      <div class="ctx-separator" />
      <button class="ctx-item" @click="emit('popOut')">Pop Out to Window</button>
    </div>
    <div v-if="visible" class="tab-context-backdrop" @click="emit('dismiss')" />
  </Teleport>
</template>

<style scoped>
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
