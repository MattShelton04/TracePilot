<script setup lang="ts">
import { computed, ref } from "vue";
import SettingsAbout from "@/components/settings/SettingsAbout.vue";
import SettingsAppearance from "@/components/settings/SettingsAppearance.vue";
import SettingsDataStorage from "@/components/settings/SettingsDataStorage.vue";
import SettingsExperimental from "@/components/settings/SettingsExperimental.vue";
import SettingsGeneral from "@/components/settings/SettingsGeneral.vue";
import SettingsLogging from "@/components/settings/SettingsLogging.vue";
import SettingsPricing from "@/components/settings/SettingsPricing.vue";
import SettingsSdk from "@/components/settings/SettingsSdk.vue";
import SettingsToolVisualization from "@/components/settings/SettingsToolVisualization.vue";
import SettingsUpdates from "@/components/settings/SettingsUpdates.vue";
import { useSessionsStore } from "@/stores/sessions";

const sessionsStore = useSessionsStore();
const dataStorageRef = ref<InstanceType<typeof SettingsDataStorage> | null>(null);

const sessionCount = computed(() => {
  const indexed = dataStorageRef.value?.indexedSessionCount ?? 0;
  return indexed || sessionsStore.sessions.length;
});

const databaseSize = computed(() => dataStorageRef.value?.databaseSize ?? "—");
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner settings-root">
      <h1 class="page-title page-title-spaced">Settings</h1>

      <SettingsGeneral />
      <SettingsAppearance />
      <SettingsDataStorage ref="dataStorageRef" />
      <SettingsLogging />
      <SettingsPricing />
      <SettingsToolVisualization />
      <SettingsUpdates />
      <SettingsExperimental />
      <SettingsSdk />
      <SettingsAbout :session-count="sessionCount" :database-size="databaseSize" />
    </div>
  </div>
</template>

<style scoped>
.settings-root {
  /* Settings root now respects --content-max-width from .page-content-inner, 
     allowing the user to preview content width changes live. */
}

.page-title-spaced {
  margin-bottom: 24px;
}

/* Shared styles for all settings sub-components (scoped via :deep) */

/* Section spacing */
.settings-root :deep(.settings-section) {
  margin-bottom: 24px;
}

.settings-root :deep(.settings-section-title) {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}

/* Setting rows */
.settings-root :deep(.setting-row) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.settings-root :deep(.setting-row:last-child) {
  border-bottom: none;
}

.settings-root :deep(.setting-info) {
  flex: 1;
  min-width: 0;
}

.settings-root :deep(.setting-info-stacked) {
  margin-bottom: 8px;
}

.settings-root :deep(.setting-label) {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.settings-root :deep(.setting-description) {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 1px;
}

.settings-root :deep(.empty-count-hint) {
  color: var(--text-placeholder);
  font-style: italic;
}

.settings-root :deep(.setting-control-group) {
  display: flex;
  align-items: center;
  gap: 6px;
}

.settings-root :deep(.setting-unit) {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.settings-root :deep(.setting-value-display) {
  font-size: 0.8125rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* Danger button override */
.settings-root :deep(.btn-danger) {
  color: var(--danger-fg);
  border-color: var(--danger-muted);
}
.settings-root :deep(.btn-danger:hover) {
  background: var(--danger-subtle);
}

.settings-root :deep(.setting-actions) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-root :deep(.setting-result) {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* Input widths */
.settings-root :deep(.input-narrow-center) {
  width: 80px;
  text-align: center;
}

.settings-root :deep(.input-medium) {
  width: 240px;
}

.settings-root :deep(.input-medium-mono) {
  width: 240px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
}

.settings-root :deep(.input-cost) {
  width: 90px;
  text-align: center;
}

/* Danger row */
.settings-root :deep(.setting-row-danger) {
  border-top: 1px solid var(--danger-muted);
}

.settings-root :deep(.setting-label-danger) {
  color: var(--danger-fg);
}

.settings-root :deep(.setting-result-danger) {
  color: var(--danger-fg);
}

/* Stacked / end row modifiers */
.settings-root :deep(.setting-row-stacked) {
  flex-direction: column;
  align-items: stretch;
}

.settings-root :deep(.setting-label-spaced) {
  margin-bottom: 8px;
}

.settings-root :deep(.setting-description-spaced) {
  margin-bottom: 8px;
}

.settings-root :deep(.setting-row-end) {
  justify-content: flex-end;
}

/* Utility classes */
.settings-root :deep(.text-left) {
  text-align: left;
}

.settings-root :deep(.text-center) {
  text-align: center;
}

.settings-root :deep(.text-xs) {
  font-size: 0.75rem;
}

.settings-root :deep(.tabular-nums) {
  font-variant-numeric: tabular-nums;
}
</style>
