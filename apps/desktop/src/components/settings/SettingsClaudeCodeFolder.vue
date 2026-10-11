<script setup lang="ts">
import { getConfig, validateClaudeConfigDir } from "@tracepilot/client";
import { ActionButton, FormInput, toErrorMessage, useToast } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { usePreferencesStore } from "@/stores/preferences";
import { logWarn } from "@/utils/logger";

const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ saved: [] }>();

const preferencesStore = usePreferencesStore();
const toast = useToast();

const folder = ref("");
const savedFolder = ref("");
const loaded = ref(false);
const busy = ref(false);
const saving = ref(false);

const controlsDisabled = computed(() => props.disabled || busy.value || !loaded.value);
const dirty = computed(() => folder.value.trim() !== savedFolder.value);

onMounted(async () => {
  try {
    const config = await getConfig();
    folder.value = config.sources.claudeCode.configDir ?? "";
    savedFolder.value = folder.value;
    loaded.value = true;
  } catch (e) {
    logWarn("[SettingsClaudeCodeFolder] Failed to load config:", e);
    toast.error(`Failed to load the Claude Code folder: ${toErrorMessage(e)}`);
  }
});

async function browse() {
  if (controlsDisabled.value) return;
  busy.value = true;
  try {
    const selected = await browseForDirectory({
      title: "Select Claude Code folder",
      defaultPath: folder.value,
    });
    if (selected) folder.value = selected;
  } finally {
    busy.value = false;
  }
}

async function apply() {
  if (controlsDisabled.value || !dirty.value) return;
  const configDir = folder.value.trim();
  busy.value = true;
  saving.value = true;
  try {
    const result = await validateClaudeConfigDir(configDir);
    if (!result.valid) {
      toast.error(result.error ?? "The Claude Code folder is not valid.");
      return;
    }
    // Moving the folder replaces the indexed Claude Code sessions.
    const config = await preferencesStore.updateConfigFields({
      sources: { claudeCode: { configDir } },
    });
    savedFolder.value = config.sources.claudeCode.configDir ?? configDir;
    folder.value = savedFolder.value;
    emit("saved");
    toast.success(
      `Claude Code folder saved. Indexing ${result.sessionCount} session${result.sessionCount === 1 ? "" : "s"}.`,
    );
  } catch (e) {
    toast.error(`Failed to save the Claude Code folder: ${toErrorMessage(e)}`);
  } finally {
    busy.value = false;
    saving.value = false;
  }
}
</script>

<template>
  <div class="setting-row">
    <div class="setting-info">
      <label class="setting-label" for="settings-claude-code-folder">Claude Code folder</label>
      <div class="setting-description">
        Claude Code's config directory, which holds its <code>projects</code> folder. Defaults to
        <code>CLAUDE_CONFIG_DIR</code>, else <code>~/.claude</code>.
      </div>
    </div>
    <div class="setting-control-group">
      <FormInput
        id="settings-claude-code-folder"
        v-model="folder"
        :disabled="controlsDisabled"
        class="input-medium-mono"
      />
      <ActionButton
        size="sm"
        aria-label="Browse for Claude Code folder"
        :disabled="controlsDisabled"
        @click="browse"
      >
        Browse…
      </ActionButton>
      <ActionButton size="sm" :disabled="controlsDisabled || !dirty" @click="apply">
        {{ saving ? "Saving…" : "Apply" }}
      </ActionButton>
    </div>
  </div>
</template>
