<script setup lang="ts">
/**
 * FileContextMenu — right-click action menu for a file or folder in the session explorer.
 *
 * Teleported to <body>. Visibility, anchor position, and target entry are owned by the
 * parent component; this component only emits action events.
 */

import { ref } from "vue";
import { useContextMenu } from "@/composables/useContextMenu";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    position: { x: number; y: number };
    entry: { path: string; name: string; isDirectory: boolean } | null;
    canCopyContents?: boolean;
  }>(),
  { canCopyContents: true },
);

const emit = defineEmits<{
  copyPath: [];
  copyContents: [];
  openContainingFolder: [];
  openFolder: [];
  dismiss: [];
}>();

const menuRef = ref<HTMLElement | null>(null);
const { placement, onKeydown } = useContextMenu({
  active: () => props.visible && props.entry !== null,
  panel: menuRef,
  position: () => props.position,
  dismiss: () => emit("dismiss"),
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && entry"
      ref="menuRef"
      class="file-context-menu"
      role="menu"
      :aria-label="entry.isDirectory ? 'Folder actions' : 'File actions'"
      tabindex="-1"
      :style="{ left: `${placement.x}px`, top: `${placement.y}px` }"
      @click.stop
      @contextmenu.prevent.stop
      @keydown="onKeydown"
    >
      <template v-if="entry.isDirectory">
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('copyPath')">Copy Folder Path</button>
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('openFolder')">Open Folder</button>
      </template>
      <template v-else>
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('copyPath')">Copy File Path</button>
        <button v-if="canCopyContents" type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('copyContents')">
          Copy File Contents
        </button>
        <div class="ctx-separator" role="separator" />
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('openContainingFolder')">Open Containing Folder</button>
      </template>
    </div>
    <div
      v-if="visible && entry"
      class="file-context-backdrop"
      @click="emit('dismiss')"
      @contextmenu.prevent="emit('dismiss')"
    />
  </Teleport>
</template>

<style scoped>
.file-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
}

.file-context-menu {
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
