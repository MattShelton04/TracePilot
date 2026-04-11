<script setup lang="ts">
import LoadingSpinner from "./LoadingSpinner.vue";

defineProps<{
  disabled?: boolean;
  loading?: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "ghost" | "default";
}>();
</script>

<template>
  <button
    type="button"
    class="btn action-btn"
    :class="[
      variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : '',
      size === 'sm' ? 'btn-sm' : '',
      { 'is-loading': loading }
    ]"
    :disabled="disabled || loading"
    :aria-busy="loading"
  >
    <span v-if="loading" class="action-btn__spinner">
      <LoadingSpinner size="sm" color="currentColor" />
    </span>
    <span class="action-btn__content" :class="{ 'opacity-0': loading }">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.action-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.action-btn__spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
}
.action-btn__content {
  transition: opacity 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.opacity-0 {
  opacity: 0;
}
</style>
