<script setup lang="ts">
import { ref } from "vue";
import { useContextMenu } from "@/composables/useContextMenu";

const props = defineProps<{
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

const menuRef = ref<HTMLElement | null>(null);
const { placement, onKeydown } = useContextMenu({
  active: () => props.visible,
  panel: menuRef,
  position: () => props.position,
  dismiss: () => emit("dismiss"),
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="tab-context-menu"
      role="menu"
      aria-label="Session tab actions"
      tabindex="-1"
      :style="{ left: `${placement.x}px`, top: `${placement.y}px` }"
      @click.stop
      @contextmenu.prevent.stop
      @keydown="onKeydown"
    >
      <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('close')">Close</button>
      <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('closeOthers')">Close Others</button>
      <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('closeAll')">Close All</button>
      <div class="ctx-separator" role="separator" />
      <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('popOut')">Pop Out to Window</button>
    </div>
    <div v-if="visible" class="tab-context-backdrop" @click="emit('dismiss')" />
  </Teleport>
</template>

<style scoped>
.tab-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
}

.tab-context-menu {
  position: fixed;
  z-index: calc(var(--z-overlay) + 1);
  min-width: min(160px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
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

.ctx-item:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
  background: var(--canvas-subtle);
}

.ctx-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-default);
}
</style>
