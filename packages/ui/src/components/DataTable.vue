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
  <div class="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
    <table class="w-full text-sm">
      <thead>
        <tr class="bg-[var(--color-canvas-subtle)] text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
          <th
            v-for="col in columns"
            :key="col.key"
            class="px-5 py-3 font-medium"
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
          class="border-t border-[var(--color-border-muted)] hover:bg-[var(--color-canvas-subtle)] transition-colors"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="px-5 py-2.5"
            :class="col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] ?? "" }}
            </slot>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length" class="px-5 py-8 text-center text-[var(--color-text-secondary)]">
            {{ emptyMessage || "No data." }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
