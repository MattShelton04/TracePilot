<!--
  @slots
    toolbar    — left side of the toolbar (filter chips, etc). Right side controls
                 (density toggle) are rendered by the component.
    cell-<id>  — per-column cell template, receives `{ row, value }`. Supersedes
                 a column's `render` function when provided.
    head-<id>  — per-column header template, receives `{ column }`.
    row-actions — right-edge actions visible on row hover/focus, receives `{ row }`.
    empty      — override the default empty body
    error      — override the default error body
  Canonical sortable + virtualized data grid. Replaces ad-hoc <table>
  markup. See 02-primitives.md §DataGrid (CC-4).
-->
<script setup lang="ts" generic="TRow extends { id?: string | number }">
import { computed, nextTick, ref, watch } from "vue";
import EmptyState from "./EmptyState.vue";

export type DataGridDensity = "comfortable" | "compact";
export type DataGridSelectionMode = "none" | "single" | "multi";
export type DataGridState = "idle" | "loading" | "empty" | "error";
export type DataGridSortDir = "asc" | "desc";

export interface DataGridSortState {
  columnId: string;
  dir: DataGridSortDir;
}

export interface DataGridColumn<T> {
  id: string;
  label: string;
  /** Path string ("user.name") or accessor function. */
  accessor?: string | ((row: T) => unknown);
  width?: number | string;
  align?: "start" | "end";
  numeric?: boolean;
  sortable?: boolean;
  description?: string;
  render?: (row: T) => unknown;
}

export interface DataGridProps<T> {
  rows: T[];
  columns: DataGridColumn<T>[];
  rowKey?: (row: T) => string | number;
  density?: DataGridDensity;
  sortBy?: DataGridSortState | null;
  selectionMode?: DataGridSelectionMode;
  selected?: Set<string | number>;
  /** Default true when rows.length > 100. */
  /**
   * Force virtualization on / off. Default `"auto"` enables virtualization
   * when `rows.length > 100`.
   */
  virtualize?: boolean | "auto";
  estimatedRowHeight?: number;
  state?: DataGridState;
  emptyTitle?: string;
  emptyHint?: string;
  errorMessage?: string;
  /** Pinned row ids float to the top regardless of sort. */
  pinnedRowIds?: Set<string | number>;
  /** Render the grid body at this fixed height (px). Default 480. */
  bodyHeight?: number;
  loading?: boolean;
  /** Visible-row count in skeleton loading state. Default 8. */
  skeletonRowCount?: number;
}

const props = withDefaults(defineProps<DataGridProps<TRow>>(), {
  density: "comfortable",
  selectionMode: "none",
  state: "idle",
  bodyHeight: 480,
  skeletonRowCount: 8,
  virtualize: "auto",
});

const emit = defineEmits<{
  "sort-change": [sort: DataGridSortState | null];
  "selection-change": [sel: Set<string | number>];
  "row-activate": [
    payload: { row: TRow; modifiers: { meta: boolean; ctrl: boolean; shift: boolean } },
  ];
  retry: [];
}>();

const VIRTUALIZE_THRESHOLD = 100;
const OVERSCAN = 6;

function defaultRowKey(row: TRow, idx: number): string | number {
  if (props.rowKey) return props.rowKey(row);
  if (row && typeof row === "object" && "id" in row && row.id !== undefined) {
    return row.id as string | number;
  }
  return idx;
}

function readAccessor(row: TRow, col: DataGridColumn<TRow>): unknown {
  if (typeof col.accessor === "function") return col.accessor(row);
  if (typeof col.accessor === "string") {
    return col.accessor.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, row as unknown);
  }
  return (row as Record<string, unknown>)[col.id];
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

const internalSort = ref<DataGridSortState | null>(props.sortBy ?? null);
watch(
  () => props.sortBy,
  (s) => {
    internalSort.value = s ?? null;
  },
);

