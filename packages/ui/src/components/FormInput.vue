<script setup lang="ts">
const props = defineProps<{
  modelValue: string | number;
  type?: 'text' | 'number';
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  emit('update:modelValue', props.type === 'number' ? Number(val) : val);
}
</script>

<template>
  <input
    class="form-input"
    :type="type || 'text'"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="onInput"
  />
</template>
