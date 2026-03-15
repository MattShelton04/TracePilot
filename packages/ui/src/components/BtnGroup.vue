<script setup lang="ts">
defineProps<{
  options: Array<{ value: string; label: string }>;
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <div class="btn-group" role="group">
    <button
      v-for="option in options"
      :key="option.value"
      class="btn btn-sm"
      :class="{ 'btn-primary': modelValue === option.value }"
      :aria-pressed="modelValue === option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
