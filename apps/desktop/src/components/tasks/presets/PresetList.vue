<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";

defineProps<{
  presets: TaskPreset[];
  contextSourceCount: (p: TaskPreset) => number;
  displayTags: (tags: string[]) => { visible: string[]; extra: number };
  taskTypeColorClass: (t: string) => string;
}>();

defineEmits<{
  (e: "open-detail", p: TaskPreset): void;
  (e: "toggle", p: TaskPreset): void;
  (e: "run", p: TaskPreset): void;
  (e: "edit", p: TaskPreset): void;
  (e: "delete", p: TaskPreset): void;
}>();
</script>

<template>
  <div class="preset-list">
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
      v-for="preset in presets"
      :key="preset.id"
      class="preset-list__row"
      :class="{ 'preset-list__row--disabled': !preset.enabled }"
      @click="$emit('open-detail', preset)"
    >
      <label class="toggle toggle--sm" @click.stop>
        <input
          type="checkbox"
          :checked="preset.enabled"
          @change="$emit('toggle', preset)"
        />
        <span class="toggle__slider" />
      </label>
      <span class="preset-list__name">
        {{ preset.name }}
        <span v-if="preset.builtin" class="badge badge--builtin badge--inline">builtin</span>
      </span>
      <span class="preset-list__type">
        <span class="badge badge--type badge--sm" :class="taskTypeColorClass(preset.taskType)">
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
      <span class="preset-list__sources">{{ contextSourceCount(preset) }}</span>
      <span class="preset-list__date">{{ formatDate(preset.updatedAt) }}</span>
      <span class="preset-list__actions" @click.stop>
        <button class="btn btn--accent btn--sm" title="Run task" @click="$emit('run', preset)">
          <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
            <path d="M4 2l10 6-10 6z" />
          </svg>
        </button>
        <button class="btn btn--ghost btn--sm" title="Edit" @click="$emit('edit', preset)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M11.5 1.5l3 3L5 14H2v-3z" />
          </svg>
        </button>
        <button
          class="btn btn--ghost btn--sm"
          :disabled="preset.builtin"
          title="Delete"
          @click="$emit('delete', preset)"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
            <path d="M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" />
          </svg>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.preset-list {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.preset-list__header,
.preset-list__row {
  display: grid;
  grid-template-columns: 32px 2fr 1fr 1.5fr 0.6fr 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
}

.preset-list__header {
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.preset-list__row {
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.8125rem;
  color: var(--text-primary);
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
  opacity: 0.55;
}

.preset-list__name {
  font-weight: 500;
  display: flex;
  align-items: center;
}

.preset-list__tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.preset-list__sources {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.preset-list__date {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.preset-list__actions {
  display: flex;
  gap: 4px;
}
</style>
