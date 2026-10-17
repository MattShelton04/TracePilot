<script setup lang="ts">
import { type SearchContentType, type SessionSource, sourceLabel } from "@tracepilot/types";
import type { ContentTypeStyle } from "@tracepilot/ui";
import { computed } from "vue";
import { PROJECT_FILTER_PREFIX, repositoryFilterLabel } from "@/stores/sessions/filtering";
import { normalizeDateValue } from "@/utils/dateValidation";

const props = defineProps<{
  activeContentTypeChips: { type: SearchContentType; mode: "include" | "exclude" }[];
  repository: string | null;
  toolName: string | null;
  sessionId: string | null;
  source?: SessionSource | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  sessionDisplayName: string | null;
  activeFilterCount: number;
  contentTypeConfig: Record<string, ContentTypeStyle>;
}>();

const emit = defineEmits<{
  "remove-content-type": [type: SearchContentType];
  "clear-repository": [];
  "clear-tool-name": [];
  "clear-source": [];
  "clear-session-id": [];
  "clear-date-range": [];
  "clear-all": [];
}>();

// A folder-only project reads as the session list's Folders group shows it.
const repositoryChip = computed(() => {
  const repository = props.repository;
  if (!repository) return null;
  const kind = repository.startsWith(PROJECT_FILTER_PREFIX) ? "Folder" : "Repo";
  return `${kind}: ${repositoryFilterLabel(repository)}`;
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatFilterDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // A bare YYYY-MM-DD parses as UTC midnight; show that calendar day as written.
    timeZone: DATE_ONLY.test(value) ? "UTC" : undefined,
  });
}

const dateRangeLabel = computed(() => {
  const from = normalizeDateValue(props.dateFrom ?? null);
  const to = normalizeDateValue(props.dateTo ?? null);
  if (from && to) return `${formatFilterDate(from)} – ${formatFilterDate(to)}`;
  if (from) return `Since ${formatFilterDate(from)}`;
  if (to) return `Until ${formatFilterDate(to)}`;
  return null;
});
</script>

<template>
  <div v-if="activeContentTypeChips.length > 0 || repository || toolName || sessionId || source || dateRangeLabel" class="active-filters-bar">
    <span class="active-filters-label">Active filters:</span>
    <div class="active-filter-chips">
      <span
        v-for="chip in activeContentTypeChips"
        :key="`ct-${chip.mode}-${chip.type}`"
        class="filter-chip"
        :class="chip.mode === 'exclude' ? 'filter-chip-exclude' : 'filter-chip-include'"
      >
        <span
          class="filter-chip-dot"
          :style="{ background: contentTypeConfig[chip.type]?.color }"
        />
        <span v-if="chip.mode === 'exclude'" class="filter-chip-prefix">NOT</span>
        {{ contentTypeConfig[chip.type]?.label ?? chip.type }}
        <button class="filter-chip-remove" @click="$emit('remove-content-type', chip.type)" aria-label="Remove filter">×</button>
      </span>
      <span v-if="repository" class="filter-chip filter-chip-neutral">
        {{ repositoryChip }}
        <button class="filter-chip-remove" @click="$emit('clear-repository')" aria-label="Remove filter">×</button>
      </span>
      <span v-if="toolName" class="filter-chip filter-chip-neutral">
        Tool: {{ toolName }}
        <button class="filter-chip-remove" @click="$emit('clear-tool-name')" aria-label="Remove filter">×</button>
      </span>
      <span v-if="source" class="filter-chip filter-chip-neutral" data-testid="search-source-chip">
        Source: {{ sourceLabel(source) }}
        <button class="filter-chip-remove" @click="$emit('clear-source')" aria-label="Remove filter">×</button>
      </span>
      <span v-if="dateRangeLabel" class="filter-chip filter-chip-neutral" data-testid="search-date-chip">
        Date: {{ dateRangeLabel }}
        <button class="filter-chip-remove" @click="$emit('clear-date-range')" aria-label="Remove filter">×</button>
      </span>
      <span v-if="sessionId" class="filter-chip filter-chip-include">
        Session: {{ sessionDisplayName }}
        <button class="filter-chip-remove" @click="$emit('clear-session-id')" aria-label="Remove filter">×</button>
      </span>
      <button v-if="activeFilterCount > 1" class="filter-chip-clear-all" @click="$emit('clear-all')">
        Clear all
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Active filters bar ──────────────────────────────────── */
.active-filters-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--canvas-default);
  border-bottom: 1px solid var(--border-default);
  font-size: 0.8125rem;
}

.active-filters-label {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.active-filter-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 10px;
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.filter-chip-include {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  border: 1px solid var(--border-muted);
}

.filter-chip-exclude {
  background: var(--danger-subtle);
  color: var(--danger-fg);
  border: 1px solid var(--danger-muted);
  opacity: 0.9;
}

.filter-chip-neutral {
  background: var(--canvas-overlay);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.filter-chip-prefix {
  font-weight: 700;
  font-size: 0.6875rem;
  letter-spacing: 0.02em;
}

.filter-chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.filter-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  opacity: 0.6;
  transition: opacity var(--transition-fast), background var(--transition-fast);
}

.filter-chip-remove:hover {
  opacity: 1;
  background: var(--state-hover-overlay);
}

.filter-chip-clear-all {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: inherit;
  transition: color var(--transition-fast);
}

.filter-chip-clear-all:hover {
  color: var(--accent-fg);
}
</style>
