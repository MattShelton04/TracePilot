<script setup lang="ts">
import type { ContextSourceType, TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PresetDetailSlideover from "@/components/tasks/PresetDetailSlideover.vue";
import { usePresetsStore } from "@/stores/presets";

const store = usePresetsStore();

const showNewPresetModal = ref(false);
const showDeleteConfirm = ref(false);
const showEditModal = ref(false);
const presetToDelete = ref<TaskPreset | null>(null);
const editingPreset = ref<TaskPreset | null>(null);
const creating = ref(false);
const saving = ref(false);

const router = useRouter();
const viewMode = ref<"grid" | "list">("grid");
const categoryFilter = ref<"all" | "builtin" | "custom">("all");
const sortBy = ref<"name" | "newest" | "most-used">("name");
const detailPreset = ref<TaskPreset | null>(null);
const showDetail = ref(false);

// New preset form
const newPresetName = ref("");
const newPresetDesc = ref("");
const newPresetTags = ref("");

const presetId = computed(() =>
  newPresetName.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
);

onMounted(() => {
  store.loadPresets();
});

const categoryFilteredPresets = computed(() => {
  const list = store.filteredPresets;
  if (categoryFilter.value === "builtin") {
    return list.filter((p) => p.builtin);
  }
  if (categoryFilter.value === "custom") {
    return list.filter((p) => !p.builtin);
  }
  return list;
});

const displayPresets = computed(() => {
  const list = [...categoryFilteredPresets.value];
  switch (sortBy.value) {
    case "newest":
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "most-used":
      return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    default:
      return list;
  }
});

function contextSourceCount(preset: TaskPreset): number {
  return preset.context?.sources?.length ?? 0;
}

function variableCount(preset: TaskPreset): number {
  return preset.prompt?.variables?.length ?? 0;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function displayTags(tags: string[]): { visible: string[]; extra: number } {
  if (tags.length <= 3) return { visible: tags, extra: 0 };
  return { visible: tags.slice(0, 3), extra: tags.length - 3 };
}

function taskTypeColorClass(taskType: string): string {
  const classes: Record<string, string> = {
    analysis: "type-color-accent",
    review: "type-color-success",
    generation: "type-color-warning",
    health: "type-color-danger",
    summary: "type-color-info",
  };
  const key = taskType.toLowerCase();
  for (const [k, v] of Object.entries(classes)) {
    if (key.includes(k)) return v;
  }
  return "type-color-accent";
}

function infoLine(preset: TaskPreset): string {
  const sources = contextSourceCount(preset);
  const vars = variableCount(preset);
  const parts: string[] = [];
  if (sources > 0) parts.push(`${sources} source${sources !== 1 ? "s" : ""}`);
  if (vars > 0) parts.push(`${vars} var${vars !== 1 ? "s" : ""}`);
  return parts.join(" · ") || "No sources or vars";
}

function runTask(preset: TaskPreset) {
  router.push({ path: "/tasks/new", query: { presetId: preset.id } });
}

async function duplicatePreset(preset: TaskPreset) {
  const now = new Date().toISOString();
  const copy: TaskPreset = {
    ...JSON.parse(JSON.stringify(preset)),
    id: `${preset.id}-copy-${Date.now()}`,
    name: `${preset.name} (Copy)`,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await store.savePreset(copy);
}

function openDetail(preset: TaskPreset) {
  detailPreset.value = preset;
  showDetail.value = true;
}

function closeDetail() {
  showDetail.value = false;
  detailPreset.value = null;
}

async function togglePreset(preset: TaskPreset) {
  await store.savePreset({ ...preset, enabled: !preset.enabled });
}

function confirmDelete(preset: TaskPreset) {
  presetToDelete.value = preset;
  showDeleteConfirm.value = true;
}

async function handleDelete() {
  if (!presetToDelete.value) return;
  const ok = await store.deletePreset(presetToDelete.value.id);
  if (ok) {
    showDeleteConfirm.value = false;
    presetToDelete.value = null;
  }
}

function cancelDelete() {
  showDeleteConfirm.value = false;
  presetToDelete.value = null;
}

async function handleCreatePreset() {
  if (!newPresetName.value.trim() || !presetId.value) return;

  // Guard against overwriting existing presets
  const existing = store.presets.find((p) => p.id === presetId.value);
  if (existing) {
    store.error = `A preset with ID "${presetId.value}" already exists.`;
    return;
  }

  creating.value = true;

  const now = new Date().toISOString();
  const tags = newPresetTags.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const preset: TaskPreset = {
    id: presetId.value,
    name: newPresetName.value.trim(),
    taskType: presetId.value,
    description: newPresetDesc.value.trim(),
    version: 1,
    prompt: { system: "", user: "", variables: [] },
    context: { sources: [], maxChars: 8000, format: "markdown" },
    output: { schema: {}, format: "markdown", validation: "warn" },
    execution: {
      modelOverride: null,
      timeoutSeconds: 120,
      maxRetries: 2,
      priority: "normal",
    },
    tags,
    enabled: true,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };

  const ok = await store.savePreset(preset);
  creating.value = false;
  if (ok) {
    showNewPresetModal.value = false;
    newPresetName.value = "";
    newPresetDesc.value = "";
    newPresetTags.value = "";
  }
}

function openNewPresetModal() {
  store.error = null;
  showNewPresetModal.value = true;
}

function openEditModal(preset: TaskPreset) {
  store.error = null;
  editingPreset.value = JSON.parse(JSON.stringify(preset));
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingPreset.value = null;
}

async function handleSaveEdit() {
  if (!editingPreset.value) return;
  saving.value = true;
  editingPreset.value.updatedAt = new Date().toISOString();
  const ok = await store.savePreset(editingPreset.value);
  saving.value = false;
  if (ok) closeEditModal();
}

// ─── Context source helpers for edit modal ───────────────────────
interface SourceConfigField {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "select";
  default: unknown;
  hint: string;
  options?: string[];
}

interface SourceTypeInfo {
  value: ContextSourceType;
  label: string;
  description: string;
  requiresSession: boolean;
  configSchema: SourceConfigField[];
}

const SOURCE_TYPES: SourceTypeInfo[] = [
  {
    value: "session_export",
    label: "Session Export",
    description: "Full structured export of a session (conversation, plan, todos, metrics, etc.)",
    requiresSession: true,
    configSchema: [
      {
        key: "sections",
        label: "Sections",
        type: "string",
        default: "conversation,plan,todos,metrics,incidents,health",
        hint: "Comma-separated: conversation, events, todos, plan, checkpoints, metrics, incidents, health",
        options: ["conversation", "events", "todos", "plan", "checkpoints", "metrics", "incidents", "health"],
      },
      { key: "max_bytes", label: "Max bytes", type: "number", default: 50000, hint: "Byte limit for the export output" },
    ],
  },
  {
    value: "session_analytics",
    label: "Session Analytics",
    description: "Aggregate stats from a session (events, turns, repo, model)",
    requiresSession: true,
    configSchema: [],
  },
  {
    value: "session_health",
    label: "Session Health",
    description: "Health scoring data for a session",
    requiresSession: true,
    configSchema: [],
  },
  {
    value: "session_todos",
    label: "Session Todos",
    description: "Plan / todos from a session's plan.md file",
    requiresSession: true,
    configSchema: [],
  },
  {
    value: "recent_sessions",
    label: "Recent Sessions",
    description: "Summary list of recent sessions",
    requiresSession: false,
    configSchema: [
      { key: "max_sessions", label: "Max sessions", type: "number", default: 10, hint: "How many recent sessions to include" },
    ],
  },
  {
    value: "multi_session_digest",
    label: "Multi-Session Digest",
    description: "Combined summary of sessions within a time window (daily/weekly)",
    requiresSession: false,
    configSchema: [
      { key: "window_hours", label: "Window (hours)", type: "number", default: 24, hint: "How many hours back to look (24 = daily, 168 = weekly)" },
      { key: "max_sessions", label: "Max sessions", type: "number", default: 50, hint: "Cap on sessions to include" },
      { key: "include_exports", label: "Include exports", type: "boolean", default: false, hint: "Include brief conversation exports per session (expensive)" },
    ],
  },
];

function getSourceType(typeValue: string): SourceTypeInfo | undefined {
  return SOURCE_TYPES.find((s) => s.value === typeValue);
}

function addContextSource() {
  if (!editingPreset.value) return;
  const id = `src-${Date.now()}`;
  const defaultType = SOURCE_TYPES[0];
  const defaultConfig: Record<string, unknown> = {};
  for (const field of defaultType.configSchema) {
    defaultConfig[field.key] = field.default;
  }
  editingPreset.value.context.sources.push({
    id,
    type: defaultType.value,
    label: null,
    required: false,
    config: defaultConfig,
  });
}

function removeContextSource(idx: number) {
  if (!editingPreset.value) return;
  editingPreset.value.context.sources.splice(idx, 1);
}

/** When source type changes, populate default config from schema. */
function onSourceTypeChange(src: { type: string; config: Record<string, unknown> }) {
  const info = getSourceType(src.type);
  if (!info) return;
  const newConfig: Record<string, unknown> = {};
  for (const field of info.configSchema) {
    newConfig[field.key] = src.config[field.key] ?? field.default;
  }
  // Preserve any custom keys that aren't in the schema
  for (const [k, v] of Object.entries(src.config)) {
    if (!(k in newConfig)) newConfig[k] = v;
  }
  src.config = newConfig;
}

function addConfigKey(src: { config: Record<string, unknown> }) {
  const key = `key_${Object.keys(src.config).length}`;
  src.config[key] = "";
}

function removeConfigKey(src: { config: Record<string, unknown> }, key: string) {
  delete src.config[key];
}

function renameConfigKey(
  src: { config: Record<string, unknown> },
  oldKey: string,
  newKey: string,
) {
  if (oldKey === newKey || !newKey.trim()) return;
  const val = src.config[oldKey];
  delete src.config[oldKey];
  src.config[newKey.trim()] = val;
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Title Row -->
      <div class="page-title-row">
        <h1 class="page-title">
          <span class="title-icon-tile">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              width="16"
              height="16"
            >
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5 6h6M5 8.5h4M5 11h2" />
            </svg>
          </span>
          Task Presets
        </h1>
        <div class="title-actions">
          <button class="btn btn--primary" @click="openNewPresetModal">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              width="14"
              height="14"
            >
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            New Preset
          </button>
        </div>
      </div>

      <!-- Stats Strip -->
      <div class="stats-strip">
        <span class="stat-chip">
          <span class="stat-dot stat-dot--total" />
          {{ store.presets.length }} Total
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--builtin" />
          {{ store.builtinPresets.length }} Builtin
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--custom" />
          {{ store.customPresets.length }} Custom
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--enabled" />
          {{ store.enabledPresets.length }} Enabled
        </span>
      </div>

      <!-- Category Pills -->
      <div class="category-pills">
        <button
          v-for="cat in (['all', 'builtin', 'custom'] as const)"
          :key="cat"
          class="category-pill"
          :class="{ 'category-pill--active': categoryFilter === cat }"
          @click="categoryFilter = cat"
        >
          {{ cat === "all" ? "All" : cat === "builtin" ? "Built-in" : "Custom" }}
        </button>
      </div>

      <!-- Filter Row -->
      <div class="filter-row">
        <div class="search-box">
          <svg
            class="search-icon"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"
            />
          </svg>
          <input
            v-model="store.searchQuery"
            class="search-input"
            type="text"
            placeholder="Search presets…"
            aria-label="Search presets"
          />
        </div>

        <div class="tag-filter">
          <select v-model="store.filterTag" class="tag-select" aria-label="Filter by tag">
            <option value="all">All Tags</option>
            <option v-for="tag in store.allTags" :key="tag" :value="tag">
              {{ tag }}
            </option>
          </select>
        </div>

        <div class="sort-filter">
          <select v-model="sortBy" class="tag-select" aria-label="Sort presets">
            <option value="name">Sort: Name</option>
            <option value="newest">Sort: Newest</option>
            <option value="most-used">Sort: Most Used</option>
          </select>
        </div>

        <div class="filter-spacer" />

        <div class="view-toggle" role="group" aria-label="View mode">
          <button
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--active': viewMode === 'grid' }"
            title="Grid view"
            @click="viewMode = 'grid'"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path
                d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3Zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3ZM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3Zm8 0A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5v-3Z"
              />
            </svg>
          </button>
          <button
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--active': viewMode === 'list' }"
            title="List view"
            @click="viewMode = 'list'"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path
                d="M2 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm3.75-1.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5ZM3 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              />
            </svg>
          </button>
        </div>
      </div>

      <!-- Loading / Error -->
      <div v-if="store.loading" class="state-message">Loading presets…</div>
      <div v-else-if="store.error" class="state-message state-message--error">
        {{ store.error }}
        <button class="btn btn--secondary btn--sm" @click="store.loadPresets()">
          Retry
        </button>
      </div>

      <!-- Preset Views -->
      <template v-else-if="displayPresets.length > 0">
        <!-- Grid View -->
        <div v-if="viewMode === 'grid'" class="preset-grid">
          <div
            v-for="preset in displayPresets"
            :key="preset.id"
            class="preset-card"
            :class="{
              'preset-card--disabled': !preset.enabled,
              'preset-card--builtin': preset.builtin,
            }"
            @click="openDetail(preset)"
          >
            <div class="preset-card__header">
              <div class="preset-card__title-row">
                <h3 class="preset-card__name">{{ preset.name }}</h3>
                <span
                  class="badge badge--type"
                  :class="taskTypeColorClass(preset.taskType)"
                >
                  {{ preset.taskType }}
                </span>
                <span class="badge badge--version">
                  v{{ preset.version ?? 1 }}
                </span>
                <span v-if="preset.builtin" class="badge badge--builtin">
                  builtin
                </span>
              </div>
              <label class="toggle" @click.stop>
                <input
                  type="checkbox"
                  :checked="preset.enabled"
                  @change="togglePreset(preset)"
                />
                <span class="toggle__slider" />
              </label>
            </div>

            <p class="preset-card__desc">
              {{ truncate(preset.description || "No description", 120) }}
            </p>

            <div v-if="preset.tags.length > 0" class="preset-card__tags">
              <span
                v-for="tag in displayTags(preset.tags).visible"
                :key="tag"
                class="tag-pill"
              >
                {{ tag }}
              </span>
              <span v-if="displayTags(preset.tags).extra > 0" class="tag-pill tag-pill--more">
                +{{ displayTags(preset.tags).extra }} more
              </span>
            </div>

            <div class="preset-card__info-line">
              {{ infoLine(preset) }}
            </div>

            <div class="preset-card__meta">
              <span class="meta-item" :title="`${contextSourceCount(preset)} context sources`">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  width="12"
                  height="12"
                >
                  <path d="M2 4h12M2 8h12M2 12h8" />
                </svg>
                {{ contextSourceCount(preset) }} sources
              </span>
              <span class="meta-item" :title="`${variableCount(preset)} variables`">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  width="12"
                  height="12"
                >
                  <path d="M4 2v12M8 4l-4 4 4 4" />
                </svg>
                {{ variableCount(preset) }} vars
              </span>
              <span class="meta-item" :title="preset.updatedAt">
                {{ formatDate(preset.updatedAt) }}
              </span>
            </div>

            <div class="preset-card__actions" @click.stop>
              <button
                class="btn btn--accent btn--sm"
                title="Run task with this preset"
                @click="runTask(preset)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  width="12"
                  height="12"
                >
                  <path d="M4 2l10 6-10 6z" />
                </svg>
                Run
              </button>
              <button
                class="btn btn--ghost btn--sm"
                title="Duplicate preset"
                @click="duplicatePreset(preset)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="13"
                  height="13"
                >
                  <rect x="5" y="5" width="9" height="9" rx="1" />
                  <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
                </svg>
              </button>
              <button
                class="btn btn--ghost btn--sm"
                title="Edit preset"
                @click="openEditModal(preset)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="13"
                  height="13"
                >
                  <path d="M11.5 1.5l3 3L5 14H2v-3z" />
                </svg>
              </button>
              <button
                class="btn btn--ghost btn--sm"
                :disabled="preset.builtin"
                :title="preset.builtin ? 'Builtin presets cannot be deleted' : 'Delete preset'"
                @click="confirmDelete(preset)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="13"
                  height="13"
                >
                  <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                  <path d="M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- List View -->
        <div v-else class="preset-list">
          <div class="preset-list__header">
            <span />
            <span>Name</span>
            <span>Type</span>
            <span>Tags</span>
            <span>Sources</span>
            <span>Updated</span>
            <span>Actions</span>
          </div>
          <div
            v-for="preset in displayPresets"
            :key="preset.id"
            class="preset-list__row"
            :class="{ 'preset-list__row--disabled': !preset.enabled }"
            @click="openDetail(preset)"
          >
            <label class="toggle toggle--sm" @click.stop>
              <input
                type="checkbox"
                :checked="preset.enabled"
                @change="togglePreset(preset)"
              />
              <span class="toggle__slider" />
            </label>
            <span class="preset-list__name">
              {{ preset.name }}
              <span v-if="preset.builtin" class="badge badge--builtin badge--inline">
                builtin
              </span>
            </span>
            <span class="preset-list__type">
              <span
                class="badge badge--type badge--sm"
                :class="taskTypeColorClass(preset.taskType)"
              >
                {{ preset.taskType }}
              </span>
            </span>
            <span class="preset-list__tags">
              <span
                v-for="tag in displayTags(preset.tags).visible"
                :key="tag"
                class="tag-pill tag-pill--sm"
              >
                {{ tag }}
              </span>
              <span v-if="displayTags(preset.tags).extra > 0" class="tag-pill tag-pill--sm tag-pill--more">
                +{{ displayTags(preset.tags).extra }}
              </span>
            </span>
            <span class="preset-list__sources">
              {{ contextSourceCount(preset) }}
            </span>
            <span class="preset-list__date">
              {{ formatDate(preset.updatedAt) }}
            </span>
            <span class="preset-list__actions" @click.stop>
              <button
                class="btn btn--accent btn--sm"
                title="Run task"
                @click="runTask(preset)"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
                  <path d="M4 2l10 6-10 6z" />
                </svg>
              </button>
              <button
                class="btn btn--ghost btn--sm"
                title="Edit"
                @click="openEditModal(preset)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  width="12"
                  height="12"
                >
                  <path d="M11.5 1.5l3 3L5 14H2v-3z" />
                </svg>
              </button>
              <button
                class="btn btn--ghost btn--sm"
                :disabled="preset.builtin"
                title="Delete"
                @click="confirmDelete(preset)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  width="12"
                  height="12"
                >
                  <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                  <path d="M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" />
                </svg>
              </button>
            </span>
          </div>
        </div>
      </template>

      <!-- Empty State -->
      <div v-else-if="!store.loading && !store.error" class="empty-state">
        <div class="empty-state__icon">📋</div>
        <h3 class="empty-state__title">No presets found</h3>
        <p class="empty-state__desc">
          {{
            store.searchQuery || store.filterTag !== "all" || categoryFilter !== "all"
              ? "Try a different search term, tag, or category filter"
              : "No presets configured. Create your first preset to get started."
          }}
        </p>
        <div class="empty-state__actions">
          <button class="btn btn--primary" @click="openNewPresetModal">
            Create Preset
          </button>
        </div>
      </div>

      <!-- Delete Confirmation Modal -->
      <div
        v-if="showDeleteConfirm"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Delete preset confirmation"
        @click.self="cancelDelete"
        @keydown.escape="cancelDelete"
      >
        <div class="modal">
          <div class="modal__header">
            <h3 class="modal__title">Delete Preset</h3>
            <button class="modal__close" @click="cancelDelete">✕</button>
          </div>
          <div class="modal__body">
            <p class="modal__confirm-text">
              Are you sure you want to delete
              <strong>{{ presetToDelete?.name }}</strong
              >? This action cannot be undone.
            </p>
          </div>
          <div class="modal__footer">
            <button class="btn btn--secondary" @click="cancelDelete">
              Cancel
            </button>
            <button class="btn btn--danger" @click="handleDelete">
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- New Preset Modal -->
      <div
        v-if="showNewPresetModal"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Create new preset"
        @click.self="showNewPresetModal = false"
        @keydown.escape="showNewPresetModal = false"
      >
        <div class="modal">
          <div class="modal__header">
            <h3 class="modal__title">New Preset</h3>
            <button class="modal__close" @click="showNewPresetModal = false">
              ✕
            </button>
          </div>
          <div class="modal__body">
            <label class="modal__label">Name</label>
            <input
              v-model="newPresetName"
              class="modal__input"
              type="text"
              placeholder="My Analysis Preset"
              @keydown.enter="handleCreatePreset"
            />
            <p
              v-if="newPresetName.length > 0 && !newPresetName.trim()"
              class="modal__validation-hint"
            >
              Name cannot be blank
            </p>

            <label class="modal__label">
              ID
              <span class="modal__optional">(auto-generated)</span>
            </label>
            <input
              class="modal__input modal__input--readonly"
              type="text"
              :value="presetId || '—'"
              readonly
            />

            <label class="modal__label">
              Description
              <span class="modal__optional">(optional)</span>
            </label>
            <textarea
              v-model="newPresetDesc"
              class="modal__textarea"
              rows="3"
              placeholder="What does this preset do?"
            />

            <label class="modal__label">
              Tags
              <span class="modal__optional">(comma-separated)</span>
            </label>
            <input
              v-model="newPresetTags"
              class="modal__input"
              type="text"
              placeholder="analysis, review, health"
            />

            <p class="modal__hint">
              Creates a preset with sensible defaults. You can fully customise
              prompt, context, and output settings later.
            </p>
          </div>
          <div class="modal__footer">
            <button
              class="btn btn--secondary"
              @click="showNewPresetModal = false"
            >
              Cancel
            </button>
            <button
              class="btn btn--primary"
              :disabled="!newPresetName.trim() || !presetId || creating"
              @click="handleCreatePreset"
            >
              {{ creating ? "Creating…" : "Create" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Edit Preset Modal -->
      <div
        v-if="showEditModal && editingPreset"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Edit preset"
        @click.self="closeEditModal"
        @keydown.escape="closeEditModal"
      >
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3 class="modal__title">Edit: {{ editingPreset.name }}</h3>
            <button class="modal__close" @click="closeEditModal">✕</button>
          </div>
          <div class="modal__body edit-body">
            <!-- Basic Info -->
            <div class="edit-section">
              <div class="edit-section__header">
                <span class="edit-section__icon">📋</span>
                <h4 class="edit-section__title">Basic Info</h4>
              </div>
              <div class="edit-section__divider" />
              <div class="edit-grid edit-grid--2col">
                <div class="edit-field">
                  <label class="modal__label">Name</label>
                  <input v-model="editingPreset.name" class="modal__input" type="text" />
                </div>
                <div class="edit-field">
                  <label class="modal__label">Task Type</label>
                  <input
                    v-model="editingPreset.taskType"
                    class="modal__input"
                    type="text"
                  />
                </div>
              </div>
              <div class="edit-field">
                <label class="modal__label">Description</label>
                <textarea
                  v-model="editingPreset.description"
                  class="modal__textarea"
                  rows="2"
                />
              </div>
              <div class="edit-field">
                <label class="modal__label">Tags (comma-separated)</label>
                <input
                  :value="editingPreset.tags.join(', ')"
                  class="modal__input"
                  type="text"
                  @input="editingPreset!.tags = ($event.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean)"
                />
              </div>
            </div>

            <!-- Prompt -->
            <div class="edit-section">
              <div class="edit-section__header">
                <span class="edit-section__icon">💬</span>
                <h4 class="edit-section__title">Prompt</h4>
              </div>
              <div class="edit-section__divider" />
              <div class="edit-field">
                <label class="modal__label">System Prompt</label>
                <textarea
                  v-model="editingPreset.prompt.system"
                  class="modal__textarea modal__textarea--code"
                  rows="6"
                />
              </div>
              <div class="edit-field">
                <label class="modal__label">User Prompt</label>
                <textarea
                  v-model="editingPreset.prompt.user"
                  class="modal__textarea modal__textarea--code"
                  rows="6"
                />
              </div>
            </div>

            <!-- Context -->
            <div class="edit-section">
              <div class="edit-section__header">
                <span class="edit-section__icon">📄</span>
                <h4 class="edit-section__title">Context</h4>
              </div>
              <div class="edit-section__divider" />
              <div class="edit-grid edit-grid--2col">
                <div class="edit-field">
                  <label class="modal__label">Max Characters</label>
                  <input
                    v-model.number="editingPreset.context.maxChars"
                    class="modal__input"
                    type="number"
                    min="0"
                  />
                </div>
                <div class="edit-field">
                  <label class="modal__label">Format</label>
                  <select
                    v-model="editingPreset.context.format"
                    class="modal__input"
                  >
                    <option value="markdown">Markdown</option>
                    <option value="json">JSON</option>
                    <option value="text">Plain Text</option>
                  </select>
                </div>
              </div>

              <!-- Context Sources -->
              <div class="edit-field" style="margin-top: 12px">
                <div class="ctx-sources-header">
                  <label class="modal__label">Context Sources</label>
                  <button class="btn btn--xs btn--ghost" @click="addContextSource">
                    + Add Source
                  </button>
                </div>
                <div
                  v-if="editingPreset.context.sources.length === 0"
                  class="ctx-sources-empty"
                >
                  No context sources configured. Click "Add Source" to add one.
                </div>
                <div
                  v-for="(src, idx) in editingPreset.context.sources"
                  :key="src.id"
                  class="ctx-source-card"
                >
                  <div class="ctx-source-top">
                    <select
                      v-model="src.type"
                      class="modal__input modal__input--sm"
                      @change="onSourceTypeChange(src)"
                    >
                      <option
                        v-for="st in SOURCE_TYPES"
                        :key="st.value"
                        :value="st.value"
                      >
                        {{ st.label }}
                      </option>
                    </select>
                    <input
                      v-model="src.label"
                      class="modal__input modal__input--sm"
                      type="text"
                      placeholder="Label (optional)"
                    />
                    <label class="ctx-source-required">
                      <input v-model="src.required" type="checkbox" />
                      <span>Required</span>
                    </label>
                    <button
                      class="btn btn--xs btn--danger-ghost"
                      title="Remove source"
                      @click="removeContextSource(idx)"
                    >
                      ✕
                    </button>
                  </div>
                  <!-- Source description -->
                  <p v-if="getSourceType(src.type)?.description" class="ctx-source-desc">
                    {{ getSourceType(src.type)!.description }}
                  </p>
                  <p v-if="getSourceType(src.type)?.requiresSession" class="ctx-source-hint">
                    ⚠ Requires a <code>session_id</code> variable in the prompt
                  </p>
                  <!-- Schema-driven config fields -->
                  <div
                    v-if="getSourceType(src.type)?.configSchema?.length"
                    class="ctx-source-config"
                  >
                    <div
                      v-for="field in getSourceType(src.type)!.configSchema"
                      :key="field.key"
                      class="ctx-schema-field"
                    >
                      <label class="ctx-schema-label">
                        {{ field.label }}
                        <span class="ctx-schema-hint">{{ field.hint }}</span>
                      </label>
                      <input
                        v-if="field.type === 'number'"
                        :value="src.config[field.key] ?? field.default"
                        class="modal__input modal__input--xs"
                        type="number"
                        @input="src.config[field.key] = Number(($event.target as HTMLInputElement).value)"
                      />
                      <label v-else-if="field.type === 'boolean'" class="ctx-source-required">
                        <input
                          :checked="Boolean(src.config[field.key] ?? field.default)"
                          type="checkbox"
                          @change="src.config[field.key] = ($event.target as HTMLInputElement).checked"
                        />
                        <span>{{ src.config[field.key] ? 'Enabled' : 'Disabled' }}</span>
                      </label>
                      <input
                        v-else
                        :value="String(src.config[field.key] ?? field.default ?? '')"
                        class="modal__input modal__input--xs"
                        type="text"
                        :placeholder="String(field.default ?? '')"
                        @input="src.config[field.key] = ($event.target as HTMLInputElement).value"
                      />
                    </div>
                  </div>
                  <!-- Extra custom config keys (not in schema) -->
                  <div
                    v-if="Object.keys(src.config).filter(k => !(getSourceType(src.type)?.configSchema ?? []).some(f => f.key === k)).length > 0"
                    class="ctx-source-config ctx-source-config--custom"
                  >
                    <label class="ctx-schema-label">Custom Config</label>
                    <div
                      v-for="key in Object.keys(src.config).filter(k => !(getSourceType(src.type)?.configSchema ?? []).some(f => f.key === k))"
                      :key="key"
                      class="ctx-kv-row"
                    >
                      <input
                        :value="key"
                        class="modal__input modal__input--xs"
                        type="text"
                        placeholder="Key"
                        @change="renameConfigKey(src, key, ($event.target as HTMLInputElement).value)"
                      />
                      <input
                        :value="String(src.config[key] ?? '')"
                        class="modal__input modal__input--xs"
                        type="text"
                        placeholder="Value"
                        @input="src.config[key] = ($event.target as HTMLInputElement).value"
                      />
                      <button
                        class="btn btn--xs btn--danger-ghost"
                        title="Remove key"
                        @click="removeConfigKey(src, key)"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <button
                    class="btn btn--xs btn--ghost ctx-add-key"
                    @click="addConfigKey(src)"
                  >
                    + Add Custom Key
                  </button>
                </div>
              </div>
            </div>

            <!-- Execution -->
            <div class="edit-section">
              <div class="edit-section__header">
                <span class="edit-section__icon">⚡</span>
                <h4 class="edit-section__title">Execution</h4>
              </div>
              <div class="edit-section__divider" />
              <div class="edit-field">
                <label class="modal__label">Model Override</label>
                <input
                  :value="editingPreset.execution.modelOverride ?? ''"
                  class="modal__input"
                  type="text"
                  placeholder="Leave blank for default"
                  @input="editingPreset!.execution.modelOverride = ($event.target as HTMLInputElement).value || null"
                />
              </div>
              <div class="edit-row">
                <div class="edit-field">
                  <label class="modal__label">Timeout (s)</label>
                  <input
                    v-model.number="editingPreset.execution.timeoutSeconds"
                    class="modal__input"
                    type="number"
                    min="0"
                  />
                </div>
                <div class="edit-field">
                  <label class="modal__label">Max Retries</label>
                  <input
                    v-model.number="editingPreset.execution.maxRetries"
                    class="modal__input"
                    type="number"
                    min="0"
                  />
                </div>
                <div class="edit-field">
                  <label class="modal__label">Priority</label>
                  <select
                    v-model="editingPreset.execution.priority"
                    class="modal__input"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div class="modal__footer">
            <button class="btn btn--secondary" @click="closeEditModal">
              Cancel
            </button>
            <button
              class="btn btn--primary"
              :disabled="saving"
              @click="handleSaveEdit"
            >
              {{ saving ? "Saving…" : "Save Changes" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Detail Slide-over Panel -->
      <PresetDetailSlideover
        :visible="showDetail"
        :preset="detailPreset"
        @close="closeDetail"
        @run="runTask"
        @duplicate="duplicatePreset"
        @edit="(p) => { openEditModal(p); closeDetail(); }"
        @delete="(p) => { confirmDelete(p); closeDetail(); }"
      />
    </div>
  </div>
</template>

<style scoped>
/* ── Title Row ───────────────────────────────────────────── */
.page-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  white-space: nowrap;
}

.title-icon-tile {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  border: 1px solid var(--border-accent, var(--accent-fg));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.title-icon-tile svg {
  width: 16px;
  height: 16px;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── Stats Strip ─────────────────────────────────────────── */
.stats-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0 2px;
  flex-wrap: wrap;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-dot--total {
  background: var(--accent-fg);
}

.stat-dot--builtin {
  background: var(--done-fg);
}

.stat-dot--custom {
  background: var(--accent-fg);
}

.stat-dot--enabled {
  background: var(--success-fg);
}

.stat-sep {
  color: var(--text-tertiary);
  font-size: 0.625rem;
  user-select: none;
}

/* ── Filter Row ──────────────────────────────────────────── */
.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 20px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  max-width: 260px;
  flex: 1;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}

.search-box:focus-within {
  border-color: var(--accent-fg);
}

.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.tag-filter {
  flex-shrink: 0;
}

.tag-select {
  height: 32px;
  padding: 0 28px 0 12px;
  font-size: 0.8125rem;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color var(--transition-fast);
}

.tag-select:focus {
  border-color: var(--accent-fg);
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.btn svg {
  width: 14px;
  height: 14px;
}

.btn--primary {
  background: var(--gradient-accent, var(--accent-emphasis));
  border: 1px solid transparent;
  color: var(--text-on-emphasis);
  font-weight: 600;
  box-shadow: 0 1px 6px var(--accent-muted);
}

.btn--primary:hover:not(:disabled) {
  box-shadow: 0 3px 14px var(--accent-muted);
  transform: translateY(-1px);
}

.btn--primary:active {
  transform: translateY(0);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn--secondary {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.btn--secondary:hover {
  color: var(--text-primary);
  border-color: var(--accent-fg);
  background: var(--accent-subtle, var(--canvas-inset));
}

.btn--ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.btn--ghost:hover:not(:disabled) {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.btn--ghost:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn--danger {
  background: var(--danger-emphasis);
  border: 1px solid transparent;
  color: var(--text-on-emphasis);
  font-weight: 600;
}

.btn--danger:hover {
  opacity: 0.9;
  box-shadow: 0 2px 10px var(--danger-muted);
}

.btn--sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

/* ── Preset Grid ─────────────────────────────────────────── */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

/* ── Preset Card ─────────────────────────────────────────── */
.preset-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.preset-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 2px 12px var(--accent-subtle);
}

.preset-card--disabled {
  opacity: 0.55;
}

.preset-card--disabled:hover {
  opacity: 0.7;
}

.preset-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.preset-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}

.preset-card__name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.preset-card__desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.45;
  margin: 0;
}

.preset-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-card__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.meta-item svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.preset-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: auto;
  padding-top: 4px;
  border-top: 1px solid var(--border-muted);
}

/* ── Badge ───────────────────────────────────────────────── */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
}

.badge--builtin {
  background: var(--done-subtle);
  color: var(--done-fg);
  border: 1px solid var(--done-muted);
}

/* ── Tag Pill ────────────────────────────────────────────── */
.tag-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-muted);
  border: 1px solid var(--accent-subtle);
}

/* ── Toggle Switch ───────────────────────────────────────── */
.toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle__slider {
  width: 34px;
  height: 18px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-default);
  border-radius: 9999px;
  position: relative;
  transition: all var(--transition-fast);
}

.toggle__slider::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: var(--text-tertiary);
  border-radius: 50%;
  transition: all var(--transition-fast);
}

.toggle input:checked + .toggle__slider {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.toggle input:checked + .toggle__slider::after {
  left: 18px;
  background: var(--text-on-emphasis);
}

/* ── State Messages ──────────────────────────────────────── */
.state-message {
  text-align: center;
  padding: 40px 20px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.state-message--error {
  color: var(--danger-fg);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

/* ── Empty State ─────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-state__icon {
  font-size: 3rem;
  margin-bottom: 12px;
}

.empty-state__title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.empty-state__desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 20px;
}

.empty-state__actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

/* ── Modal ───────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--backdrop-color);
  backdrop-filter: blur(4px);
}

.modal {
  width: 440px;
  max-width: 90vw;
  background: var(--canvas-default);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-lg);
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-muted);
}

.modal__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal__close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
}

.modal__close:hover {
  color: var(--text-primary);
}

.modal__body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.modal__input {
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.modal__input:focus {
  border-color: var(--accent-fg);
}

.modal__input--readonly {
  color: var(--text-tertiary);
  cursor: default;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.75rem;
}

.modal__textarea {
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--transition-fast);
}

.modal__textarea:focus {
  border-color: var(--accent-fg);
}

.modal__hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin: 8px 0 0;
  font-style: italic;
}

.modal__validation-hint {
  font-size: 0.75rem;
  color: var(--danger-fg);
  margin: 2px 0 0;
}

.modal__optional {
  font-weight: 400;
  color: var(--text-tertiary);
  text-transform: none;
  letter-spacing: 0;
}

.modal__confirm-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

.modal__confirm-text strong {
  color: var(--text-primary);
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-muted);
}

/* ── Edit Modal Additions ────────────────────────────────── */
.modal--wide {
  width: 720px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal--wide .modal__body {
  overflow-y: auto;
  flex: 1;
}

.edit-body {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.edit-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-section__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.edit-section__icon {
  font-size: 0.8125rem;
  line-height: 1;
}

.edit-section__title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0;
}

.edit-section__divider {
  height: 1px;
  background: var(--border-default);
  margin: -4px 0 4px;
}

.edit-grid {
  display: grid;
  gap: 12px;
}

.edit-grid--2col {
  grid-template-columns: 1fr 1fr;
}

.edit-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal__textarea--code {
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", monospace);
  font-size: 0.75rem;
  line-height: 1.5;
  tab-size: 2;
  background: var(--canvas-default);
  border-color: var(--border-muted);
}

/* ── Category Pills ──────────────────────────────────────── */
.category-pills {
  display: flex;
  gap: 4px;
  margin: 12px 0 0;
}

.category-pill {
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  font-family: inherit;
}

.category-pill:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.category-pill--active {
  background: var(--accent-muted);
  color: var(--accent-fg);
  border-color: var(--accent-fg);
}

/* ── Sort Filter ─────────────────────────────────────────── */
.sort-filter {
  flex-shrink: 0;
}

.filter-spacer {
  flex: 1;
}

/* ── View Toggle ─────────────────────────────────────────── */
.view-toggle {
  display: flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
}

.view-toggle__btn {
  padding: 5px 8px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-toggle__btn:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}

.view-toggle__btn--active {
  color: var(--accent-fg);
  background: var(--accent-muted);
}

.view-toggle__btn + .view-toggle__btn {
  border-left: 1px solid var(--border-default);
}

/* ── Accent Button ───────────────────────────────────────── */
.btn--accent {
  background: var(--accent-muted);
  border: 1px solid var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
}

.btn--accent:hover:not(:disabled) {
  background: var(--accent-muted);
  border-color: var(--accent-fg);
}

/* ── Enhanced Card Styles ────────────────────────────────── */
.preset-card {
  cursor: pointer;
}

.preset-card--builtin {
  border-left: 3px solid var(--done-fg);
}

.preset-card:not(.preset-card--builtin):not(.preset-card--disabled) {
  border-left: 3px solid transparent;
}

.preset-card:hover .preset-card__name {
  color: var(--accent-fg);
}

.preset-card__info-line {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 500;
}

/* ── Badge Variants ──────────────────────────────────────── */
.badge--type {
  background: color-mix(in srgb, var(--type-color, var(--accent-fg)) 12%, transparent);
  color: var(--type-color, var(--accent-fg));
  border: 1px solid color-mix(in srgb, var(--type-color, var(--accent-fg)) 20%, transparent);
}

.type-color-accent { --type-color: var(--accent-fg); color: var(--accent-fg); }
.type-color-success { --type-color: var(--success-fg); color: var(--success-fg); }
.type-color-warning { --type-color: var(--warning-fg); color: var(--warning-fg); }
.type-color-danger { --type-color: var(--danger-fg); color: var(--danger-fg); }
.type-color-info { --type-color: var(--accent-fg); color: var(--accent-fg); }

.badge--version {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-variant-numeric: tabular-nums;
}

.badge--sm {
  padding: 1px 6px;
  font-size: 0.5625rem;
}

.badge--inline {
  margin-left: 6px;
  vertical-align: middle;
}

/* ── Tag Pill Variants ───────────────────────────────────── */
.tag-pill--more {
  background: transparent;
  border-style: dashed;
  color: var(--text-tertiary);
}

.tag-pill--sm {
  padding: 1px 6px;
  font-size: 0.5625rem;
}

/* ── Preset List View ────────────────────────────────────── */
.preset-list {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.preset-list__header {
  display: grid;
  grid-template-columns: 36px 1.5fr 0.8fr 1fr 0.6fr 0.7fr 100px;
  gap: 10px;
  padding: 8px 14px;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-subtle);
}

.preset-list__row {
  display: grid;
  grid-template-columns: 36px 1.5fr 0.8fr 1fr 0.6fr 0.7fr 100px;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.preset-list__row:last-child {
  border-bottom: none;
}

.preset-list__row:hover {
  background: var(--canvas-subtle);
}

.preset-list__row--disabled {
  opacity: 0.5;
}

.preset-list__name {
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preset-list__type {
  min-width: 0;
}

.preset-list__tags {
  display: flex;
  gap: 3px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.preset-list__sources {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

.preset-list__date {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.preset-list__actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

/* ── Small Toggle Variant ────────────────────────────────── */
.toggle--sm .toggle__slider {
  width: 28px;
  height: 16px;
}

.toggle--sm .toggle__slider::after {
  width: 10px;
  height: 10px;
}

.toggle--sm input:checked + .toggle__slider::after {
  left: 14px;
}
</style>


<style>

/* ─── Context Source Editor ──────────────────────────────────────── */
.ctx-sources-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ctx-sources-empty {
  padding: 12px 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
  font-style: italic;
}

.ctx-source-card {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--surface-tertiary);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}

.ctx-source-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ctx-source-required {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.ctx-source-config {
  margin-top: 8px;
  padding-left: 4px;
}

.ctx-source-config--custom {
  border-top: 1px dashed var(--border-default);
  padding-top: 8px;
}

.ctx-source-desc {
  margin: 4px 0 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.3;
}

.ctx-source-hint {
  margin: 2px 0 0;
  font-size: 0.6875rem;
  color: var(--warning-fg);
  line-height: 1.3;
}

.ctx-source-hint code {
  font-size: 0.6875rem;
  background: var(--surface-secondary);
  padding: 1px 3px;
  border-radius: 3px;
}

.ctx-schema-field {
  margin-bottom: 6px;
}

.ctx-schema-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.ctx-schema-hint {
  display: block;
  font-size: 0.6875rem;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.ctx-kv-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.ctx-add-key {
  margin-top: 6px;
  font-size: 0.6875rem;
}

.modal__input--sm {
  font-size: 0.8125rem;
  padding: 4px 8px;
}

.modal__input--xs {
  font-size: 0.75rem;
  padding: 3px 6px;
  flex: 1;
  min-width: 60px;
}

.btn--xs {
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 4px;
}

.btn--danger-ghost {
  background: transparent;
  color: var(--danger-fg);
  border: none;
  cursor: pointer;
}

.btn--danger-ghost:hover {
  background: var(--danger-subtle);
}
</style>
