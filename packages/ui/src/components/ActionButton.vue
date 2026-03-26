<script setup lang="ts">
defineProps<{
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'ghost' | 'default';
}>();
</script>

<template>
  <button
    type="button"
    class="btn"
    :class="[
      variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : '',
      size === 'sm' ? 'btn-sm' : '',
    ]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>
