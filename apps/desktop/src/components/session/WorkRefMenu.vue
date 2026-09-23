<script setup lang="ts">
/**
 * WorkRefMenu — the actions for one related-work reference.
 *
 * Teleported to <body>. Visibility, anchor position and the reference are
 * owned by the parent; this component only emits the chosen action.
 */

import { ref } from "vue";
import { useContextMenu } from "@/composables/useContextMenu";
import type { WorkRefRow } from "@/utils/workRefs";

const props = defineProps<{
  position: { x: number; y: number };
  row: WorkRefRow | null;
}>();

const emit = defineEmits<{
  open: [];
  copyLink: [];
  copyReference: [];
  search: [];
  dismiss: [];
}>();

const menuRef = ref<HTMLElement | null>(null);
const { placement, onKeydown } = useContextMenu({
  active: () => props.row !== null,
  panel: menuRef,
  position: () => props.position,
  dismiss: () => emit("dismiss"),
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="row"
      ref="menuRef"
      class="work-ref-menu"
      role="menu"
      :aria-label="`Actions for ${row.displayValue}`"
      tabindex="-1"
      data-testid="work-ref-menu"
      :style="{ left: `${placement.x}px`, top: `${placement.y}px` }"
      @click.stop
      @contextmenu.prevent.stop
      @keydown="onKeydown"
    >
      <template v-if="row.href">
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('open')">
          Open in browser
        </button>
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('copyLink')">
          Copy link
        </button>
      </template>
      <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('copyReference')">
        Copy {{ row.copyText }}
      </button>
      <template v-if="row.searchQuery">
        <div class="ctx-separator" role="separator" />
        <button type="button" role="menuitem" tabindex="-1" class="ctx-item" @click="emit('search')">
          Find sessions mentioning {{ row.displayValue }}
        </button>
      </template>
    </div>
    <div
      v-if="row"
      class="work-ref-menu-backdrop"
      @click="emit('dismiss')"
      @contextmenu.prevent="emit('dismiss')"
    />
  </Teleport>
</template>

<style scoped>
.work-ref-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
}

.work-ref-menu {
  position: fixed;
  z-index: var(--z-modal);
  min-width: min(160px, calc(100vw - 16px));
  max-width: min(360px, calc(100vw - 16px));
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
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--text-primary);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: none;
  cursor: pointer;
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
