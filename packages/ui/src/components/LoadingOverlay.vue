<script setup lang="ts">
defineProps<{
  loading: boolean;
  message?: string;
}>();
</script>

<template>
  <div v-if="loading" class="loading-overlay" role="status" aria-live="polite">
    <div class="loading-spinner">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" class="spinner-svg">
        <circle cx="16" cy="16" r="14" stroke="var(--border-default)" stroke-width="3" />
        <path d="M16 2a14 14 0 0 1 14 14" stroke="var(--accent-fg)" stroke-width="3" stroke-linecap="round" />
      </svg>
    </div>
    <p v-if="message" class="loading-message">{{ message }}</p>
  </div>
  <slot v-else />
</template>

<style scoped>
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  gap: 16px;
}
.spinner-svg {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .spinner-svg {
    animation: none;
  }
}
.loading-message {
  color: var(--text-secondary);
  font-size: 0.875rem;
}
</style>