const sortedRows = computed<TRow[]>(() => {
  const sort = internalSort.value;
  const pinned = props.pinnedRowIds ?? new Set<string | number>();
  const indexed = props.rows.map((row, idx) => ({ row, key: defaultRowKey(row, idx) }));
  let result = indexed;
  if (sort) {
    const col = props.columns.find((c) => c.id === sort.columnId);
    if (col) {
      result = [...indexed].sort((a, b) => {
        const va = readAccessor(a.row, col);
        const vb = readAccessor(b.row, col);
        const cmp = compareValues(va, vb);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
  }
  if (pinned.size > 0) {
    const pins = result.filter((x) => pinned.has(x.key));
    const rest = result.filter((x) => !pinned.has(x.key));
    result = [...pins, ...rest];
  }
  return result.map((x) => x.row);
});

const internalDensity = ref<DataGridDensity>(props.density);
watch(
  () => props.density,
  (d) => {
    internalDensity.value = d;
  },
);

const rowHeight = computed(
  () => props.estimatedRowHeight ?? (internalDensity.value === "compact" ? 28 : 32),
);

const shouldVirtualize = computed(() => {
  if (props.virtualize === true) return true;
  if (props.virtualize === false) return false;
  return props.rows.length > VIRTUALIZE_THRESHOLD;
});

const scrollTop = ref(0);
const bodyRef = ref<HTMLDivElement | null>(null);

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLDivElement).scrollTop;
}

const visibleRange = computed(() => {
  if (!shouldVirtualize.value) {
    return { start: 0, end: sortedRows.value.length };
  }
  const total = sortedRows.value.length;
  const visibleCount = Math.ceil(props.bodyHeight / rowHeight.value);
  const start = Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - OVERSCAN);
  const end = Math.min(total, start + visibleCount + OVERSCAN * 2);
  return { start, end };
});

const visibleRows = computed(() =>
  sortedRows.value.slice(visibleRange.value.start, visibleRange.value.end),
);

const padTop = computed(() => visibleRange.value.start * rowHeight.value);
const padBottom = computed(
  () => (sortedRows.value.length - visibleRange.value.end) * rowHeight.value,
);

// ── sort
function cycleSort(col: DataGridColumn<TRow>) {
  if (!col.sortable) return;
  const current = internalSort.value;
  let next: DataGridSortState | null;
  if (!current || current.columnId !== col.id) {
    next = { columnId: col.id, dir: "asc" };
  } else if (current.dir === "asc") {
    next = { columnId: col.id, dir: "desc" };
  } else {
    next = null;
  }
  internalSort.value = next;
  emit("sort-change", next);
}

function ariaSort(col: DataGridColumn<TRow>): "ascending" | "descending" | "none" {
  const s = internalSort.value;
  if (!s || s.columnId !== col.id) return "none";
  return s.dir === "asc" ? "ascending" : "descending";
}

// ── selection
const internalSelected = ref<Set<string | number>>(new Set(props.selected ?? []));
watch(
  () => props.selected,
  (s) => {
    internalSelected.value = new Set(s ?? []);
  },
);

function toggleSelect(key: string | number) {
  if (props.selectionMode === "none") return;
  const next = new Set(internalSelected.value);
  if (props.selectionMode === "single") {
    next.clear();
    next.add(key);
  } else if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  internalSelected.value = next;
  emit("selection-change", next);
}

// ── keyboard
const focusedIndex = ref(-1);

function focusRow(idx: number) {
  if (idx < 0 || idx >= sortedRows.value.length) return;
  focusedIndex.value = idx;
  // scroll into view
  if (shouldVirtualize.value && bodyRef.value) {
    const top = idx * rowHeight.value;
    const bottom = top + rowHeight.value;
    const st = bodyRef.value.scrollTop;
    if (top < st) bodyRef.value.scrollTop = top;
    else if (bottom > st + props.bodyHeight) {
      bodyRef.value.scrollTop = bottom - props.bodyHeight;
    }
  }
  nextTick(() => {
    const el = bodyRef.value?.querySelector<HTMLElement>(`[data-tp-row-idx="${idx}"]`);
    el?.focus({ preventScroll: true });
  });
}

function handleKey(e: KeyboardEvent) {
  const total = sortedRows.value.length;
  if (total === 0) return;
  const cur = focusedIndex.value < 0 ? 0 : focusedIndex.value;
  if (e.key === "ArrowDown" || e.key === "j") {
    e.preventDefault();
    focusRow(Math.min(total - 1, cur + 1));
  } else if (e.key === "ArrowUp" || e.key === "k") {
    e.preventDefault();
    focusRow(Math.max(0, cur - 1));
  } else if (e.key === "Home") {
    e.preventDefault();
    focusRow(0);
  } else if (e.key === "End") {
    e.preventDefault();
    focusRow(total - 1);
  } else if (e.key === "PageDown") {
    e.preventDefault();
    const step = Math.max(1, Math.floor(props.bodyHeight / rowHeight.value));
    focusRow(Math.min(total - 1, cur + step));
  } else if (e.key === "PageUp") {
    e.preventDefault();
    const step = Math.max(1, Math.floor(props.bodyHeight / rowHeight.value));
    focusRow(Math.max(0, cur - step));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const row = sortedRows.value[cur];
    if (row) {
      emit("row-activate", {
        row,
        modifiers: { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey },
      });
    }
  } else if (e.key === " " && props.selectionMode === "multi") {
    e.preventDefault();
    const row = sortedRows.value[cur];
    if (row) toggleSelect(defaultRowKey(row, cur));
  }
}

