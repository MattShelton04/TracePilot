<script setup lang="ts">
/**
 * SqliteTableView — renders a single SQLite table's data + schema.
 *
 * Features:
 *  - Data / Schema tab toggle (column metadata + indexes).
 *  - Always renders column headers so the table structure is visible even
 *    when the table has zero rows (empty-state is a single spanning row).
 *  - Resizable columns via a drag handle on each `<th>`'s right edge.
 *    Widths are tracked per-column in memory and survive table switches
 *    while the component is mounted.
 *  - Click a truncated cell to open a modal showing the full value with a
 *    "Copy" action.
 */
import type { SessionDbTable } from "@tracepilot/types";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useClipboard } from "../composables/useClipboard";
import ModalDialog from "./ModalDialog.vue";

export type SqliteViewMode = "data" | "schema";

const props = defineProps<{
  table: SessionDbTable;
}>();

/**
 * View mode (Data/Schema) is a v-model so the parent can render the
 * segmented-control toggle alongside the table-tabs strip instead of
 * duplicating a second header row inside this component.
 */
const viewMode = defineModel<SqliteViewMode>("viewMode", { default: "data" });

// ── Column widths ────────────────────────────────────────────────────
// Per-table width map (pixel values). Kept across tab-switches via the
// parent component's v-for key (table.name). localStorage persistence is
// intentionally out of scope — in-memory is sufficient for the session.
const DEFAULT_WIDTH = 180;
const MIN_WIDTH = 48;
const MAX_WIDTH = 4096;
const viewId = useId();
const columnWidths = ref<Record<string, number[]>>({});

const widths = computed(() => {
  const existing = columnWidths.value[props.table.name];
  if (existing && existing.length === props.table.columns.length) return existing;
  return props.table.columns.map(() => DEFAULT_WIDTH);
});

const totalWidth = computed(() => widths.value.reduce((sum, w) => sum + w, 0));

watch(
  () => props.table.name,
  (name) => {
    if (!columnWidths.value[name]) {
      columnWidths.value[name] = props.table.columns.map(() => DEFAULT_WIDTH);
    }
  },
  { immediate: true },
);

// ── Resize drag state ────────────────────────────────────────────────
let dragIndex = -1;
let dragStartX = 0;
let dragStartWidth = 0;
let previousCursor = "";
let previousUserSelect = "";

function setColumnWidth(idx: number, width: number) {
  const next = [...widths.value];
  next[idx] = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
  columnWidths.value = { ...columnWidths.value, [props.table.name]: next };
}

