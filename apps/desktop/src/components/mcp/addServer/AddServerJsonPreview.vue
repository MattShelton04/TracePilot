<script setup lang="ts">
defineProps<{ jsonPreview: string }>();
</script>

<template>
  <div class="custom-preview-col">
    <div class="custom-preview-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      JSON Preview
    </div>
    <div class="custom-preview-body">
      <pre class="json-preview">{{ jsonPreview }}</pre>
    </div>
  </div>
</template>
