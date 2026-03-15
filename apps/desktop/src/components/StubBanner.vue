<script setup lang="ts">
defineProps<{
  message?: string;
}>();
</script>

<template>
  <!-- STUB: Remove this banner when real data is wired -->
  <div class="stub-banner">
    <span class="stub-banner-icon">🔶</span>
    <span>{{ message || 'This page uses demo data. Connect to the backend API for real analytics.' }}</span>
  </div>
</template>

<style scoped>
.stub-banner {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 8px 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.stub-banner-icon {
  font-size: 16px;
  flex-shrink: 0;
}
</style>
