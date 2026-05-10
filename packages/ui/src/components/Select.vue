<!--
  Keyboard-accessible single-select. Thin wrapper around the native <select>,
  styled to match <FormInput>. For autocomplete / typed-search use
  <SearchableSelect>; for filter-style nullable strings use <FilterSelect>.
  See design-system/pages/17-settings.md §Select.
-->
<script setup lang="ts" generic="T extends string">
export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  modelValue: V;
  options: Array<SelectOption<V>>;
  size?: "sm" | "md";
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  name?: string;
}

const props = withDefaults(defineProps<SelectProps<T>>(), {
  size: "md",
  disabled: false,
});

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

function onChange(e: Event) {
  emit("update:modelValue", (e.target as HTMLSelectElement).value as T);
}
</script>

<template>
  <select
    data-tp-component="Select"
    class="tp-select"
    :class="[`tp-select--${size}`]"
    :value="modelValue"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :id="id"
    :name="name"
    @change="onChange"
  >
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option
      v-for="opt in options"
      :key="opt.value"
      :value="opt.value"
      :disabled="opt.disabled"
    >{{ opt.label }}</option>
  </select>
</template>

<style scoped>
.tp-select {
  display: inline-flex;
  align-items: center;
  width: 100%;
  padding: 6px 28px 6px 10px;
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
  appearance: none;
  cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--text-tertiary) 50%),
    linear-gradient(135deg, var(--text-tertiary) 50%, transparent 50%);
  background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  transition:
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.tp-select--sm {
  padding-block: 4px;
  min-height: 28px;
}

.tp-select--md {
  min-height: 32px;
}

.tp-select:hover:not(:disabled) {
  border-color: var(--border-emphasis);
}

.tp-select:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
  border-color: var(--border-accent);
}

.tp-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tp-select option {
  background: var(--canvas-overlay);
  color: var(--text-primary);
}
</style>
