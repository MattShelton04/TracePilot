<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>

<template>
  <label class="form-switch-wrapper">
    <button
      class="form-switch"
      :class="{ on: modelValue }"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="form-switch-thumb" />
    </button>
    <span v-if="label" class="form-switch-label">{{ label }}</span>
  </label>
</template>

<style scoped>
.form-switch-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.form-switch {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--neutral-muted);
  border: 1px solid var(--border-default);
  position: relative;
  transition: background var(--transition-normal);
  cursor: pointer;
  padding: 0;
}
.form-switch.on {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}
.form-switch-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 1px;
  left: 1px;
  transition: transform var(--transition-normal);
}
.form-switch.on .form-switch-thumb {
  transform: translateX(16px);
}
.form-switch-label {
  font-size: 0.875rem;
  color: var(--text-primary);
}
</style>
