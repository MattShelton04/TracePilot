<script setup lang="ts">
import {
  clampSessionCacheSize,
  DEFAULT_SESSION_CACHE_SIZE,
  MAX_SESSION_CACHE_SIZE,
  MIN_SESSION_CACHE_SIZE,
} from "@tracepilot/types";
import { ActionButton, FormInput, SectionPanel } from "@tracepilot/ui";
import { computed } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

const impactLabel = computed(() => {
  const size = preferences.sessionCacheSize;
  if (size < 10) return "Less memory · more reloads";
  if (size === 10) return "Balanced default";
  if (size <= 30) return "Faster broad revisits · more memory";
  return "Maximum revisit speed · highest memory";
});

function updateCacheSize(value: unknown) {
  preferences.sessionCacheSize = clampSessionCacheSize(Number(value));
}

function resetCacheSize() {
  preferences.sessionCacheSize = DEFAULT_SESSION_CACHE_SIZE;
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Performance</div>
    <SectionPanel>
      <div class="setting-row setting-row-stacked">
        <div class="setting-info setting-info-stacked">
          <div class="setting-label">Recent session cache</div>
          <div class="setting-description">
            Prefetch and retain up to this many recent sessions for faster revisits.
            Each slot can retain parsed events, reconstructed turns, and a frontend snapshot,
            so similarly sized sessions use roughly more memory as this count rises.
            Higher values are worthwhile when you revisit many sessions and have RAM available.
          </div>
        </div>

        <div class="cache-setting-controls">
          <FormInput
            :model-value="preferences.sessionCacheSize"
            @update:model-value="updateCacheSize"
            type="number"
            :min="MIN_SESSION_CACHE_SIZE"
            :max="MAX_SESSION_CACHE_SIZE"
            step="1"
            class="input-narrow-center"
            aria-label="Recent session cache size"
          />
          <span class="setting-unit">sessions</span>
          <span class="cache-impact">{{ impactLabel }}</span>
          <ActionButton
            v-if="preferences.sessionCacheSize !== DEFAULT_SESSION_CACHE_SIZE"
            size="sm"
            variant="ghost"
            @click="resetCacheSize"
          >
            Reset to {{ DEFAULT_SESSION_CACHE_SIZE }}
          </ActionButton>
        </div>

        <div class="cache-grounding">
          At {{ preferences.sessionCacheSize }}, TracePilot can keep up to
          {{ preferences.sessionCacheSize }} recent session payloads in each navigation cache.
          A value of 30 permits roughly three times as many retained session payloads as the
          default of 10, but exact RAM does not scale perfectly because session sizes vary.
          Large and tool-heavy sessions cost more. Lower values may reparse sessions more often.
          No fixed speed or RAM estimate is shown because both depend on the actual session files.
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.cache-setting-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cache-impact {
  color: var(--text-secondary);
  font-size: 0.75rem;
  margin-left: 4px;
}

.cache-grounding {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.5;
  margin-top: 8px;
}
</style>
