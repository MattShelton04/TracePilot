<script setup lang="ts">
import { DEFAULT_CLAUDE_CLI_COMMAND } from "@tracepilot/types";
import { FormInput } from "@tracepilot/ui";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();
</script>

<template>
  <div class="setting-row">
    <div class="setting-info">
      <label class="setting-label" for="settings-claude-code-cli">Claude Code command</label>
      <div class="setting-description">
        The command used to resume Claude Code sessions (e.g., <code>claude</code> or
        <code>npx claude</code>)
      </div>
    </div>
    <FormInput
      id="settings-claude-code-cli"
      :model-value="preferences.claudeCliCommand"
      @update:model-value="preferences.claudeCliCommand = String($event)"
      type="text"
      :placeholder="DEFAULT_CLAUDE_CLI_COMMAND"
      class="input-medium"
    />
  </div>
</template>
