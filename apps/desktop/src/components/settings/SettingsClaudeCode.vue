<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import SettingsClaudeCodeCli from "@/components/settings/SettingsClaudeCodeCli.vue";
import SettingsClaudeCodeFolder from "@/components/settings/SettingsClaudeCodeFolder.vue";
import SettingsProviderSection from "@/components/settings/SettingsProviderSection.vue";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

const enabled = computed({
  get: () => preferences.isFeatureEnabled("claudeCodeSessions"),
  set: (value: boolean) => {
    if (value !== preferences.isFeatureEnabled("claudeCodeSessions")) {
      preferences.toggleFeature("claudeCodeSessions");
    }
  },
});

// Moving the folder reindexes, so hold it while an index is running.
const indexing = ref(false);
const { setup: setupIndexingEvents } = useIndexingEvents({
  onStarted: () => {
    indexing.value = true;
  },
  onProgress: () => {},
  onFinished: () => {
    indexing.value = false;
  },
});
onMounted(() => {
  void setupIndexingEvents();
});
</script>

<template>
  <SettingsProviderSection
    v-model:enabled="enabled"
    title="Claude Code"
    enable-label="Claude Code sessions"
    enable-description="Index and view Claude Code sessions from ~/.claude alongside Copilot CLI sessions. Turning this off removes them from the index; your Claude Code files are not changed."
  >
    <SettingsClaudeCodeFolder :disabled="indexing" />
    <SettingsClaudeCodeCli />
  </SettingsProviderSection>
</template>