function onRowClick(row: TRow, idx: number, e: MouseEvent) {
  focusedIndex.value = idx;
  if (props.selectionMode === "single") {
    toggleSelect(defaultRowKey(row, idx));
  }
  emit("row-activate", {
    row,
    modifiers: { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey },
  });
}

function isSelected(row: TRow, idx: number): boolean {
  return internalSelected.value.has(defaultRowKey(row, idx));
}

function setDensity(d: DataGridDensity) {
  internalDensity.value = d;
}

const skeletonIndices = computed(() => Array.from({ length: props.skeletonRowCount }, (_, i) => i));
</script>

<template>
  <div
    data-tp-component="DataGrid"
    class="dg"
    :class="[`dg--${internalDensity}`, { 'dg--virtualized': shouldVirtualize }]"
  >
    <div v-if="$slots.toolbar" class="dg__toolbar">
      <div class="dg__toolbar-left">
        <slot name="toolbar" />
      </div>
      <div class="dg__toolbar-right">
        <div class="dg__density" role="group" aria-label="Density">
          <button
            type="button"
            :class="['dg__density-btn', { 'dg__density-btn--active': internalDensity === 'comfortable' }]"
            :aria-pressed="internalDensity === 'comfortable'"
            aria-label="Comfortable density"
            @click="setDensity('comfortable')"
          >
            Comfy
          </button>
          <button
            type="button"
            :class="['dg__density-btn', { 'dg__density-btn--active': internalDensity === 'compact' }]"
            :aria-pressed="internalDensity === 'compact'"
            aria-label="Compact density"
            @click="setDensity('compact')"
          >
            Compact
          </button>
        </div>
      </div>
    </div>

    <div
      ref="bodyRef"
      class="dg__scroll"
      :style="{ maxHeight: `${bodyHeight}px` }"
      @scroll="onScroll"
      @keydown="handleKey"
    >
      <table role="grid" class="dg__table">
        <thead class="dg__head">
          <tr role="row">
            <th
              v-for="col in columns"
              :key="col.id"
              role="columnheader"
              :aria-sort="ariaSort(col)"
              :class="['dg__head-cell', { 'dg__head-cell--num': col.numeric || col.align === 'end', 'dg__head-cell--sortable': col.sortable }]"
              :style="col.width ? { width: typeof col.width === 'number' ? `${col.width}px` : col.width } : undefined"
              :title="col.description"
              @click="cycleSort(col)"
              @keydown.enter.prevent="cycleSort(col)"
              @keydown.space.prevent="cycleSort(col)"
              :tabindex="col.sortable ? 0 : -1"
            >
              <slot :name="`head-${col.id}`" :column="col">{{ col.label }}</slot>
              <span
                v-if="col.sortable"
                class="dg__sort-ind"
                aria-hidden="true"
              >{{ ariaSort(col) === "ascending" ? "▲" : ariaSort(col) === "descending" ? "▼" : "" }}</span>
            </th>
            <th
              v-if="$slots['row-actions']"
              class="dg__head-cell dg__head-cell--actions"
              aria-label="Actions"
            />
          </tr>
        </thead>
        <tbody>
          <template v-if="state === 'loading' || loading">
            <tr
              v-for="i in skeletonIndices"
              :key="`sk-${i}`"
              class="dg__row dg__row--skeleton"
              aria-hidden="true"
            >
              <td v-for="col in columns" :key="col.id" class="dg__cell">
                <span class="dg__skel" />
              </td>
            </tr>
          </template>
          <template v-else-if="state === 'error'">
            <tr>
              <td :colspan="columns.length + ($slots['row-actions'] ? 1 : 0)" class="dg__state-cell">
                <slot name="error">
                  <div class="dg__error">
                    <span>{{ errorMessage ?? "Something went wrong." }}</span>
                    <button type="button" class="dg__retry" @click="emit('retry')">Retry</button>
                  </div>
                </slot>
              </td>
            </tr>
          </template>
          <template v-else-if="sortedRows.length === 0">
            <tr>
              <td :colspan="columns.length + ($slots['row-actions'] ? 1 : 0)" class="dg__state-cell">
                <slot name="empty">
                  <EmptyState
                    size="sm"
                    :title="emptyTitle ?? 'No data'"
                    :description="emptyHint ?? 'There is nothing to show here yet.'"
                  />
                </slot>
              </td>
            </tr>
          </template>
          <template v-else>
            <tr
              v-if="shouldVirtualize && padTop > 0"
              class="dg__spacer"
              :style="{ height: `${padTop}px` }"
              aria-hidden="true"
            >
              <td :colspan="columns.length + ($slots['row-actions'] ? 1 : 0)" />
            </tr>
            <tr
              v-for="(row, vIdx) in visibleRows"
              :key="defaultRowKey(row, visibleRange.start + vIdx)"
              role="row"
              :data-tp-row-idx="visibleRange.start + vIdx"
              :tabindex="focusedIndex === visibleRange.start + vIdx ? 0 : -1"
              :aria-selected="isSelected(row, visibleRange.start + vIdx) || undefined"
              :class="['dg__row', { 'dg__row--focused': focusedIndex === visibleRange.start + vIdx }]"
              :style="{ height: `${rowHeight}px` }"
              @click="onRowClick(row, visibleRange.start + vIdx, $event)"
              @focus="focusedIndex = visibleRange.start + vIdx"
            >
              <td
                v-for="col in columns"
                :key="col.id"
                role="gridcell"
                :class="['dg__cell', { 'dg__cell--num': col.numeric || col.align === 'end' }]"
              >
                <slot
                  :name="`cell-${col.id}`"
                  :row="row"
                  :value="readAccessor(row, col)"
                >
                  <template v-if="col.render">{{ col.render(row) }}</template>
                  <template v-else>{{ readAccessor(row, col) }}</template>
                </slot>
              </td>
              <td v-if="$slots['row-actions']" class="dg__cell dg__cell--actions">
                <slot name="row-actions" :row="row" />
              </td>
            </tr>
            <tr
              v-if="shouldVirtualize && padBottom > 0"
              class="dg__spacer"
              :style="{ height: `${padBottom}px` }"
              aria-hidden="true"
            >
              <td :colspan="columns.length + ($slots['row-actions'] ? 1 : 0)" />
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dg {
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dg__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  min-height: 40px;
  background: var(--canvas-subtle);
}

