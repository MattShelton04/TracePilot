<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
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
const detailSections = ref({
  prompt: true,
  context: false,
  output: false,
  execution: false,
});

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

function taskTypeColor(taskType: string): string {
  const colors: Record<string, string> = {
    analysis: "#818cf8",
    review: "#34d399",
    generation: "#fbbf24",
    health: "#f87171",
    summary: "#38bdf8",
  };
  const key = taskType.toLowerCase();
  for (const [k, v] of Object.entries(colors)) {
    if (key.includes(k)) return v;
  }
  return "var(--accent-fg)";
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

function toggleDetailSection(section: keyof typeof detailSections.value) {
  detailSections.value[section] = !detailSections.value[section];
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
                  :style="{ '--type-color': taskTypeColor(preset.taskType) }"
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
                :style="{ '--type-color': taskTypeColor(preset.taskType) }"
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
      <Teleport to="body">
        <div
          v-if="showDetail"
          class="detail-backdrop"
          @click="closeDetail"
        />
        <Transition name="slideover">
          <div v-if="showDetail && detailPreset" class="detail-panel">
            <div class="detail-panel__header">
              <div class="detail-header__top">
                <div class="detail-header__left">
                  <span
                    class="badge badge--type"
                    :style="{ '--type-color': taskTypeColor(detailPreset.taskType) }"
                  >
                    {{ detailPreset.taskType }}
                  </span>
                  <span class="badge badge--version">v{{ detailPreset.version ?? 1 }}</span>
                  <span v-if="detailPreset.builtin" class="badge badge--builtin">builtin</span>
                </div>
                <button class="detail-close" @click="closeDetail" title="Close">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    width="14"
                    height="14"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              <h2 class="detail-header__name">{{ detailPreset.name }}</h2>
              <p v-if="detailPreset.description" class="detail-header__desc">
                {{ detailPreset.description }}
              </p>
              <div v-if="detailPreset.tags.length > 0" class="detail-header__tags">
                <span v-for="tag in detailPreset.tags" :key="tag" class="tag-pill">
                  {{ tag }}
                </span>
              </div>
              <div class="detail-header__info">
                <span class="meta-item">{{ infoLine(detailPreset) }}</span>
                <span class="meta-item">Updated {{ formatDate(detailPreset.updatedAt) }}</span>
              </div>
            </div>

            <div class="detail-panel__body">
              <!-- Prompt Section -->
              <div class="detail-section">
                <button
                  class="detail-section__trigger"
                  :class="{ 'detail-section__trigger--expanded': detailSections.prompt }"
                  @click="toggleDetailSection('prompt')"
                >
                  <span class="detail-section__title">💬 Prompt</span>
                  <svg
                    class="detail-section__chevron"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    width="12"
                    height="12"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
                <div v-if="detailSections.prompt" class="detail-section__body">
                  <div v-if="detailPreset.prompt.system" class="detail-prompt-block">
                    <div class="detail-prompt-label">System</div>
                    <pre class="detail-prompt-code">{{ detailPreset.prompt.system }}</pre>
                  </div>
                  <div v-if="detailPreset.prompt.user" class="detail-prompt-block">
                    <div class="detail-prompt-label">User</div>
                    <pre class="detail-prompt-code">{{ detailPreset.prompt.user }}</pre>
                  </div>
                  <div
                    v-if="!detailPreset.prompt.system && !detailPreset.prompt.user"
                    class="detail-empty-hint"
                  >
                    No prompt template configured
                  </div>
                  <table
                    v-if="detailPreset.prompt.variables.length > 0"
                    class="detail-var-table"
                  >
                    <thead>
                      <tr>
                        <th>Variable</th>
                        <th>Type</th>
                        <th>Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="v in detailPreset.prompt.variables"
                        :key="v.name"
                      >
                        <td class="detail-var-name">{{ v.name }}</td>
                        <td>
                          <span class="detail-var-type">{{ v.type }}</span>
                        </td>
                        <td>
                          <span
                            v-if="v.required"
                            class="detail-required-dot"
                            title="Required"
                          />
                          <span v-else class="detail-optional-text">optional</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Context Sources Section -->
              <div class="detail-section">
                <button
                  class="detail-section__trigger"
                  :class="{ 'detail-section__trigger--expanded': detailSections.context }"
                  @click="toggleDetailSection('context')"
                >
                  <span class="detail-section__title">📄 Context Sources</span>
                  <svg
                    class="detail-section__chevron"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    width="12"
                    height="12"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
                <div v-if="detailSections.context" class="detail-section__body">
                  <div
                    v-for="(src, idx) in detailPreset.context.sources"
                    :key="idx"
                    class="detail-source-card"
                  >
                    <span class="detail-source-type">{{ src.type }}</span>
                    <span v-if="src.label" class="detail-source-label">{{ src.label }}</span>
                    <span v-if="src.required" class="detail-required-dot" title="Required" />
                  </div>
                  <div
                    v-if="detailPreset.context.sources.length === 0"
                    class="detail-empty-hint"
                  >
                    No context sources configured
                  </div>
                  <div class="detail-budget">
                    Max {{ detailPreset.context.maxChars.toLocaleString() }} chars ·
                    {{ detailPreset.context.format }} format
                  </div>
                </div>
              </div>

              <!-- Output Config Section -->
              <div class="detail-section">
                <button
                  class="detail-section__trigger"
                  :class="{ 'detail-section__trigger--expanded': detailSections.output }"
                  @click="toggleDetailSection('output')"
                >
                  <span class="detail-section__title">📤 Output Config</span>
                  <svg
                    class="detail-section__chevron"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    width="12"
                    height="12"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
                <div v-if="detailSections.output" class="detail-section__body">
                  <div class="detail-kv-grid">
                    <div class="detail-kv">
                      <span class="detail-kv__label">Format</span>
                      <span class="detail-kv__value">{{ detailPreset.output.format }}</span>
                    </div>
                    <div class="detail-kv">
                      <span class="detail-kv__label">Validation</span>
                      <span class="detail-kv__value">{{ detailPreset.output.validation }}</span>
                    </div>
                  </div>
                  <div
                    v-if="Object.keys(detailPreset.output.schema).length > 0"
                    class="detail-prompt-block"
                  >
                    <div class="detail-prompt-label">Schema</div>
                    <pre class="detail-prompt-code">{{
                      JSON.stringify(detailPreset.output.schema, null, 2)
                    }}</pre>
                  </div>
                </div>
              </div>

              <!-- Execution Config Section -->
              <div class="detail-section">
                <button
                  class="detail-section__trigger"
                  :class="{ 'detail-section__trigger--expanded': detailSections.execution }"
                  @click="toggleDetailSection('execution')"
                >
                  <span class="detail-section__title">⚡ Execution Config</span>
                  <svg
                    class="detail-section__chevron"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    width="12"
                    height="12"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
                <div v-if="detailSections.execution" class="detail-section__body">
                  <div class="detail-kv-grid">
                    <div class="detail-kv">
                      <span class="detail-kv__label">Timeout</span>
                      <span class="detail-kv__value">
                        {{ detailPreset.execution.timeoutSeconds }}s
                      </span>
                    </div>
                    <div class="detail-kv">
                      <span class="detail-kv__label">Max Retries</span>
                      <span class="detail-kv__value">
                        {{ detailPreset.execution.maxRetries }}
                      </span>
                    </div>
                    <div class="detail-kv">
                      <span class="detail-kv__label">Priority</span>
                      <span class="detail-kv__value">
                        {{ detailPreset.execution.priority }}
                      </span>
                    </div>
                    <div class="detail-kv">
                      <span class="detail-kv__label">Model</span>
                      <span class="detail-kv__value">
                        {{ detailPreset.execution.modelOverride || "Default" }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="detail-panel__footer">
              <button class="btn btn--accent btn--sm" @click="runTask(detailPreset)">
                <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                  <path d="M4 2l10 6-10 6z" />
                </svg>
                Run Task
              </button>
              <button class="btn btn--secondary btn--sm" @click="duplicatePreset(detailPreset)">
                Duplicate
              </button>
              <button
                class="btn btn--secondary btn--sm"
                @click="closeDetail(); openEditModal(detailPreset)"
              >
                Edit
              </button>
              <button
                class="btn btn--ghost btn--sm"
                :disabled="detailPreset.builtin"
                @click="closeDetail(); confirmDelete(detailPreset)"
              >
                Delete
              </button>
            </div>
          </div>
        </Transition>
      </Teleport>
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
  background: #a78bfa;
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
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 6px rgba(99, 102, 241, 0.35);
}

.btn--primary:hover:not(:disabled) {
  box-shadow: 0 3px 14px rgba(99, 102, 241, 0.45);
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
  background: var(--danger-emphasis, #dc2626);
  border: 1px solid transparent;
  color: #fff;
  font-weight: 600;
}

.btn--danger:hover {
  opacity: 0.9;
  box-shadow: 0 2px 10px rgba(220, 38, 38, 0.35);
}

.btn--sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

/* ── Preset Grid ─────────────────────────────────────────── */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

/* ── Preset Card ─────────────────────────────────────────── */
.preset-card {
  background: #111113;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.preset-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 2px 12px rgba(99, 102, 241, 0.1);
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
}

.preset-card__name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.2);
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
  border: 1px solid rgba(99, 102, 241, 0.15);
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
  background: #fff;
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
  background: rgba(0, 0, 0, 0.6);
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
  border: 1px solid rgba(99, 102, 241, 0.25);
  color: var(--accent-fg);
  font-weight: 600;
}

.btn--accent:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--accent-fg);
}

