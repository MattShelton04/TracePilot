<script setup lang="ts">
import type { RichRenderableToolName } from "@tracepilot/types";
import { ActionButton, FormSwitch, getRegisteredRenderers, SectionPanel } from "@tracepilot/ui";
import { ChevronDown } from "lucide-vue-next";
import { computed, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();
const registeredRenderers = getRegisteredRenderers();
const overridesExpanded = ref(false);
const customOverrideCount = computed(
  () => Object.keys(preferences.toolRendering.toolOverrides).length,
);

function setRichRenderingEnabled(enabled: boolean) {
  preferences.toolRendering.enabled = enabled;
  if (!enabled) overridesExpanded.value = false;
}

function handleOverridesToggle(event: Event) {
  overridesExpanded.value = (event.currentTarget as HTMLDetailsElement).open;
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Tool Visualization</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Rich Tool Rendering</div>
          <div class="setting-description">
            Enable enhanced visualizations for tool call results — syntax-highlighted code,
            diffs, terminal output, file trees, and more. When disabled, tool results display
            as plain text.
          </div>
        </div>
        <FormSwitch
          :model-value="preferences.toolRendering.enabled"
          @update:model-value="setRichRenderingEnabled"
          label="Rich Tool Rendering"
        />
      </div>

      <!-- Per-tool overrides -->
      <details
        v-if="preferences.toolRendering.enabled"
        class="tool-overrides"
        :open="overridesExpanded"
        @toggle="handleOverridesToggle"
      >
        <summary class="tool-overrides-summary">
          <div class="tool-overrides-summary-copy">
            <span class="setting-label">Per-tool overrides</span>
            <span class="setting-description">
              Choose which tool types fall back to plain text.
            </span>
          </div>
          <div class="tool-overrides-summary-meta">
            <span class="tool-overrides-count">
              {{ customOverrideCount === 0 ? 'Using defaults' : `${customOverrideCount} customized` }}
            </span>
            <ChevronDown
              class="tool-overrides-chevron"
              :size="16"
              :stroke-width="1.75"
              aria-hidden="true"
            />
          </div>
        </summary>

        <div v-if="overridesExpanded" class="tool-overrides-content">
          <div class="tool-viz-grid">
            <div
              v-for="renderer in registeredRenderers"
              :key="renderer.toolName"
              class="tool-viz-item"
            >
              <FormSwitch
                :model-value="preferences.isRichRenderingEnabled(renderer.toolName)"
                @update:model-value="preferences.setToolRenderingOverride(renderer.toolName as RichRenderableToolName, $event)"
                :label="renderer.label"
              />
            </div>
          </div>

          <div v-if="customOverrideCount > 0" class="tool-overrides-actions">
            <ActionButton size="sm" @click="preferences.resetToolRendering()">
              Reset to Defaults
            </ActionButton>
          </div>
        </div>
      </details>
    </SectionPanel>
  </div>
</template>

<style scoped>
.tool-overrides {
  border-top: 1px solid var(--border-subtle);
}

.tool-overrides-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  cursor: pointer;
  list-style: none;
}

.tool-overrides-summary::-webkit-details-marker {
  display: none;
}

.tool-overrides-summary:hover {
  background: var(--canvas-default);
}

.tool-overrides-summary:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}

.tool-overrides-summary-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tool-overrides-summary-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tool-overrides-count {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.tool-overrides-chevron {
  color: var(--text-tertiary);
  transition: transform var(--transition-fast);
}

.tool-overrides[open] .tool-overrides-chevron {
  transform: rotate(180deg);
}

.tool-overrides-content {
  padding: 4px 16px 12px;
  border-top: 1px solid var(--border-subtle);
}

.tool-viz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px 16px;
  padding: 0 4px;
}

.tool-viz-item {
  padding: 4px 0;
}

.tool-overrides-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
  margin-top: 8px;
  border-top: 1px solid var(--border-subtle);
}
</style>
