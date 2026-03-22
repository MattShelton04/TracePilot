<script setup lang="ts">
withDefaults(
  defineProps<{
    heading?: string;
    message?: string;
    retryable?: boolean;
  }>(),
  {
    heading: 'Something went wrong',
    retryable: true,
  },
);

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div class="error-state">
    <svg
      class="error-state__icon"
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M24 4L44 40H4L24 4z"
        stroke="var(--danger-fg)"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <path
        d="M24 18v10"
        stroke="var(--danger-fg)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <circle cx="24" cy="33" r="1.5" fill="var(--danger-fg)" />
    </svg>

    <h2 class="error-state__heading">
      <slot name="heading">{{ heading }}</slot>
    </h2>

    <p v-if="message" class="error-state__message">{{ message }}</p>

    <button
      v-if="retryable"
      type="button"
      class="error-state__retry"
      @click="$emit('retry')"
    >
      Retry
    </button>

    <slot />
  </div>
</template>

<style scoped>
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px;
  text-align: center;
  gap: 12px;
}

.error-state__icon {
  margin-bottom: 4px;
}

.error-state__heading {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.error-state__message {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
  max-width: 420px;
}

.error-state__retry {
  margin-top: 8px;
  padding: 8px 20px;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  background: var(--btn-bg, transparent);
  color: var(--accent-fg);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}
.error-state__retry:hover {
  background: var(--btn-hover-bg, var(--accent-muted));
}
</style>
