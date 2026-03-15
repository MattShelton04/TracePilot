<script setup lang="ts">
defineProps<{
  message?: string;
}>();
</script>

<template>
  <div
    class="rounded-lg border p-4 text-sm"
    style="border-color: var(--danger-muted); background: var(--danger-muted); color: var(--danger-fg);"
  >
    <slot>{{ message }}</slot>
  </div>
</template>
