<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    fill="none"
    aria-hidden="true"
  >
    <polygon
      points="32,2 59,17 59,47 32,62 5,47 5,17"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linejoin="round"
    />
    <polygon
      points="32,7 54,20 54,44 32,57 10,44 10,20"
      fill="currentColor"
      opacity="0.1"
    />
    <path
      d="M15 32c0 0 7.5-11 17-11s17 11 17 11-7.5 11-17 11-17-11-17-11z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    />
    <circle cx="32" cy="32" r="6.5" stroke="currentColor" stroke-width="2" />
    <circle cx="32" cy="32" r="2.5" fill="currentColor" />
    <circle cx="34.5" cy="30" r="1" fill="currentColor" opacity="0.7" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>
