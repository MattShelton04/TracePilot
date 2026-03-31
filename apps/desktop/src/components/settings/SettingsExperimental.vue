<script setup lang="ts">
import { FormSwitch, SectionPanel } from "@tracepilot/ui";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

const flags = [
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
] as const;
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
          @update:model-value="preferences.toggleFeature(flag.key)"
        />
      </div>
    </SectionPanel>
  </div>
</template>
