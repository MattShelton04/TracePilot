<script setup lang="ts">
defineProps<{
  /** Remove the inner max-width constraint (e.g. for full-bleed layouts). */
  fluid?: boolean;
}>();
</script>

<template>
  <div class="page-content">
    <div :class="fluid ? undefined : 'page-content-inner'">
      <slot />
    </div>
  </div>
</template>
