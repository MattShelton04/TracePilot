<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    color?: string;
  }>(),
  {
    size: 'md',
    color: 'var(--accent-fg)',
  },
);

const sizeMap: Record<string, number> = { sm: 16, md: 24, lg: 32 };
const px = computed(() => sizeMap[props.size]);

import { computed } from 'vue';
</script>

<template>
  <span class="loading-spinner" role="status" :aria-label="'Loading'">
    <svg
      :width="px"
      :height="px"
      viewBox="0 0 32 32"
      fill="none"
      class="loading-spinner__svg"
    >
      <circle
        cx="16"
        cy="16"
        r="14"
        stroke="var(--border-default)"
        stroke-width="3"
      />
      <path
        d="M16 2a14 14 0 0 1 14 14"
        :stroke="color"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
    <span class="sr-only">Loading</span>
  </span>
</template>

<style scoped>
.loading-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.loading-spinner__svg {
  animation: spinner-rotate 1s linear infinite;
}
@keyframes spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner__svg {
    animation: none;
  }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
