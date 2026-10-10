<script setup lang="ts">
import { computed } from "vue";
import FormatDiagnosticsPanel from "@/components/settings/FormatDiagnosticsPanel.vue";
import {
  CLAUDE_CODE_FORMAT_DIAGNOSTICS,
  COPILOT_FORMAT_DIAGNOSTICS,
} from "@/components/settings/formatDiagnosticsGroups";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

const sources = computed(() =>
  preferences.isFeatureEnabled("claudeCodeSessions")
    ? [COPILOT_FORMAT_DIAGNOSTICS, CLAUDE_CODE_FORMAT_DIAGNOSTICS]
    : [COPILOT_FORMAT_DIAGNOSTICS],
);
</script>

<template>
  <div class="setting-row setting-row-stacked" data-testid="session-format-diagnostics">
    <div class="setting-info">
      <div class="setting-label">Session format diagnostics</div>
      <div class="setting-description">
        Event and record types TracePilot doesn't recognize yet, and the CLI versions that wrote
        your sessions, counted while indexing. Names and counts only, so they are safe to paste
        into an issue.
      </div>
    </div>
    <div class="format-panels">
      <FormatDiagnosticsPanel
        v-for="entry in sources"
        :key="entry.source"
        :source="entry.source"
        :title="entry.title"
        :groups="entry.groups"
      />
    </div>
  </div>
</template>

<style scoped>
.format-panels {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>
