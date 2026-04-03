<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { usePresetsStore } from "@/stores/presets";

const store = usePresetsStore();

const showNewPresetModal = ref(false);
const showDeleteConfirm = ref(false);
const presetToDelete = ref<TaskPreset | null>(null);
const creating = ref(false);

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

async function togglePreset(preset: TaskPreset) {
  await store.savePreset({ ...preset, enabled: !preset.enabled });
}

function confirmDelete(preset: TaskPreset) {
  presetToDelete.value = preset;
  showDeleteConfirm.value = true;
}

async function handleDelete() {
  if (!presetToDelete.value) return;
  await store.deletePreset(presetToDelete.value.id);
  showDeleteConfirm.value = false;
  presetToDelete.value = null;
}

function cancelDelete() {
  showDeleteConfirm.value = false;
  presetToDelete.value = null;
}

async function handleCreatePreset() {
  if (!newPresetName.value.trim() || !presetId.value) return;
  creating.value = true;

  const now = new Date().toISOString();
  const tags = newPresetTags.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const preset: TaskPreset = {
    id: presetId.value,
    name: newPresetName.value.trim(),
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
          />
        </div>

        <div class="tag-filter">
          <select v-model="store.filterTag" class="tag-select">
            <option value="all">All Tags</option>
            <option v-for="tag in store.allTags" :key="tag" :value="tag">
              {{ tag }}
            </option>
          </select>
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

      <!-- Preset Grid -->
      <div v-else-if="store.filteredPresets.length > 0" class="preset-grid">
        <div
          v-for="preset in store.filteredPresets"
          :key="preset.id"
          class="preset-card"
          :class="{ 'preset-card--disabled': !preset.enabled }"
        >
          <div class="preset-card__header">
            <div class="preset-card__title-row">
              <h3 class="preset-card__name">{{ preset.name }}</h3>
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
              v-for="tag in preset.tags"
              :key="tag"
              class="tag-pill"
            >
              {{ tag }}
            </span>
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
            <span class="meta-item" :title="preset.createdAt">
              {{ formatDate(preset.createdAt) }}
            </span>
          </div>

          <div class="preset-card__actions">
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
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <div class="empty-state__icon">📋</div>
        <h3 class="empty-state__title">No presets found</h3>
        <p class="empty-state__desc">
          {{
            store.searchQuery || store.filterTag !== "all"
              ? "Try a different search term or tag filter"
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
        @click.self="cancelDelete"
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
        @click.self="showNewPresetModal = false"
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
</style>
