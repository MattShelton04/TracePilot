<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <div class="empty-state">
        <div class="empty-state-icon">404</div>
        <h2 class="empty-state-title">Page Not Found</h2>
        <p class="empty-state-desc">
          The page you're looking for doesn't exist.
        </p>
        <button class="btn btn-primary" @click="router.push('/')">
          Back to Sessions
        </button>
      </div>
    </div>
  </div>
</template>