.dg__toolbar-left,
.dg__toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dg__density {
  display: inline-flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.dg__density-btn {
  background: transparent;
  border: 0;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.dg__density-btn:hover { color: var(--text-primary); background: var(--surface-tertiary); }
.dg__density-btn--active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.dg__density-btn:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}

.dg__scroll {
  overflow: auto;
}

.dg__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.dg__head {
  background: var(--canvas-subtle);
  position: sticky;
  top: 0;
  z-index: 1;
}

.dg__head-cell {
  padding: 0 12px;
  text-align: start;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  color: var(--text-secondary);
  height: 32px;
  border-bottom: 1px solid var(--border-subtle);
  user-select: none;
}

.dg__head-cell--num {
  text-align: end;
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
}

.dg__head-cell--sortable {
  cursor: pointer;
}
.dg__head-cell--sortable:hover { color: var(--text-primary); }
.dg__head-cell--sortable:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}

.dg__sort-ind {
  margin-left: 4px;
  font-size: 9px;
  color: var(--accent-fg);
}

.dg--compact .dg__head-cell { height: 28px; padding-inline: 8px; }

.dg__row {
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  outline: 0;
}
.dg__row:hover { background: var(--surface-tertiary); }
.dg__row[aria-selected="true"] {
  background: var(--accent-subtle);
  box-shadow: inset 2px 0 0 0 var(--accent-emphasis);
}
.dg__row--focused {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}

.dg__cell {
  padding: 0 12px;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dg__cell--num {
  text-align: end;
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
}

.dg--compact .dg__cell { padding-inline: 8px; font-size: 12px; }

.dg__cell--actions { text-align: end; }

.dg__state-cell {
  padding: 24px;
  text-align: center;
}

.dg__error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  color: var(--danger-fg);
  font-size: 13px;
}

.dg__retry {
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 4px 12px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
}
.dg__retry:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
  border-color: var(--border-emphasis);
}

.dg__skel {
  display: block;
  height: 12px;
  background: var(--surface-tertiary);
  border-radius: var(--radius-sm);
  opacity: 0.5;
}

.dg__spacer td {
  padding: 0;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .dg__row { transition: none; }
}
</style>
