<script setup lang="ts">
import type { SearchContentType } from "@tracepilot/types";
import { ALL_CONTENT_TYPES, CONTENT_TYPE_CONFIG } from "@tracepilot/ui";
import { computed } from "vue";
import { useSearchStore } from "@/stores/search";
import { useSessionsStore } from "@/stores/sessions";

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ clearFilters: [] }>();

const store = useSearchStore();
const sessionsStore = useSessionsStore();

const contentTypeConfig = CONTENT_TYPE_CONFIG;

// Only show content types that have data in the index
const visibleContentTypes = computed(() => {
  const stats = store.stats;
  if (!stats?.contentTypeCounts) return ALL_CONTENT_TYPES;
  const withData = new Set(stats.contentTypeCounts.filter(([, n]) => n > 0).map(([t]) => t));
  // Always include types that are currently selected as filters
  return ALL_CONTENT_TYPES.filter(
    (ct) =>
      withData.has(ct) || store.contentTypes.includes(ct) || store.excludeContentTypes.includes(ct),
  );
});

const availableRepositories = computed(() => {
  return store.availableRepositories.length > 0
    ? store.availableRepositories
    : sessionsStore.repositories;
});

// ── Content type tri-state toggle ─────────────────────────────
type FilterState = "off" | "include" | "exclude";

function getContentTypeState(ct: SearchContentType): FilterState {
  if (store.contentTypes.includes(ct)) return "include";
  if (store.excludeContentTypes.includes(ct)) return "exclude";
  return "off";
}

function cycleContentType(ct: SearchContentType) {
  const state = getContentTypeState(ct);
  const incIdx = store.contentTypes.indexOf(ct);
  if (incIdx >= 0) store.contentTypes.splice(incIdx, 1);
  const excIdx = store.excludeContentTypes.indexOf(ct);
  if (excIdx >= 0) store.excludeContentTypes.splice(excIdx, 1);

  if (state === "off") {
    store.contentTypes.push(ct);
  } else if (state === "include") {
    store.excludeContentTypes.push(ct);
  }
}

function toggleAllContentTypes() {
  if (store.contentTypes.length > 0 || store.excludeContentTypes.length > 0) {
    store.contentTypes.splice(0);
    store.excludeContentTypes.splice(0);
  } else {
    store.contentTypes.splice(0, store.contentTypes.length, ...visibleContentTypes.value);
  }
}

function getFacetCount(ct: string): number | null {
  const facets = store.facets?.byContentType;
  if (!facets) return null;
  const entry = facets.find(([type]) => type === ct);
  return entry ? entry[1] : null;
}

// ── Date presets ─────────────────────────────────────────────
const activeDatePreset = defineModel<string>("activeDatePreset", { default: "all" });

function setDatePreset(preset: string) {
  activeDatePreset.value = preset;
  const now = new Date();
  switch (preset) {
    case "today": {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      store.dateFrom = today.toISOString();
      store.dateTo = null;
      break;
    }
    case "week": {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      store.dateFrom = weekAgo.toISOString();
      store.dateTo = null;
      break;
    }
    case "month": {
      const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      store.dateFrom = monthAgo.toISOString();
      store.dateTo = null;
      break;
    }
    case "3months": {
      const threeMonths = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      store.dateFrom = threeMonths.toISOString();
      store.dateTo = null;
      break;
    }
    default:
      store.dateFrom = null;
      store.dateTo = null;
  }
}
</script>

