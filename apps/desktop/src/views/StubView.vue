<script setup lang="ts">
/**
 * STUB: Temporary placeholder view for routes not yet implemented.
 * This component will be replaced with the actual view implementation
 * as each page is built during the migration.
 */
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- STUB: This is a temporary placeholder. Replace with actual view implementation. -->
      <div class="empty-state">
        <div class="empty-state-icon">🚧</div>
        <h2 class="empty-state-title">{{ route.meta.title || 'Coming Soon' }}</h2>
        <p class="empty-state-desc">
          This page is under construction. It will be available in a future update.
        </p>
      </div>
    </div>
  </div>
</template>
