<script setup lang="ts">
import type { SearchContentType } from "@tracepilot/types";
import { ALL_CONTENT_TYPES, CONTENT_TYPE_CONFIG } from "@tracepilot/ui";
import { computed, ref, useId, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSearchStore } from "@/stores/search";
import { useSessionsStore } from "@/stores/sessions";
import {
  groupRepositoryFilterOptions,
  type RepositoryFilterOption,
  repositoryFilterOptionsFor,
} from "@/stores/sessions/filtering";
import { type PresetRange, presetRange } from "@/utils/analyticsFilters";
import { hasMeaningfulDateValue } from "@/utils/dateValidation";
import { searchToolOptionLabel } from "@/utils/toolDisplayName";

const props = defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ clearFilters: []; restoreFocus: [] }>();
const sidebarRef = ref<HTMLElement | null>(null);
const hintId = useId();
const repositoryId = useId();
const toolId = useId();

watch(
  () => props.collapsed,
  (collapsed) => {
    // Move focus before inert/aria-hidden are applied to the collapsing panel.
    if (collapsed && sidebarRef.value?.contains(document.activeElement)) {
      emit("restoreFocus");
    }
  },
);

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
      withData.has(ct) ||
      store.contentTypes.includes(ct) ||
      store.queryContentTypes.includes(ct) ||
      store.excludeContentTypes.includes(ct),
  );
});

/** Content types filtered by the sidebar or by the query's `type:` qualifiers. */
const hasContentTypeFilter = computed(
  () =>
    store.contentTypes.length > 0 ||
    store.excludeContentTypes.length > 0 ||
    store.queryContentTypes.length > 0,
);

const prefs = usePreferencesStore();

// The session list's repository options for the searched source, so folder-only
// projects (most Claude Code sessions) can be picked; the backend resolves each
// value to the sessions the list shows for it. Before the session list loads,
// the index's repositories stand in.
const repositoryGroups = computed(() => {
  const options: RepositoryFilterOption[] =
    sessionsStore.sessions.length > 0
      ? repositoryFilterOptionsFor(sessionsStore.sessions, {
          source: store.effectiveSource,
          hideEmptySessions: prefs.hideEmptySessions,
          selected: store.repository,
        })
      : store.availableRepositories.map((repo) => ({
          value: repo,
          label: repo,
          group: "Repositories",
        }));
  return groupRepositoryFilterOptions(options);
});

// Tools the searched source used (plus the selected one), named as that
// source names them; values stay canonical.
const toolOptions = computed(() => {
  const source = store.effectiveSource;
  return store.availableToolNames
    .filter((tool) => !source || tool.sources.includes(source) || tool.name === store.toolName)
    .map((tool) => ({ value: tool.name, label: searchToolOptionLabel(tool, source) }));
});

// ── Content type tri-state toggle ─────────────────────────────
type FilterState = "off" | "include" | "exclude";

// A typed `type:error` includes Error just as the checkbox does, so it shows checked.
function getContentTypeState(ct: SearchContentType): FilterState {
  if (store.contentTypes.includes(ct) || store.queryContentTypes.includes(ct)) return "include";
  if (store.excludeContentTypes.includes(ct)) return "exclude";
  return "off";
}

function cycleContentType(ct: SearchContentType) {
  const state = getContentTypeState(ct);
  // Moving on from include drops a typed `type:` for it, or the query keeps it included.
  if (state === "include") store.removeQueryContentTypes([ct]);
  // shallowRef: mutate via wholesale replacement so the store watcher fires.
  const nextInclude = store.contentTypes.filter((t) => t !== ct);
  const nextExclude = store.excludeContentTypes.filter((t) => t !== ct);

  if (state === "off") {
    nextInclude.push(ct);
  } else if (state === "include") {
    nextExclude.push(ct);
  }

  store.contentTypes = nextInclude;
  store.excludeContentTypes = nextExclude;
}

function toggleAllContentTypes() {
  if (hasContentTypeFilter.value) {
    store.removeQueryContentTypes(store.queryContentTypes);
    store.contentTypes = [];
    store.excludeContentTypes = [];
  } else {
    store.contentTypes = [...visibleContentTypes.value];
  }
}

