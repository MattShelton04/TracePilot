<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{
  visible: boolean;
  title?: string;
  /** ARIA role for the dialog element. Defaults to 'dialog'. Use 'alertdialog' for confirmations. */
  role?: 'dialog' | 'alertdialog';
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const overlayRef = ref<HTMLElement | null>(null);

function close() {
  emit('update:visible', false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    // Only close if this is the topmost modal
    const allOverlays = document.querySelectorAll('.modal-overlay');
    if (allOverlays.length === 0 || allOverlays[allOverlays.length - 1] === overlayRef.value) {
      close();
    }
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" ref="overlayRef" class="modal-overlay" @click.self="close">
      <div class="modal" :role="role ?? 'dialog'" aria-modal="true" :aria-label="title">
        <div v-if="title || $slots.header" class="modal-header">
          <slot name="header">
            <h3>{{ title }}</h3>
          </slot>
          <button class="btn btn-ghost btn-sm" @click="close" aria-label="Close">✕</button>
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
