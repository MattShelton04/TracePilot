<script setup lang="ts">
import { DEFAULT_CLAUDE_CLI_COMMAND } from "@tracepilot/types";
import { FormInput } from "@tracepilot/ui";
import { useCliCommandDraft } from "@/composables/useCliCommandDraft";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

// Blank means `claude`; a command the backend refuses stays an unsaved draft.
const { draft, invalid, update } = useCliCommandDraft(
  () => preferences.claudeCliCommand,
  (value) => {
    preferences.claudeCliCommand = value;
  },
);
</script>

<template>
  <div class="setting-row">
    <div class="setting-info">
      <label class="setting-label" for="settings-claude-code-cli">Claude Code command</label>
      <div class="setting-description">
        The command used to resume Claude Code sessions (e.g., <code>claude</code> or
        <code>npx claude</code>)
      </div>
      <p v-if="invalid" class="claude-cli-error" role="alert">
        Not saved: use only letters, digits, spaces and <code>- _ . / \ :</code>.
        Resume uses <code>{{ preferences.claudeCliCommand.trim() || DEFAULT_CLAUDE_CLI_COMMAND }}</code>
      </p>
    </div>
    <FormInput
      id="settings-claude-code-cli"
      :model-value="draft"
      @update:model-value="update"
      type="text"
      :placeholder="DEFAULT_CLAUDE_CLI_COMMAND"
      :aria-invalid="invalid"
      class="input-medium"
    />
  </div>
</template>

<style scoped>
.claude-cli-error {
  margin: 4px 0 0;
  color: var(--danger-fg);
  font-size: 0.75rem;
}
</style>
