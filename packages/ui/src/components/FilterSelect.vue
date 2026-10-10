<script setup lang="ts">
import { computed } from "vue";

/** An option whose value differs from its label, optionally under an `<optgroup>`. */
export interface FilterSelectOption {
  value: string;
  label: string;
  title?: string;
  group?: string;
}

const model = defineModel<string | null>({ default: null });
const props = defineProps<{
  options: Array<string | FilterSelectOption>;
  placeholder?: string;
}>();

const normalized = computed(() =>
  props.options.map(
    (opt): FilterSelectOption => (typeof opt === "string" ? { value: opt, label: opt } : opt),
  ),
);
const ungrouped = computed(() => normalized.value.filter((opt) => !opt.group));
const groups = computed(() => {
  const byName = new Map<string, FilterSelectOption[]>();
  for (const opt of normalized.value) {
    if (!opt.group) continue;
    const list = byName.get(opt.group) ?? [];
    list.push(opt);
    byName.set(opt.group, list);
  }
  return [...byName].map(([label, options]) => ({ label, options }));
});
</script>
<template>
  <select
    :value="model ?? ''"
    :aria-label="placeholder || 'Filter'"
    class="filter-select"
    @change="model = ($event.target as HTMLSelectElement).value || null"
  >
    <option value="">{{ placeholder || 'All' }}</option>
    <option v-for="opt in ungrouped" :key="opt.value" :value="opt.value" :title="opt.title">{{ opt.label }}</option>
    <optgroup v-for="group in groups" :key="group.label" :label="group.label">
      <option v-for="opt in group.options" :key="opt.value" :value="opt.value" :title="opt.title">{{ opt.label }}</option>
    </optgroup>
  </select>
</template>
<style scoped>
.filter-select {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
