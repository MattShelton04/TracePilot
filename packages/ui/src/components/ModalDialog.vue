<script setup lang="ts">
import { X } from "lucide-vue-next";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
  title?: string;
  /** ARIA role for the dialog element. Defaults to 'dialog'. Use 'alertdialog' for confirmations. */
  role?: "dialog" | "alertdialog";
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
}>();

const overlayRef = ref<HTMLElement | null>(null);
const closeBtnRef = ref<HTMLElement | null>(null);

function close() {
  emit("update:visible", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.visible) {
    // Only close if this is the topmost modal
    const allOverlays = document.querySelectorAll(".modal-overlay");
    if (allOverlays.length === 0 || allOverlays[allOverlays.length - 1] === overlayRef.value) {
      close();
    }
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      nextTick(() => closeBtnRef.value?.focus());
    }
  },
);

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" ref="overlayRef" class="modal-overlay" @click.self="close">
      <div class="modal" :role="role ?? 'dialog'" aria-modal="true" :aria-label="title">
        <div v-if="title || $slots.header" class="modal-header">
          <slot name="header">
            <h3>{{ title }}</h3>
          </slot>
          <button
            ref="closeBtnRef"
            class="btn btn-ghost btn-sm modal-close"
            type="button"
            @click="close"
            aria-label="Close dialog"
          >
            <X :size="14" :stroke-width="1.5" aria-hidden="true" />
          </button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.modal-close:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}
.modal-close:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
