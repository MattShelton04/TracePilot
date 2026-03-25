<script setup lang="ts">
export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  class?: string;
}

defineProps<{
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
}>();
</script>

<template>
  <div class="data-table-wrapper" style="border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden;">
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :class="[
              col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
              col.class || '',
            ]"
          >
            {{ col.label }}
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
