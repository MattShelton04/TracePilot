<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";

defineProps<{
  presets: TaskPreset[];
  contextSourceCount: (p: TaskPreset) => number;
  variableCount: (p: TaskPreset) => number;
  truncate: (text: string, max: number) => string;
  displayTags: (tags: string[]) => { visible: string[]; extra: number };
  taskTypeColorClass: (t: string) => string;
  infoLine: (p: TaskPreset) => string;
}>();

defineEmits<{
  (e: "open-detail", p: TaskPreset): void;
  (e: "toggle", p: TaskPreset): void;
  (e: "run", p: TaskPreset): void;
  (e: "duplicate", p: TaskPreset): void;
  (e: "edit", p: TaskPreset): void;
  (e: "delete", p: TaskPreset): void;
}>();
</script>

<template>
  <div class="preset-grid">
    <div
      v-for="preset in presets"
      :key="preset.id"
      class="preset-card"
      :class="{
        'preset-card--disabled': !preset.enabled,
        'preset-card--builtin': preset.builtin,
      }"
      @click="$emit('open-detail', preset)"
    >
      <div class="preset-card__header">
        <div class="preset-card__title-row">
          <h3 class="preset-card__name">{{ preset.name }}</h3>
          <span class="badge badge--type" :class="taskTypeColorClass(preset.taskType)">
            {{ preset.taskType }}
          </span>
          <span class="badge badge--version">v{{ preset.version ?? 1 }}</span>
          <span v-if="preset.builtin" class="badge badge--builtin">builtin</span>
        </div>
        <label class="toggle" @click.stop>
          <input
            type="checkbox"
            :checked="preset.enabled"
            @change="$emit('toggle', preset)"
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

      <div class="preset-card__info-line">{{ infoLine(preset) }}</div>

      <div class="preset-card__meta">
        <span class="meta-item" :title="`${contextSourceCount(preset)} context sources`">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M2 4h12M2 8h12M2 12h8" />
          </svg>
          {{ contextSourceCount(preset) }} sources
        </span>
        <span class="meta-item" :title="`${variableCount(preset)} variables`">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M4 2v12M8 4l-4 4 4 4" />
          </svg>
          {{ variableCount(preset) }} vars
        </span>
        <span class="meta-item" :title="preset.updatedAt">
          {{ formatDate(preset.updatedAt) }}
        </span>
      </div>

      <div class="preset-card__actions" @click.stop>
        <button class="btn btn--accent btn--sm" title="Run task with this preset" @click="$emit('run', preset)">
          <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
            <path d="M4 2l10 6-10 6z" />
          </svg>
          Run
        </button>
        <button class="btn btn--ghost btn--sm" title="Duplicate preset" @click="$emit('duplicate', preset)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <rect x="5" y="5" width="9" height="9" rx="1" />
            <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
          </svg>
        </button>
        <button class="btn btn--ghost btn--sm" title="Edit preset" @click="$emit('edit', preset)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <path d="M11.5 1.5l3 3L5 14H2v-3z" />
          </svg>
        </button>
        <button
          class="btn btn--ghost btn--sm"
          :disabled="preset.builtin"
          :title="preset.builtin ? 'Builtin presets cannot be deleted' : 'Delete preset'"
          @click="$emit('delete', preset)"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
            <path d="M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.preset-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
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

.preset-card--builtin {
  border-left: 3px solid var(--done-fg);
}

.preset-card:not(.preset-card--builtin):not(.preset-card--disabled) {
  border-left: 3px solid transparent;
}

.preset-card:hover .preset-card__name {
  color: var(--accent-fg);
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

.preset-card__info-line {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 500;
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
</style>