function getFacetCount(ct: string): number | null {
  const facets = store.facets?.byContentType;
  if (!facets) return null;
  const entry = facets.find(([type]) => type === ct);
  return entry ? entry[1] : null;
}

// ── Date presets ─────────────────────────────────────────────
// The store's dates (synced with the URL) are the filter, so the highlight is
// derived from them: anything that clears or restores them (Clear all, Escape,
// the date chip, history Back) keeps it true. A preset stays highlighted only
// while the dates it set are still in place; other dates highlight none.
const pickedDatePreset = ref<{ key: string; from: string | null; to: string | null } | null>(null);
const activeDatePreset = computed(() => {
  if (!hasMeaningfulDateValue(store.dateFrom) && !hasMeaningfulDateValue(store.dateTo)) {
    return "all";
  }
  const picked = pickedDatePreset.value;
  return picked?.from === store.dateFrom && picked.to === store.dateTo ? picked.key : null;
});

/**
 * Date presets. The ranged ones are Analytics' presets with the same names and
 * the same dates (`presetRange`: UTC days, "This Month" from the 1st), so a
 * search and the analytics pages cover the same period.
 */
const DATE_PRESETS: { key: "today" | PresetRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "month-to-date", label: "This Month" },
  { key: "90d", label: "90 Days" },
  { key: "all", label: "All Time" },
];

function setDatePreset(preset: (typeof DATE_PRESETS)[number]["key"]) {
  if (preset === "today") {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    store.setDateRange(today.toISOString(), null);
  } else {
    store.setDateRange(presetRange(preset).fromDate ?? null, null);
  }
  pickedDatePreset.value = { key: preset, from: store.dateFrom, to: store.dateTo };
}
</script>

<template>
  <aside
    ref="sidebarRef"
    class="filter-sidebar"
    :class="{ collapsed }"
    :inert="collapsed || undefined"
    :aria-hidden="collapsed"
    aria-label="Search filters"
  >
    <!-- Content Types -->
    <div>
      <div class="filter-group-title">
        Content Type
        <button class="filter-select-all-btn" @click="toggleAllContentTypes">
          {{ hasContentTypeFilter ? 'Clear All' : 'Select All' }}
        </button>
      </div>
      <div class="filter-group">
        <button
          v-for="ct in visibleContentTypes"
          :key="ct"
          type="button"
          class="filter-checkbox-row"
          :aria-label="`${contentTypeConfig[ct].label}: ${getContentTypeState(ct)}`"
          :aria-describedby="hintId"
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
        </button>
      </div>
      <div :id="hintId" class="tri-state-hint">Click or press Enter or Space to cycle: off → include → exclude</div>
    </div>

    <!-- Repository -->
    <div>
      <label :for="repositoryId" class="filter-group-title">Repository</label>
      <select
        :id="repositoryId"
        class="filter-select-full"
        :value="store.repository ?? ''"
        @change="store.repository = ($event.target as HTMLSelectElement).value || null"
      >
        <option value="">All Repositories</option>
        <optgroup v-for="group in repositoryGroups" :key="group.label" :label="group.label">
          <option
            v-for="opt in group.options"
            :key="opt.value"
            :value="opt.value"
            :title="opt.title"
          >
            {{ opt.label }}
          </option>
        </optgroup>
      </select>
    </div>

    <!-- Tool Name -->
    <div v-if="store.availableToolNames.length > 0">
      <label :for="toolId" class="filter-group-title">Tool</label>
      <select
        :id="toolId"
        class="filter-select-full"
        :value="store.toolName ?? ''"
        @change="store.toolName = ($event.target as HTMLSelectElement).value || null"
      >
        <option value="">All Tools</option>
        <option
          v-for="tool in toolOptions"
          :key="tool.value"
          :value="tool.value"
        >
          {{ tool.label }}
        </option>
      </select>
    </div>

    <!-- Date Range -->
    <div>
      <div class="filter-group-title">Date Range</div>
      <div class="date-preset-group">
        <button
          v-for="preset in DATE_PRESETS"
          :key="preset.key"
          class="date-preset-btn"
          :class="{ active: activeDatePreset === preset.key }"
          :aria-pressed="activeDatePreset === preset.key"
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
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}
.filter-checkbox-row:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
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
