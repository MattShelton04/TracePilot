<script setup lang="ts">
import { FormSwitch, SectionPanel } from "@tracepilot/ui";
import SettingsFeatureGroupHeader from "@/components/settings/SettingsFeatureGroupHeader.vue";
import type { FeatureFlag } from "@/config/featureFlags";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

const preferences = usePreferencesStore();
const sdk = useSdkStore();

interface FeatureOption {
  key: FeatureFlag;
  label: string;
  description: string;
}

const recommendedFlags: readonly FeatureOption[] = [
  {
    key: "skills",
    label: "Skills",
    description: "Create and manage reusable skill definitions for Copilot CLI sessions.",
  },
  {
    key: "exportView",
    label: "Export",
    description: "Enable the Export view to download sessions in various formats.",
  },
  {
    key: "exactContextCapture",
    label: "Exact Context Capture",
    description:
      "Capture the exact model request body from an isolated copy of an inactive session. No provider is contacted.",
  },
] as const;

const experimentalFlags: readonly FeatureOption[] = [
  {
    key: "mcpServers",
    label: "MCP Servers",
    description:
      "Manage Model Context Protocol servers — add, configure, and monitor MCP integrations.",
  },
  {
    key: "sessionReplay",
    label: "Session Replay",
    description: "Enable the Replay view to step through session events interactively.",
  },
  {
    key: "copilotSdk",
    label: "Copilot SDK Bridge",
    description:
      "Enable the SDK bridge for real-time session steering, programmatic events, and direct communication with Copilot CLI.",
  },
  {
    key: "configInjector",
    label: "Config Injector",
    description:
      "Edit Copilot CLI agent model assignments and configuration, with backup and restore support.",
  },
] as const;

function handleToggle(key: FeatureFlag) {
  preferences.toggleFeature(key);
  // Auto-connect SDK when the copilotSdk flag is toggled on
  if (key === "copilotSdk" && preferences.isFeatureEnabled("copilotSdk")) {
    sdk.autoConnect();
  }
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Additional Features</div>

    <div class="feature-group">
      <SettingsFeatureGroupHeader
        label="Recommended"
        tone="recommended"
        tooltip="Stable features that extend TracePilot."
      />
      <SectionPanel>
        <div
          v-for="flag in recommendedFlags"
          :key="flag.key"
          class="setting-row"
        >
          <div class="setting-info">
            <div class="setting-label">{{ flag.label }}</div>
            <div class="setting-description">{{ flag.description }}</div>
          </div>
          <FormSwitch
            :model-value="preferences.isFeatureEnabled(flag.key)"
            @update:model-value="handleToggle(flag.key)"
            :aria-label="flag.label"
          />
        </div>
      </SectionPanel>
    </div>

    <div class="feature-group feature-group--experimental">
      <SettingsFeatureGroupHeader
        label="Experimental"
        tone="experimental"
        tooltip="Experimental features are likely to be buggy or unstable."
      />
      <SectionPanel class="experimental-panel">
        <div
          v-for="flag in experimentalFlags"
          :key="flag.key"
          class="setting-row"
        >
          <div class="setting-info">
            <div class="setting-label">{{ flag.label }}</div>
            <div class="setting-description">{{ flag.description }}</div>
          </div>
          <FormSwitch
            :model-value="preferences.isFeatureEnabled(flag.key)"
            @update:model-value="handleToggle(flag.key)"
            :aria-label="flag.label"
          />
        </div>
      </SectionPanel>
    </div>
  </div>
</template>

<style scoped>
.feature-group + .feature-group {
  margin-top: 18px;
}

.experimental-panel {
  border-color: var(--warning-muted);
}
</style>
