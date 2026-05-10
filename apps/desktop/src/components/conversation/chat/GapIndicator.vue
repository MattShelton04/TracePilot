<script setup lang="ts">
defineProps<{
  count: number;
}>();
</script>

<template>
  <div class="cv-gap">
    <div class="cv-gap-line" />
    <div class="cv-gap-label">⋯ {{ count }} turns not shown</div>
    <div class="cv-gap-line" />
  </div>
</template>

<style scoped>
.cv-gap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.cv-gap-line {
  flex: 1;
  height: 0;
  border-top: 1px dashed var(--border-muted);
}

.cv-gap-label {
  font-size: 12px;
  color: var(--text-placeholder);
  white-space: nowrap;
  user-select: none;
}
</style>
