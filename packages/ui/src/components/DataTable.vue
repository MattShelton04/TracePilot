<script setup lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-vue-next";
import { computed } from "vue";

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  class?: string;
  sortable?: boolean;
  /** Header tooltip, for a column whose label needs its definition. */
  title?: string;
}

const props = defineProps<{
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
  sortKey?: string | null;
  sortDirection?: "ascending" | "descending";
  /** The row field that identifies a row; the row index when omitted. */
  rowKey?: string;
  /**
   * Keys of the rows showing their `expanded` slot. Passing it makes rows
   * expandable: a leading chevron column, a click anywhere on the row, and a
   * full-width detail row beneath it. The parent owns the state.
   */
  expandedKeys?: readonly string[];
  /** Accessible name for a row's expand toggle. */
  expandLabel?: (row: Record<string, unknown>) => string;
  /** Classes for a row, e.g. to set apart a pinned total. */
  rowClass?: (row: Record<string, unknown>) => string | Record<string, boolean> | undefined;
}>();

const emit = defineEmits<{ sort: [key: string]; toggle: [key: string] }>();

const expandable = computed(() => props.expandedKeys !== undefined);
const expandedSet = computed(() => new Set(props.expandedKeys ?? []));
const span = computed(() => props.columns.length + (expandable.value ? 1 : 0));

function keyOf(row: Record<string, unknown>, index: number): string {
  return props.rowKey ? String(row[props.rowKey]) : String(index);
}

function onRowClick(row: Record<string, unknown>, index: number): void {
  if (expandable.value) emit("toggle", keyOf(row, index));
}
</script>

<template>
  <div class="data-table-wrapper" style="border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden;">
    <table class="data-table">
      <thead>
        <tr>
          <th v-if="expandable" class="data-table-toggle-col"><span class="sr-only">Details</span></th>
          <th
            v-for="col in columns"
            :key="col.key"
            :aria-sort="col.sortable ? (sortKey === col.key ? sortDirection : 'none') : undefined"
            :class="col.class"
            :style="{ textAlign: col.align ?? 'left' }"
            :title="col.title"
          >
            <button
              v-if="col.sortable"
              type="button"
              class="data-table-sort"
              :class="{ 'data-table-sort--active': sortKey === col.key }"
              :style="{ flexDirection: col.align === 'right' ? 'row-reverse' : 'row', justifyContent: col.align === 'center' ? 'center' : 'flex-start' }"
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
        <template v-for="(row, idx) in rows" :key="keyOf(row, idx)">
          <tr
            :class="[
              rowClass?.(row),
              {
                'data-table-row--expandable': expandable,
                'data-table-row--expanded': expandedSet.has(keyOf(row, idx)),
              },
            ]"
            @click="onRowClick(row, idx)"
          >
            <td v-if="expandable" class="data-table-toggle-col">
              <button
                type="button"
                class="data-table-toggle"
                :aria-expanded="expandedSet.has(keyOf(row, idx))"
                :aria-label="expandLabel?.(row) ?? 'Details'"
                @click.stop="$emit('toggle', keyOf(row, idx))"
              >
                <ChevronRight :size="14" aria-hidden="true" />
              </button>
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              :class="col.class"
              :style="{ textAlign: col.align }"
            >
              <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
                {{ row[col.key] ?? "" }}
              </slot>
            </td>
          </tr>
          <tr v-if="expandable && expandedSet.has(keyOf(row, idx))" class="data-table-expanded">
            <td />
            <td :colspan="columns.length">
              <slot name="expanded" :row="row" />
            </td>
          </tr>
        </template>
        <tr v-if="rows.length === 0">
          <td :colspan="span" class="px-5 py-8 text-center" style="color: var(--text-secondary);">
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

.data-table-toggle-col { width: 32px; }
.data-table-row--expandable { cursor: pointer; }
.data-table-toggle {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
}
.data-table-toggle:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 2px; }
.data-table-toggle svg { transition: transform 0.15s ease; }
.data-table-toggle[aria-expanded="true"] svg { transform: rotate(90deg); }
.data-table-expanded td { background: var(--canvas-subtle); cursor: auto; }
</style>
