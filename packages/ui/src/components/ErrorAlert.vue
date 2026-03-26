<script setup lang="ts">
withDefaults(
  defineProps<{
    message?: string;
    severity?: 'error' | 'warning' | 'info';
    variant?: 'inline' | 'banner' | 'compact';
    dismissible?: boolean;
    retryable?: boolean;
  }>(),
  {
    severity: 'error',
    variant: 'inline',
    dismissible: false,
    retryable: false,
  },
);

defineEmits<{
  dismiss: [];
  retry: [];
}>();
</script>

<template>
  <div
    role="alert"
    class="error-alert"
    :class="[`error-alert--${severity}`, `error-alert--${variant}`]"
  >
    <span class="error-alert__icon" aria-hidden="true">
      <svg v-if="severity === 'error'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <svg v-else-if="severity === 'warning'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5L14.5 13.5H1.5L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M8 6.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
        <path d="M8 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="8" cy="4.75" r="0.75" fill="currentColor" />
      </svg>
    </span>

    <span class="error-alert__body">
      <slot>{{ message }}</slot>
    </span>

    <span class="error-alert__actions">
      <button v-if="retryable" class="error-alert__btn" type="button" @click="$emit('retry')">
        Retry
      </button>
      <button
        v-if="dismissible"
        class="error-alert__btn error-alert__btn--dismiss"
        type="button"
        aria-label="Dismiss"
        @click="$emit('dismiss')"
      >
        ✕
      </button>
    </span>
  </div>
</template>

<style scoped>
.error-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid;
  font-size: 0.875rem;
  line-height: 1.5;
}

/* Variants */
.error-alert--inline {
  border-radius: 8px;
  padding: 12px 16px;
}
.error-alert--banner {
  border-radius: 0;
  padding: 12px 16px;
  width: 100%;
}
.error-alert--compact {
  border-radius: 6px;
  padding: 8px;
  font-size: 0.75rem;
}

/* Severity colors */
.error-alert--error {
  border-color: var(--danger-muted);
  background: var(--danger-muted);
  color: var(--danger-fg);
}
.error-alert--warning {
  border-color: var(--warning-muted);
  background: var(--warning-muted);
  color: var(--warning-fg);
}
.error-alert--info {
  border-color: var(--accent-muted);
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.error-alert__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-top: 1px;
}

.error-alert__body {
  flex: 1;
  min-width: 0;
}

.error-alert__actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.error-alert__btn {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 4px;
  opacity: 0.85;
}
.error-alert__btn:hover {
  opacity: 1;
  text-decoration: underline;
}
.error-alert__btn--dismiss {
  font-weight: 400;
  font-size: 1rem;
  line-height: 1;
}
</style>
