<script setup lang="ts">
import { SectionPanel, BtnGroup, FormSwitch } from '@tracepilot/ui';
import { computed } from 'vue';
import { usePreferencesStore } from '@/stores/preferences';
import {
  DEFAULT_CONTENT_MAX_WIDTH,
  DEFAULT_UI_SCALE,
} from '@tracepilot/types';

const preferences = usePreferencesStore();

// ── Content width ──────────────────────────────────────────────
const presetOptions = [
  { value: '1200', label: 'Compact' },
  { value: '1600', label: 'Standard' },
  { value: '2000', label: 'Wide' },
  { value: '0', label: 'Full' },
];

const selectedPreset = computed({
  get: () => String(preferences.contentMaxWidth),
  set: (val: string) => {
    preferences.contentMaxWidth = Number(val);
  },
});

const isFullWidth = computed(() => preferences.contentMaxWidth === 0);

const contentWidthLabel = computed(() => {
  if (isFullWidth.value) return 'No limit — content stretches to fill the window';
  return `Content capped at ${preferences.contentMaxWidth}px`;
});

function adjustWidth(delta: number) {
  const current = preferences.contentMaxWidth === 0 ? 2000 : preferences.contentMaxWidth;
  const next = Math.max(400, current + delta);
  preferences.contentMaxWidth = next;
}

function resetContentWidth() {
  preferences.contentMaxWidth = DEFAULT_CONTENT_MAX_WIDTH;
}

// ── UI scale ───────────────────────────────────────────────────
const scalePercent = computed(() => Math.round(preferences.uiScale * 100));

function onScaleInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  preferences.uiScale = val / 100;
}

function adjustScale(delta: number) {
  const current = Math.round(preferences.uiScale * 100);
  const next = Math.max(80, Math.min(130, current + delta));
  preferences.uiScale = next / 100;
}

function resetScale() {
  preferences.uiScale = DEFAULT_UI_SCALE;
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Appearance</div>
    <SectionPanel>
      <!-- Content Width -->
      <div class="setting-row setting-row-stacked">
        <div class="setting-info setting-info-stacked">
          <div class="setting-label">Content width</div>
          <div class="setting-description">
            Maximum width of page content. Presets cover standard displays; fine-tune for ultrawide or 4K.
          </div>
          <div class="setting-preview-hint">{{ contentWidthLabel }}</div>
        </div>
        
        <div class="width-control-v3">
          <div class="width-inline-row">
            <BtnGroup
              v-model="selectedPreset"
              :options="presetOptions"
              class="width-presets"
            />
            
            <div v-if="!isFullWidth" class="inline-stepper">
              <button 
                class="btn btn-sm btn-outline stepper-btn" 
                @click="adjustWidth(-200)"
                title="Decrease by 200px"
              >
                −
              </button>
              
              <div class="stepper-input-wrapper">
                <input
                  type="number"
                  v-model.number="preferences.contentMaxWidth"
                  class="stepper-input"
                  min="400"
                  step="200"
                />
                <span class="stepper-unit">px</span>
              </div>

              <button 
                class="btn btn-sm btn-outline stepper-btn" 
                @click="adjustWidth(200)"
                title="Increase by 200px"
              >
                +
              </button>
            </div>

            <button
              v-if="preferences.contentMaxWidth !== DEFAULT_CONTENT_MAX_WIDTH"
              class="btn btn-sm btn-ghost reset-btn"
              title="Reset to default"
              @click="resetContentWidth"
            >
              ↺
            </button>
          </div>
        </div>
      </div>

      <!-- UI Scale -->
      <div class="setting-row setting-row-stacked">
        <div class="setting-info setting-info-stacked">
          <div class="setting-label">UI scale</div>
          <div class="setting-description">
            Adjust the global interface size. Changes are applied in real-time.
          </div>
        </div>
        <div class="scale-control">
          <button 
            class="scale-step-btn" 
            title="Decrease scale"
            @click="adjustScale(-5)"
          >
            A<span class="scale-indicator-small">−</span>
          </button>
          
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
          
          <button 
            class="scale-step-btn" 
            title="Increase scale"
            @click="adjustScale(5)"
          >
            A<span class="scale-indicator-large">+</span>
          </button>

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

      <!-- Markdown Rendering -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Markdown rendering</div>
          <div class="setting-description">
            Render rich text and code blocks in conversation and session files.
          </div>
        </div>
        <FormSwitch
          :model-value="preferences.isFeatureEnabled('renderMarkdown')"
          @update:model-value="preferences.toggleFeature('renderMarkdown')"
        />
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

/* Content Width Controls V3 */
.width-control-v3 {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.width-inline-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.width-presets {
  flex-shrink: 0;
}

.inline-stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--canvas-subtle);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.stepper-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 !important;
  font-size: 1.125rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none !important;
  background: transparent !important;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.stepper-btn:hover {
  background: var(--canvas-default) !important;
  color: var(--accent-fg);
}

.stepper-input-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 80px;
  padding: 0 4px;
}

.stepper-input {
  width: 48px;
  border: none !important;
  background: transparent !important;
  text-align: center;
  padding: 2px 0 !important;
  font-weight: 700;
  font-size: 0.8125rem;
  color: var(--accent-fg);
  outline: none;
}

/* Remove arrows from number input */
.stepper-input::-webkit-outer-spin-button,
.stepper-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stepper-unit {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 500;
  margin-left: -2px; /* Pull unit closer to number for tighter centering */
}

.reset-btn {
  opacity: 0.6;
  transition: opacity var(--transition-fast);
}

.reset-btn:hover {
  opacity: 1;
}

/* UI Scale Controls */
.scale-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scale-step-btn {
  background: none;
  border: none;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.scale-step-btn:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.scale-indicator-small { font-size: 0.625rem; margin-left: 1px; }
.scale-indicator-large { font-size: 0.75rem; margin-left: 1px; }

.scale-slider {
  flex: 1;
  max-width: 200px;
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

.scale-value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--accent-fg);
  min-width: 40px;
  text-align: right;
}
</style>
