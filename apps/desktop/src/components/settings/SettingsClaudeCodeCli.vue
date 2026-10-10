<script setup lang="ts">
import { DEFAULT_CLAUDE_CLI_COMMAND } from "@tracepilot/types";
import { FormInput } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

/**
 * The characters `validate_cli_command` accepts (Unicode letters and digits
 * are a subset of its rule), so autosave never sends a command the backend
 * refuses. Blank means `claude`.
 */
const SAFE_COMMAND = /^[\p{L}\p{N}\-_./\\ :]*$/u;

const draft = ref(preferences.claudeCliCommand);
watch(
  () => preferences.claudeCliCommand,
  (value) => {
    draft.value = value;
  },
);
const invalid = computed(() => !SAFE_COMMAND.test(draft.value));

function update(value: unknown) {
  draft.value = String(value);
  if (!invalid.value) preferences.claudeCliCommand = draft.value;
}
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
        Not saved: use only letters, digits, spaces and <code>- _ . / \ :</code>
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
