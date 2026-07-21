<script setup lang="ts">
/**
 * FileContextMenu — right-click action menu for a file or folder in the session explorer.
 *
 * Teleported to <body>. Visibility, anchor position, and target entry are owned by the
 * parent component; this component only emits action events.
 */

withDefaults(
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
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && entry"
      class="file-context-menu"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @click.stop
      @contextmenu.prevent.stop
    >
      <template v-if="entry.isDirectory">
        <button class="ctx-item" @click="emit('copyPath')">Copy Folder Path</button>
        <button class="ctx-item" @click="emit('openFolder')">Open Folder</button>
      </template>
      <template v-else>
        <button class="ctx-item" @click="emit('copyPath')">Copy File Path</button>
        <button v-if="canCopyContents" class="ctx-item" @click="emit('copyContents')">
          Copy File Contents
        </button>
        <div class="ctx-separator" />
        <button class="ctx-item" @click="emit('openContainingFolder')">Open Containing Folder</button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.file-context-menu {
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