<template>
  <aside class="filter-sidebar" :class="{ collapsed }">
    <!-- Content Types -->
    <div>
      <div class="filter-group-title">
        Content Type
        <button class="filter-select-all-btn" @click="toggleAllContentTypes">
          {{ (store.contentTypes.length > 0 || store.excludeContentTypes.length > 0) ? 'Clear All' : 'Select All' }}
        </button>
      </div>
      <div class="filter-group">
        <div
          v-for="ct in visibleContentTypes"
          :key="ct"
          class="filter-checkbox-row"
          @click="cycleContentType(ct)"
        >
          <span
            class="tri-state-box"
            :class="{
              'tri-include': getContentTypeState(ct) === 'include',
              'tri-exclude': getContentTypeState(ct) === 'exclude',
            }"
          >
            <svg v-if="getContentTypeState(ct) === 'include'" viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2">
              <polyline points="2,6 5,9 10,3" />
            </svg>
            <svg v-else-if="getContentTypeState(ct) === 'exclude'" viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </span>
          <span
            class="filter-color-dot"
            :style="{ background: contentTypeConfig[ct].color }"
          />
          <span class="filter-label" :class="{ 'filter-label-excluded': getContentTypeState(ct) === 'exclude' }">
            {{ contentTypeConfig[ct].label }}
          </span>
          <span v-if="getFacetCount(ct)" class="filter-facet-count">{{ getFacetCount(ct) }}</span>
        </div>
      </div>
      <div class="tri-state-hint">Click to cycle: off → include → exclude</div>
    </div>

    <!-- Repository -->
    <div>
      <div class="filter-group-title">Repository</div>
      <select
        class="filter-select-full"
        :value="store.repository ?? ''"
        @change="store.repository = ($event.target as HTMLSelectElement).value || null"
      >
        <option value="">All Repositories</option>
        <option
          v-for="repo in availableRepositories"
          :key="repo"
          :value="repo"
        >
          {{ repo }}
        </option>
      </select>
    </div>

    <!-- Tool Name -->
    <div v-if="store.availableToolNames.length > 0">
      <div class="filter-group-title">Tool</div>
      <select
        class="filter-select-full"
        :value="store.toolName ?? ''"
        @change="store.toolName = ($event.target as HTMLSelectElement).value || null"
      >
        <option value="">All Tools</option>
        <option
          v-for="tool in store.availableToolNames"
          :key="tool"
          :value="tool"
        >
          {{ tool }}
        </option>
      </select>
    </div>

    <!-- Date Range -->
    <div>
      <div class="filter-group-title">Date Range</div>
      <div class="date-preset-group">
        <button
          v-for="preset in [
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
            { key: 'month', label: 'This Month' },
            { key: '3months', label: 'Last 3 Months' },
            { key: 'all', label: 'All Time' },
          ]"
          :key="preset.key"
          class="date-preset-btn"
          :class="{ active: activeDatePreset === preset.key }"
          @click="setDatePreset(preset.key)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <!-- Clear Filters -->
    <div>
      <button class="filter-clear-btn" @click="emit('clearFilters')">
        ✕ Clear all filters
      </button>
    </div>
  </aside>
</template>

<style scoped>
.filter-sidebar {
  width: 260px;
  min-width: 260px;
  background: var(--canvas-subtle);
  border-right: 1px solid var(--border-default);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  transition: width var(--transition-slow), min-width var(--transition-slow),
    padding var(--transition-slow), opacity var(--transition-slow);
}
.filter-sidebar.collapsed {
  width: 0;
  min-width: 0;
  padding: 0;
  opacity: 0;
  overflow: hidden;
  border-right: none;
}
.filter-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}
.filter-select-all-btn {
  background: none;
  border: none;
  color: var(--text-link);
  font-size: 0.625rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-transform: none;
  letter-spacing: normal;
  padding: 0;
  opacity: 0.8;
  transition: opacity var(--transition-fast);
}
.filter-select-all-btn:hover { opacity: 1; }
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.filter-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}
.filter-checkbox-row:hover { color: var(--text-primary); }
.filter-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.filter-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  flex: 1;
}
.filter-checkbox-row:hover .filter-label { color: var(--text-primary); }
.filter-select-full {
  width: 100%;
  padding: 7px 28px 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2371717a'%3E%3Cpath d='M5 7L0.5 2.5h9z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  transition: border-color var(--transition-fast);
}
.filter-select-full:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
}
.date-preset-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.date-preset-btn {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.date-preset-btn:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
}
.date-preset-btn.active {
  background: var(--accent-subtle);
  border-color: var(--border-accent);
  color: var(--accent-fg);
}
.filter-clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 0;
  background: none;
  border: none;
  color: var(--text-link);
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity var(--transition-fast);
}
.filter-clear-btn:hover { opacity: 1; }

/* ── Tri-state ─────────────────────────────────────────────── */
.tri-state-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  background: var(--canvas-default);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}
.tri-state-box svg { width: 10px; height: 10px; }
.tri-state-box.tri-include {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}
.tri-state-box.tri-exclude {
  background: var(--danger-fg);
  border-color: var(--danger-fg);
}
.filter-label-excluded {
  text-decoration: line-through;
  color: var(--text-tertiary) !important;
  opacity: 0.7;
}
.tri-state-hint {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  margin-top: 6px;
  padding-left: 2px;
}
.filter-facet-count {
  margin-left: auto;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--neutral-subtle);
  padding: 0 5px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}

@media (max-width: 900px) {
  .filter-sidebar { display: none; }
}
</style>
