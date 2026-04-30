<script setup lang="ts">
import { FormSwitch, SectionPanel } from "@tracepilot/ui";
import type { FeatureFlag } from "@/config/featureFlags";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

const preferences = usePreferencesStore();
const sdk = useSdkStore();

const flags: readonly { key: FeatureFlag; label: string; description: string }[] = [
  {
    key: "mcpServers",
    label: "MCP Servers",
    description:
      "Manage Model Context Protocol servers — add, configure, and monitor MCP integrations.",
  },
  {
    key: "skills",
    label: "Skills",
    description: "Create and manage reusable skill definitions for Copilot CLI sessions.",
  },
  {
    key: "healthScoring",
    label: "Health Scoring",
    description: "Enable the Health view with session quality scoring and diagnostics.",
  },
  {
    key: "sessionReplay",
    label: "Session Replay",
    description: "Enable the Replay view to step through session events interactively.",
  },
  {
    key: "exportView",
    label: "Export",
    description: "Enable the Export view to download sessions in various formats.",
  },
  {
    key: "copilotSdk",
    label: "Copilot SDK Bridge",
    description:
      "Enable the SDK bridge for real-time session steering, programmatic events, and direct communication with Copilot CLI.",
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
    <div class="settings-section-title">Experimental</div>
    <SectionPanel>
      <div
        v-for="flag in flags"
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
</template>