function onResizeKeydown(idx: number, event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const current = widths.value[idx] ?? DEFAULT_WIDTH;
  const step = event.shiftKey ? 64 : 16;
  const next = {
    ArrowLeft: current - step,
    ArrowRight: current + step,
    Home: MIN_WIDTH,
    End: MAX_WIDTH,
    Enter: DEFAULT_WIDTH,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  setColumnWidth(idx, next);
}

function onResizeStart(idx: number, e: MouseEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  onResizeEnd();
  dragIndex = idx;
  dragStartX = e.clientX;
  dragStartWidth = widths.value[idx] ?? DEFAULT_WIDTH;
  previousCursor = document.body.style.cursor;
  previousUserSelect = document.body.style.userSelect;
  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup", onResizeEnd);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function onResizeMove(e: MouseEvent) {
  if (dragIndex < 0) return;
  setColumnWidth(dragIndex, dragStartWidth + e.clientX - dragStartX);
}

function onResizeEnd() {
  if (dragIndex < 0) return;
  dragIndex = -1;
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup", onResizeEnd);
  document.body.style.cursor = previousCursor;
  document.body.style.userSelect = previousUserSelect;
}

watch(() => [props.table.name, viewMode.value, props.table.columns.length], onResizeEnd);
onBeforeUnmount(onResizeEnd);

// One data-cell tab stop; the native table remains available to reading commands.
const dataWrap = ref<HTMLElement | null>(null);
const activeCell = ref({ row: 0, column: 0 });
watch(
  () => [props.table.name, props.table.rows.length, props.table.columns.length],
  () => {
    activeCell.value = {
      row: Math.min(activeCell.value.row, Math.max(0, props.table.rows.length - 1)),
      column: Math.min(activeCell.value.column, Math.max(0, props.table.columns.length - 1)),
    };
  },
);

function onCellKeydown(row: number, column: number, event: KeyboardEvent) {
  if (event.isComposing || event.altKey) return;
  const wholeTable = event.ctrlKey || event.metaKey;
  if (wholeTable && event.key !== "Home" && event.key !== "End") return;
  let nextRow = row;
  let nextColumn = column;
  switch (event.key) {
    case "ArrowLeft":
      nextColumn--;
      break;
    case "ArrowRight":
      nextColumn++;
      break;
    case "ArrowUp":
      nextRow--;
      break;
    case "ArrowDown":
      nextRow++;
      break;
    case "Home":
      nextColumn = 0;
      if (wholeTable) nextRow = 0;
      break;
    case "End":
      nextColumn = props.table.columns.length - 1;
      if (wholeTable) nextRow = props.table.rows.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  nextRow = Math.max(0, Math.min(props.table.rows.length - 1, nextRow));
  nextColumn = Math.max(0, Math.min(props.table.columns.length - 1, nextColumn));
  dataWrap.value
    ?.querySelector<HTMLButtonElement>(`[data-row="${nextRow}"][data-column="${nextColumn}"]`)
    ?.focus();
}

// ── Cell expand modal ────────────────────────────────────────────────
const expandedCell = ref<{ column: string; value: string | number | null } | null>(null);
const { copy: copyCell, copied: cellCopied } = useClipboard();

function openCell(columnIdx: number, value: string | number | null, event: MouseEvent) {
  (event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
  expandedCell.value = { column: props.table.columns[columnIdx] ?? "", value };
}

function closeCell() {
  expandedCell.value = null;
}
watch(() => props.table.name, closeCell);

const expandedValueText = computed(() => {
  const v = expandedCell.value?.value;
  if (v === null || v === undefined) return "NULL";
  return typeof v === "string" ? v : String(v);
});

function copyExpanded() {
  if (expandedCell.value) copyCell(expandedValueText.value);
}

// ── Schema derived values ────────────────────────────────────────────
const hasSchema = computed(
  () => props.table.columnInfo !== undefined && props.table.columnInfo.length > 0,
);

// If the current view is "schema" but the newly-selected table has no schema
// metadata (shouldn't normally happen, but be defensive), fall back to data.
watch(
  () => [hasSchema.value, viewMode.value] as const,
  ([has, mode]) => {
    if (!has && mode === "schema") viewMode.value = "data";
  },
);
</script>

<template>
  <div class="stv">
    <span :id="`${viewId}-cell-help`" class="stv__sr-only">
      Arrow keys move between cells. Home and End move to the first and last column.
      Ctrl or Cmd with Home and End moves to the first and last cell in the table.
      Enter or Space opens the full value. Tab leaves the cells.
    </span>
    <span :id="`${viewId}-resize-help`" class="stv__sr-only">
      Left and Right arrows resize by 16 pixels, or 64 with Shift.
      Home sets the minimum width of 48 pixels; End sets the maximum of 4096 pixels.
      Enter resets to 180 pixels.
    </span>
    <!-- Data view -->
    <div v-if="viewMode === 'data'" ref="dataWrap" class="stv__data-wrap">
      <table :id="`${viewId}-table`" class="stv__table" :style="{ width: `max(${totalWidth}px, 100%)` }">
        <colgroup>
          <col v-for="(_col, idx) in table.columns" :key="idx" :style="{ width: `${widths[idx]}px` }" />
        </colgroup>
        <thead>
          <tr>
            <th v-for="(col, idx) in table.columns" :key="col" class="stv__th">
              <span class="stv__th-label">{{ col }}</span>
              <span
                class="stv__th-handle"
                role="separator"
                tabindex="0"
                aria-orientation="vertical"
                :aria-label="`Resize column ${col}`"
                :aria-controls="`${viewId}-table`"
                :aria-describedby="`${viewId}-resize-help`"
                :aria-valuemin="MIN_WIDTH"
                :aria-valuemax="MAX_WIDTH"
                :aria-valuenow="widths[idx]"
                :aria-valuetext="`${widths[idx]} pixels`"
                @mousedown="onResizeStart(idx, $event)"
                @keydown="onResizeKeydown(idx, $event)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="table.rows.length === 0">
            <td :colspan="Math.max(1, table.columns.length)" class="stv__empty-row">
              No rows in <strong>{{ table.name }}</strong>
            </td>
          </tr>
          <tr
            v-for="(row, rIdx) in table.rows"
            v-else
            :key="rIdx"
            class="stv__tr"
          >
            <td
              v-for="(cell, cIdx) in row"
              :key="cIdx"
              class="stv__td"
            >
              <button
                type="button"
                class="stv__cell-button"
                :data-row="rIdx"
                :data-column="cIdx"
                :tabindex="activeCell.row === rIdx && activeCell.column === cIdx ? 0 : -1"
                :aria-label="`View ${table.columns[cIdx]}, row ${rIdx + 1}`"
                :aria-describedby="`${viewId}-value-${rIdx}-${cIdx} ${viewId}-cell-help`"
                :title="cell === null ? 'NULL' : String(cell)"
                @focus="activeCell = { row: rIdx, column: cIdx }"
                @keydown="onCellKeydown(rIdx, cIdx, $event)"
                @click="openCell(cIdx, cell, $event)"
              >
                <span :id="`${viewId}-value-${rIdx}-${cIdx}`" :class="{ 'stv__null': cell === null, 'stv__sr-only': cell === '' }">
                  {{ cell === null ? 'NULL' : cell === '' ? 'Empty string' : cell }}
                </span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Schema view -->
    <div v-else class="stv__schema-wrap">
      <section class="stv__schema-section">
        <h4 class="stv__schema-title">Columns</h4>
        <table class="stv__schema-table">
          <thead>
            <tr>
              <th class="stv__th">Name</th>
              <th class="stv__th">Type</th>
              <th class="stv__th">Nullable</th>
              <th class="stv__th">PK</th>
              <th class="stv__th">Default</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!table.columnInfo || table.columnInfo.length === 0">
              <td colspan="5" class="stv__empty-row">No column metadata available.</td>
            </tr>
            <tr v-for="col in table.columnInfo ?? []" v-else :key="col.name" class="stv__tr">
              <td class="stv__td stv__td--name">{{ col.name }}</td>
              <td class="stv__td">{{ col.typeName || "—" }}</td>
              <td class="stv__td">{{ col.notnull ? "NOT NULL" : "NULL" }}</td>
              <td class="stv__td">{{ col.pk > 0 ? (col.pk === 1 ? "PK" : `PK${col.pk}`) : "" }}</td>
              <td class="stv__td">
                <span v-if="col.defaultValue === null" class="stv__null">—</span>
                <span v-else>{{ col.defaultValue }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="stv__schema-section">
        <h4 class="stv__schema-title">Indexes</h4>
        <table class="stv__schema-table">
          <thead>
            <tr>
              <th class="stv__th">Name</th>
              <th class="stv__th">Unique</th>
              <th class="stv__th">Columns</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!table.indexes || table.indexes.length === 0">
              <td colspan="3" class="stv__empty-row">No indexes on this table.</td>
            </tr>
            <tr v-for="idx in table.indexes ?? []" v-else :key="idx.name" class="stv__tr">
              <td class="stv__td stv__td--name">{{ idx.name }}</td>
              <td class="stv__td">{{ idx.unique ? "Yes" : "No" }}</td>
              <td class="stv__td">{{ idx.columns.join(", ") }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Cell value modal -->
    <ModalDialog
      :visible="expandedCell !== null"
      :title="expandedCell?.column ?? ''"
      @update:visible="(v) => !v && closeCell()"
    >
      <div class="stv__cell-body">
        <pre class="stv__cell-value">{{ expandedValueText }}</pre>
      </div>
      <template #footer>
        <button
          class="stv__copy-btn"
          :class="{ 'stv__copy-btn--copied': cellCopied }"
          @click="copyExpanded"
        >
          {{ cellCopied ? "Copied!" : "Copy" }}
        </button>
        <button class="stv__close-btn" @click="closeCell">Close</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.stv {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.stv__data-wrap,
.stv__schema-wrap {
  /* Horizontal-only scroll so the scrollbar sits directly below the table
     rows, not pinned to the bottom of the pane. Vertical scroll is owned
     by the parent (.fcv__db-content), so tall tables still scroll. */
  overflow-x: auto;
  overflow-y: visible;
  width: 100%;
}

.stv__schema-wrap {
  padding: 12px 16px 16px;
}

.stv__schema-section + .stv__schema-section {
  margin-top: 16px;
}

.stv__schema-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  margin: 0 0 6px;
}

.stv__table {
  /* Table width is set inline to `max(totalWidthPx, 100%)` so the grid fills
     the pane when columns are narrow but grows (and horizontally scrolls) when
     the user resizes a column wider than the container. With `table-layout:
     fixed`, `min-width: 100%` alone would cause the browser to redistribute
     surplus width across columns and silently swallow resizes. */
  border-collapse: collapse;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  table-layout: fixed;
}

.stv__schema-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
  font-family: var(--font-mono);
}

.stv__th {
  position: sticky;
  top: 0;
  padding: 7px 10px;
  text-align: left;
  font-weight: 600;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-secondary);
  white-space: nowrap;
  z-index: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stv__th-label {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.stv__th-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  background: transparent;
  transition: background var(--transition-fast);
}

.stv__th-handle:hover,
.stv__th-handle:active {
  background: var(--accent-fg);
  opacity: 0.4;
}

.stv__tr:nth-child(even) {
  background: var(--canvas-subtle);
}

/* Hover + click affordances only make sense in the data view, where rows are
   real records and cells open the detail modal on click. The schema view uses
   the same .stv__tr / .stv__td classes for consistent spacing but its cells
   are read-only metadata, so scope these rules to .stv__data-wrap. */
.stv__data-wrap .stv__tr:hover {
  background: var(--neutral-muted);
}

.stv__td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: top;
  color: var(--text-primary);
}

.stv__td--name {
  font-weight: 500;
}

.stv__data-wrap .stv__td {
  padding: 0;
}

.stv__cell-button {
  display: block;
  width: 100%;
  min-height: 24px;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.stv__cell-button:hover {
  background: var(--accent-muted, var(--neutral-muted));
}

.stv__cell-button:focus-visible,
.stv__th-handle:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}

.stv__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.stv__null {
  color: var(--text-tertiary);
  font-style: italic;
}

.stv__empty-row {
  padding: 24px 16px;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-family: var(--font-sans, inherit);
  cursor: default;
  border-bottom: 1px solid var(--border-muted);
}

.stv__empty-row:hover {
  background: transparent;
}

/* Cell expand modal */
.stv__cell-body {
  max-height: 60vh;
  overflow: auto;
}

.stv__cell-value {
  margin: 0;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--canvas-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.stv__copy-btn,
.stv__close-btn {
  padding: 6px 12px;
  font-size: 0.8125rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.stv__copy-btn:hover,
.stv__close-btn:hover {
  background: var(--neutral-muted);
}

.stv__copy-btn--copied {
  color: var(--success-fg, #2da44e);
  border-color: var(--success-fg, #2da44e);
}
</style>