/* ── Enhanced Card Styles ────────────────────────────────── */
.preset-card {
  cursor: pointer;
}

.preset-card--builtin {
  border-left: 3px solid #a78bfa;
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
/* ── Detail Slide-over Panel (unscoped for Teleport) ─────── */
.detail-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
}

.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: var(--canvas-default);
  border-left: 1px solid var(--border-default);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.3);
}

.slideover-enter-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slideover-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.slideover-enter-from,
.slideover-leave-to {
  transform: translateX(100%);
}

.detail-panel__header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.detail-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.detail-close:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.detail-header__name {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  margin: 0;
}

.detail-header__desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.45;
  margin: 0;
}

.detail-header__tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.detail-header__info {
  display: flex;
  gap: 12px;
}

/* ── Detail Sections ─────────────────────────────────────── */
.detail-panel__body {
  flex: 1;
  overflow-y: auto;
}

.detail-section {
  border-bottom: 1px solid var(--border-muted);
}

.detail-section:last-child {
  border-bottom: none;
}

.detail-section__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  transition: background var(--transition-fast);
  user-select: none;
}

.detail-section__trigger:hover {
  background: var(--canvas-subtle);
}

.detail-section__title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.detail-section__chevron {
  transition: transform var(--transition-fast);
  color: var(--text-tertiary);
}

