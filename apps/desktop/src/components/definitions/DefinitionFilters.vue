<script setup lang="ts">
import { SearchInput, SegmentedControl, type SegmentOption, Select, Tooltip } from "@tracepilot/ui";
import { USAGE_RANGES, type UsageRange } from "@/utils/usage/range";

defineProps<{
  scope: string;
  scopes: SegmentOption[];
  range: UsageRange;
  sort: string;
  sorts: { value: string; label: string }[];
  search: string;
  noun: string;
  flags: { value: string; label: string; title: string; count: number }[];
  selectedFlags: ReadonlySet<string>;
}>();
defineEmits<{
  "update:scope": [value: string];
  "update:range": [value: UsageRange];
  "update:sort": [value: string];
  "update:search": [value: string];
  toggleFlag: [value: string];
  clear: [];
}>();
</script>

<template>
  <div class="filter-row">
    <SegmentedControl
      class="filter-row__scope"
      :model-value="scope"
      :options="scopes"
      aria-label="Definition scope"
      @update:model-value="$emit('update:scope', $event)"
    />
    <SegmentedControl
      :model-value="range"
      :options="[...USAGE_RANGES]"
      aria-label="Usage range"
      @update:model-value="$emit('update:range', $event as UsageRange)"
    />
    <Select
      :model-value="sort"
      :options="sorts"
      size="sm"
      :aria-label="`Sort ${noun}`"
      @update:model-value="$emit('update:sort', $event)"
    />
    <SearchInput
      :model-value="search"
      class="filter-row__search"
      :placeholder="`Search ${noun}…`"
      @update:model-value="$emit('update:search', $event)"
    />
  </div>
  <div v-if="flags.length || selectedFlags.size || search || scope !== 'all'" class="flag-row">
    <Tooltip v-for="flag in flags" :key="flag.value" :text="flag.title" position="bottom">
      <button
        type="button"
        class="flag-chip"
        :class="{ 'flag-chip--active': selectedFlags.has(flag.value) }"
        :aria-pressed="selectedFlags.has(flag.value)"
        @click="$emit('toggleFlag', flag.value)"
      >
        {{ flag.label }} <span class="flag-chip__count">{{ flag.count }}</span>
      </button>
    </Tooltip>
    <button
      v-if="selectedFlags.size || search || scope !== 'all'"
      type="button"
      class="flag-chip flag-chip--clear"
      @click="$emit('clear')"
    >Clear filters</button>
  </div>
</template>
