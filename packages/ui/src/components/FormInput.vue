<script setup lang="ts">
const props = defineProps<{
  modelValue: string | number;
  type?: 'text' | 'number';
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string | number | undefined];
}>();

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  if (props.type === 'number') {
    emit('update:modelValue', val === '' ? undefined : Number(val));
  } else {
    emit('update:modelValue', val);
  }
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
