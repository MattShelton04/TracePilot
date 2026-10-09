<script setup lang="ts" generic="T extends string">
defineProps<{ modelValue: T; options: Array<{ value: T; label: string }>; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
</script>

<template>
  <div class="norm-toggle" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="['toggle-btn', { active: modelValue === option.value }]"
      :aria-pressed="modelValue === option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