.detail-section__trigger--expanded .detail-section__chevron {
  transform: rotate(90deg);
}

.detail-section__body {
  padding: 0 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Detail Content ──────────────────────────────────────── */
.detail-prompt-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-prompt-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail-prompt-code {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.6875rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
}

.detail-empty-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
  padding: 8px 0;
}

.detail-var-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.detail-var-table th {
  text-align: left;
  padding: 6px 8px;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border-default);
}

.detail-var-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-muted);
  color: var(--text-secondary);
}

.detail-var-name {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.6875rem;
  color: var(--accent-fg);
  font-weight: 500;
}

.detail-var-type {
  font-size: 0.5625rem;
  padding: 1px 5px;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.detail-required-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f87171;
}

.detail-optional-text {
  font-size: 0.625rem;
  color: var(--text-tertiary);
}

.detail-source-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.detail-source-type {
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  color: var(--text-primary);
}

.detail-source-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.detail-budget {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  padding: 6px 0 0;
}

.detail-kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.detail-kv {
  padding: 10px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.detail-kv__label {
  display: block;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}

.detail-kv__value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* ── Detail Footer ───────────────────────────────────────── */
.detail-panel__footer {
  padding: 14px 20px;
  border-top: 1px solid var(--border-default);
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.detail-panel__footer .btn {
  flex: 1;
  justify-content: center;
}

/* Teleported badge/tag/btn styles for detail panel */
.detail-panel .badge {
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

.detail-panel .badge--type {
  background: color-mix(in srgb, var(--type-color, var(--accent-fg)) 12%, transparent);
  color: var(--type-color, var(--accent-fg));
  border: 1px solid color-mix(in srgb, var(--type-color, var(--accent-fg)) 20%, transparent);
}

.detail-panel .badge--version {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-variant-numeric: tabular-nums;
}

.detail-panel .badge--builtin {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.2);
}

.detail-panel .tag-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-muted);
  border: 1px solid rgba(99, 102, 241, 0.15);
}

.detail-panel .meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.detail-panel .btn {
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

.detail-panel .btn--sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

.detail-panel .btn--accent {
  background: var(--accent-muted);
  border: 1px solid rgba(99, 102, 241, 0.25);
  color: var(--accent-fg);
  font-weight: 600;
}

.detail-panel .btn--accent:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--accent-fg);
}

.detail-panel .btn--secondary {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.detail-panel .btn--secondary:hover {
  color: var(--text-primary);
  border-color: var(--accent-fg);
}

.detail-panel .btn--ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.detail-panel .btn--ghost:hover:not(:disabled) {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.detail-panel .btn--ghost:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
