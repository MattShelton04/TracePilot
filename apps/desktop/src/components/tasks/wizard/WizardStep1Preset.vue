<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import type { TaskWizard } from "@/composables/useTaskWizard";

defineProps<{
  wizard: TaskWizard;
}>();
</script>

<template>
  <div class="step-content">
    <div class="search-bar">
      <svg
        class="search-icon"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path
          d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9
             0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75
             0 1 1-1.06 1.06l-3.04-3.04z"
        />
      </svg>
      <input
        v-model="wizard.searchQuery"
        type="text"
        class="form-input search-input"
        placeholder="Search presets…"
      />
    </div>

    <div class="category-pills">
      <button
        v-for="cat in (['all', 'builtin', 'custom'] as const)"
        :key="cat"
        :class="['category-pill', { active: wizard.categoryFilter === cat }]"
        @click="wizard.categoryFilter = cat"
      >
        {{ cat === "all" ? "All" : cat === "builtin" ? "Built-in" : "Custom" }}
      </button>
    </div>

    <div v-if="wizard.filteredPresets.length === 0" class="empty-state">
      <span class="empty-icon">📋</span>
      <span class="empty-text">
        {{
          wizard.searchQuery ? "No presets match your search." : "No enabled presets found."
        }}
      </span>
    </div>

    <div v-else class="preset-grid">
      <button
        v-for="preset in (wizard.filteredPresets as TaskPreset[])"
        :key="preset.id"
        :class="[
          'preset-card',
          { 'preset-card--selected': wizard.selectedPreset?.id === preset.id },
        ]"
        @click="wizard.selectPreset(preset)"
      >
        <div class="preset-card-header">
          <span class="preset-name">{{ preset.name }}</span>
          <span v-if="preset.builtin" class="preset-builtin">built-in</span>
        </div>
        <p class="preset-description">{{ preset.description }}</p>
        <div class="preset-card-footer">
          <div class="preset-tags">
            <span v-for="tag in preset.tags.slice(0, 3)" :key="tag" class="preset-tag">
              {{ tag }}
            </span>
            <span v-if="preset.tags.length > 3" class="preset-tag preset-tag--more">
              +{{ preset.tags.length - 3 }}
            </span>
          </div>
          <span class="preset-meta">
            {{ preset.prompt.variables.length }} var{{
              preset.prompt.variables.length !== 1 ? "s" : ""
            }}
            · {{ wizard.contextSourcesCount(preset) }} source{{
              wizard.contextSourcesCount(preset) !== 1 ? "s" : ""
            }}
          </span>
        </div>
      </button>
    </div>

    <div class="wizard-nav">
      <button class="nav-btn nav-btn--secondary" @click="wizard.cancelToTasksList()">
        Cancel
      </button>
      <button
        class="nav-btn nav-btn--primary"
        :disabled="!wizard.canAdvanceStep1"
        @click="wizard.goNext()"
      >
        Next →
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-content {
  display: block;
}

.search-bar {
  position: relative;
  margin-bottom: 20px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-placeholder);
  pointer-events: none;
}

.search-input {
  padding: 9px 12px 9px 34px;
  font-size: 0.8125rem;
}

.form-input {
  width: 100%;
  padding: 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-input::placeholder {
  color: var(--text-placeholder);
}

.form-input:focus {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}

.category-pills {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}

.category-pill {
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  font-family: inherit;
}

.category-pill:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
}

.category-pill.active {
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
  color: var(--accent-fg);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 1.75rem;
}

.empty-text {
  font-size: 0.8125rem;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
  color: var(--text-primary);
  font-family: inherit;
  font-size: inherit;
  position: relative;
}

.preset-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-subtle), var(--shadow-md);
  transform: translateY(-1px);
}

.preset-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.preset-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.preset-builtin {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.preset-description {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0 0 12px 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.preset-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preset-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.preset-tag {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--neutral-subtle);
  padding: 2px 6px;
  border-radius: 4px;
}

.preset-tag--more {
  color: var(--text-placeholder);
}

.preset-meta {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  white-space: nowrap;
  flex-shrink: 0;
}

.preset-card--selected {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-subtle), var(--shadow-md);
}

.preset-card--selected::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-fg);
  border-radius: 10px 10px 0 0;
}

.wizard-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  font-size: 0.8125rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid transparent;
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-btn--secondary {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.nav-btn--secondary:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.nav-btn--primary {
  color: var(--text-on-emphasis);
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.nav-btn--primary:hover:not(:disabled) {
  background: var(--accent-emphasis-hover);
}

@media (max-width: 640px) {
  .preset-grid {
    grid-template-columns: 1fr;
  }
}
</style>
