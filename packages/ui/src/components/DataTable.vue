<script setup lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-vue-next";

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  class?: string;
  sortable?: boolean;
}

defineProps<{
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
  sortKey?: string | null;
  sortDirection?: "ascending" | "descending";
}>();

defineEmits<{ sort: [key: string] }>();
</script>

<template>
  <div class="data-table-wrapper" style="border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden;">
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :aria-sort="col.sortable ? (sortKey === col.key ? sortDirection : 'none') : undefined"
            :class="[
              col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
              col.class || '',
            ]"
          >
            <button
              v-if="col.sortable"
              type="button"
              class="data-table-sort"
              :class="{ 'data-table-sort--active': sortKey === col.key }"
              :style="{ justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start' }"
              :aria-label="`Sort by ${col.label}`"
              @click="$emit('sort', col.key)"
            >
              {{ col.label }}
              <ArrowUp v-if="sortKey === col.key && sortDirection === 'ascending'" :size="12" aria-hidden="true" />
              <ArrowDown v-else-if="sortKey === col.key && sortDirection === 'descending'" :size="12" aria-hidden="true" />
              <ArrowUpDown v-else :size="12" aria-hidden="true" />
            </button>
            <template v-else>{{ col.label }}</template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, idx) in rows"
          :key="idx"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            :class="[
              col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '',
              col.class || '',
            ]"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] ?? "" }}
            </slot>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length" class="px-5 py-8 text-center" style="color: var(--text-secondary);">
            {{ emptyMessage || "No data." }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.data-table-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-align: inherit;
  cursor: pointer;
}
.data-table-sort svg { flex-shrink: 0; }
.data-table-sort:hover, .data-table-sort--active { color: var(--accent-fg); }
.data-table-sort:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 4px; }
</style>
