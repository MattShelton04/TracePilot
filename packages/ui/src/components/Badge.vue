<script setup lang="ts">
import { onMounted, onUpdated, ref, useSlots } from 'vue';

defineProps<{
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'done' | 'neutral';
}>();

const variantClass: Record<string, string> = {
  default: 'badge-neutral',
  neutral: 'badge-neutral',
  accent: 'badge-accent',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  done: 'badge-done',
};

const el = ref<HTMLElement>();
const slotText = ref('');
const slots = useSlots();

function updateSlotText() {
  if (el.value) {
    slotText.value = el.value.textContent?.trim() ?? '';
  }
}
onMounted(updateSlotText);
onUpdated(updateSlotText);
</script>
<template>
  <span ref="el" class="badge" :class="variantClass[variant ?? 'default']" :title="slotText">
    <slot />
  </span>
</template>
