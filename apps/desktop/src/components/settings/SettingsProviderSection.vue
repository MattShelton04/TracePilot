<script setup lang="ts">
/**
 * A Settings section for one experimental session provider: the section
 * title, the experimental notice, the provider's on/off switch, and the
 * provider's own settings (the default slot), shown only while it is on.
 */
import { FormSwitch, SectionPanel } from "@tracepilot/ui";
import SettingsFeatureGroupHeader from "@/components/settings/SettingsFeatureGroupHeader.vue";

defineProps<{
  /** Section heading, e.g. the provider's name. */
  title: string;
  /** Label of the enable switch; also its accessible name. */
  enableLabel: string;
  enableDescription: string;
}>();

const enabled = defineModel<boolean>("enabled", { required: true });
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">{{ title }}</div>
    <SettingsFeatureGroupHeader
      label="Experimental"
      tone="experimental"
      tooltip="Experimental features are likely to be buggy or unstable."
    />
    <SectionPanel class="provider-experimental-panel">
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">{{ enableLabel }}</div>
          <div class="setting-description">{{ enableDescription }}</div>
        </div>
        <FormSwitch v-model="enabled" :aria-label="enableLabel" />
      </div>
      <slot v-if="enabled" />
    </SectionPanel>
  </div>
</template>

<style scoped>
.provider-experimental-panel {
  border-color: var(--warning-muted);
}
</style>
