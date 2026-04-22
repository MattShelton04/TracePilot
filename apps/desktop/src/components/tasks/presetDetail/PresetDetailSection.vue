<script setup lang="ts">
defineProps<{ title: string; expanded: boolean }>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <div class="preset-section">
    <button
      class="detail-section__trigger"
      :class="{ 'detail-section__trigger--expanded': expanded }"
      @click="$emit('toggle')"
    >
      <span class="detail-section__title">{{ title }}</span>
      <svg
        class="detail-section__chevron"
        viewBox="0 0 16 16"
        fill="currentColor"
        width="12"
        height="12"
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
    </button>
    <div v-if="expanded" class="detail-section__body">
      <slot />
    </div>
  </div>
</template>
