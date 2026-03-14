<script setup lang="ts">
defineProps<{
  status: 'done' | 'in_progress' | 'blocked' | 'pending';
  size?: 'sm' | 'md';
}>();
</script>

<template>
  <span class="inline-flex items-center justify-center flex-shrink-0" :class="size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'">
    <!-- Done: filled checkmark circle -->
    <svg v-if="status === 'done'" viewBox="0 0 16 16" fill="currentColor" class="text-[var(--color-success-fg)]" :aria-label="`Status: completed`">
      <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-1.042-.018.751.751 0 0 0-.018 1.042L7.28 10.72a.749.749 0 0 1-1.06 0L4.72 9.22a.751.751 0 0 1 1.042-1.042l.97.97 3.04-2.88Z" />
    </svg>
    <!-- In Progress: dot circle -->
    <svg v-else-if="status === 'in_progress'" viewBox="0 0 16 16" fill="currentColor" class="text-[var(--color-accent-fg)]" :aria-label="`Status: in progress`">
      <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
      <path fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z" />
    </svg>
    <!-- Blocked: stop circle -->
    <svg v-else-if="status === 'blocked'" viewBox="0 0 16 16" fill="currentColor" class="text-[var(--color-danger-fg)]" :aria-label="`Status: blocked`">
      <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
    </svg>
    <!-- Pending: empty circle -->
    <svg v-else viewBox="0 0 16 16" fill="currentColor" class="text-[var(--color-text-tertiary)]" :aria-label="`Status: pending`">
      <path fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z" />
    </svg>
  </span>
</template>
