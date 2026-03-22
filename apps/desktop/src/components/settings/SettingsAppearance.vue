<script setup lang="ts">
import { BtnGroup, SectionPanel } from '@tracepilot/ui';
import { computed } from 'vue';
import { usePreferencesStore } from '@/stores/preferences';
import {
  DEFAULT_CONTENT_MAX_WIDTH,
  DEFAULT_UI_SCALE,
} from '@tracepilot/types';

const preferences = usePreferencesStore();

// ── Content width presets ──────────────────────────────────────
const contentWidthOptions = [
  { value: '1200', label: 'Compact' },
  { value: '1600', label: 'Standard' },
  { value: '2000', label: 'Wide' },
  { value: '0', label: 'Full' },
];

const contentWidthValue = computed({
  get: () => String(preferences.contentMaxWidth),
  set: (v: string) => { preferences.contentMaxWidth = Number(v); },
});

const contentWidthLabel = computed(() => {
  if (preferences.contentMaxWidth === 0) return 'No limit — content stretches to fill the window';
  return `Content capped at ${preferences.contentMaxWidth}px`;
});

// ── UI scale ───────────────────────────────────────────────────
const scalePercent = computed(() => Math.round(preferences.uiScale * 100));

function onScaleInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  preferences.uiScale = val / 100;
}

function resetScale() {
  preferences.uiScale = DEFAULT_UI_SCALE;
}

function resetContentWidth() {
  preferences.contentMaxWidth = DEFAULT_CONTENT_MAX_WIDTH;
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Appearance</div>
    <SectionPanel>
      <!-- Content Width -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Content width</div>
          <div class="setting-description">
            Maximum width of page content. Use wider settings for ultrawide or 4K displays.
          </div>
          <div class="setting-preview-hint">{{ contentWidthLabel }}</div>
        </div>
        <div class="setting-control-group">
          <BtnGroup
            :options="contentWidthOptions"
            :model-value="contentWidthValue"
            @update:model-value="contentWidthValue = $event"
          />
          <button
            v-if="preferences.contentMaxWidth !== DEFAULT_CONTENT_MAX_WIDTH"
            class="btn btn-sm btn-ghost"
            title="Reset to default"
            @click="resetContentWidth"
          >
            ↺
          </button>
        </div>
      </div>

      <!-- UI Scale -->
      <div class="setting-row setting-row-stacked">
        <div class="setting-info" style="margin-bottom: 8px;">
          <div class="setting-label">UI scale</div>
          <div class="setting-description">
            Adjust the global interface size. Changes are applied in real-time.
          </div>
        </div>
        <div class="scale-control">
          <span class="scale-label-end">A<span class="scale-indicator-small">−</span></span>
          <input
            type="range"
            min="80"
            max="130"
            step="5"
            :value="scalePercent"
            class="scale-slider"
            aria-label="UI scale"
            @input="onScaleInput"
          />
          <span class="scale-label-end">A<span class="scale-indicator-large">+</span></span>
          <span class="scale-value">{{ scalePercent }}%</span>
          <button
            v-if="preferences.uiScale !== DEFAULT_UI_SCALE"
            class="btn btn-sm btn-ghost"
            title="Reset to 100%"
            @click="resetScale"
          >
            ↺
          </button>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.setting-preview-hint {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  margin-top: 3px;
  font-style: italic;
}

.scale-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scale-slider {
  flex: 1;
  max-width: 240px;
  accent-color: var(--accent-fg);
  height: 4px;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border-default);
  border-radius: 2px;
  outline: none;
}

.scale-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-emphasis);
  cursor: pointer;
  border: 2px solid var(--canvas-default);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.scale-label-end {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  user-select: none;
  display: flex;
  align-items: baseline;
}

.scale-indicator-small {
  font-size: 0.5rem;
}

.scale-indicator-large {
  font-size: 0.625rem;
}

.scale-value {
  min-width: 40px;
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  text-align: center;
}
</style>
