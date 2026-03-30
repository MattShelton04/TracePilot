<script setup lang="ts">
import type { RichRenderableToolName } from "@tracepilot/types";
import { ActionButton, FormSwitch, getRegisteredRenderers, SectionPanel } from "@tracepilot/ui";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();
const registeredRenderers = getRegisteredRenderers();
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
          @update:model-value="preferences.toolRendering.enabled = $event"
          label="Rich Tool Rendering"
        />
      </div>

      <!-- Per-tool overrides -->
      <template v-if="preferences.toolRendering.enabled">
        <div class="tool-viz-divider" />
        <div class="setting-row setting-row-stacked">
          <div class="setting-label setting-label-spaced">Per-Tool Overrides</div>
          <div class="setting-description setting-description-spaced">
            Disable rich rendering for specific tool types. Disabled tools fall back to plain text.
          </div>
          <div class="tool-viz-grid">
            <div v-for="renderer in registeredRenderers" :key="renderer.toolName" class="tool-viz-item">
              <FormSwitch
                :model-value="preferences.isRichRenderingEnabled(renderer.toolName)"
                @update:model-value="preferences.setToolRenderingOverride(renderer.toolName as RichRenderableToolName, $event)"
                :label="renderer.label"
              />
            </div>
          </div>
        </div>

        <div class="tool-viz-divider" />
        <div class="setting-row setting-row-end">
          <ActionButton size="sm" @click="preferences.resetToolRendering()">Reset to Defaults</ActionButton>
        </div>
      </template>
    </SectionPanel>
  </div>
</template>

<style scoped>
.tool-viz-divider {
  border-top: 1px solid var(--border-subtle);
  margin: 0;
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
</style>
