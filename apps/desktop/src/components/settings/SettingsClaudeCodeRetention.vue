<script setup lang="ts">
/**
 * Explains that Claude Code deletes its own transcripts after
 * `cleanupPeriodDays`, so they leave TracePilot too, and how to keep them
 * longer. Shows the value in the user settings file, and warns when it is
 * low or invalid. Dismissal is remembered on this machine.
 */
import { type ClaudeCleanupPeriod, getClaudeCleanupPeriod } from "@tracepilot/client";
import { ActionButton, Banner, useAsyncGuard, useLocalStorage } from "@tracepilot/ui";
import { ExternalLink, History } from "lucide-vue-next";
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { logWarn } from "@/utils/logger";
import { openExternal } from "@/utils/openExternal";

const CLEANUP_DOCS_URL = "https://code.claude.com/docs/en/settings-reference#cleanupperioddays";
const DEFAULT_DAYS = 30;

const dismissed = useLocalStorage<boolean>(STORAGE_KEYS.claudeRetentionNoticeDismissed, false);

const period = shallowRef<ClaudeCleanupPeriod | null>(null);
const failed = shallowRef(false);
const guard = useAsyncGuard();
onBeforeUnmount(() => guard.invalidate());

async function load() {
  const token = guard.start();
  failed.value = false;
  try {
    const result = await getClaudeCleanupPeriod();
    if (guard.isValid(token)) period.value = result ?? null;
  } catch (e) {
    logWarn("[SettingsClaudeCodeRetention] Failed to read cleanupPeriodDays:", e);
    if (guard.isValid(token)) failed.value = true;
  }
}

// Read the file only while the notice shows.
watch(
  dismissed,
  (hidden) => {
    if (!hidden) void load();
  },
  { immediate: true },
);

/** The value in bold, then what it means; `warn` turns the notice amber. */
const readout = computed(() => {
  if (failed.value) return { value: "unknown", note: ".", warn: false };
  const result = period.value;
  if (!result) return null;
  const days = result.days ?? 0;
  const fallback = `, so the default of ${DEFAULT_DAYS} days applies.`;
  switch (result.state) {
    case "set":
      if (days < 1) {
        return {
          value: `${days} days`,
          note: ". Claude Code rejects values below 1; use a large value instead.",
          warn: true,
        };
      }
      return {
        value: `${days} ${days === 1 ? "day" : "days"}`,
        note: days < DEFAULT_DAYS ? `, shorter than the ${DEFAULT_DAYS}-day default.` : ".",
        warn: days < DEFAULT_DAYS,
      };
    case "notSet":
      return { value: "not set", note: fallback, warn: false };
    case "noFile":
      return { value: "not set", note: ` (no settings file)${fallback}`, warn: false };
    case "valueInvalid":
      return {
        value: "not a whole number of days",
        note: ". Claude Code may reject it.",
        warn: true,
      };
    case "fileInvalid":
      return {
        value: "unknown",
        note: ". The settings file couldn't be read as JSON.",
        warn: true,
      };
  }
  return null;
});
</script>

<template>
  <div v-if="!dismissed" class="setting-row claude-retention-row">
    <Banner
      :tone="readout?.warn ? 'warning' : 'info'"
      title="Older sessions disappear"
      role="note"
      dismissible
      class="claude-retention-notice"
      @dismiss="dismissed = true"
    >
      <template #icon><History :size="16" :stroke-width="1.5" /></template>
      Claude Code deletes transcripts older than <code>cleanupPeriodDays</code> (default 30
      days), so they leave TracePilot too. To keep them longer, raise it (e.g.
      <code>3650</code>) in <code>~/.claude/settings.json</code>, or <code>settings.json</code> in
      <code>CLAUDE_CONFIG_DIR</code>.
      <span v-if="readout" class="claude-retention-readout" data-testid="claude-cleanup-readout">
        Your current setting: <strong>{{ readout.value }}</strong>{{ readout.note }}
        <template v-if="period && !failed">
          Checked <code class="claude-retention-file">{{ period.file }}</code>; project and
          managed settings can override it.
        </template>
      </span>
      <template #actions>
        <ActionButton size="sm" variant="ghost" @click="openExternal(CLEANUP_DOCS_URL)">
          Claude Code docs
          <ExternalLink :size="12" :stroke-width="1.5" aria-hidden="true" />
        </ActionButton>
      </template>
    </Banner>
  </div>
</template>

<style scoped>
.claude-retention-notice {
  flex: 1;
  min-width: 0;
}

.claude-retention-notice code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.claude-retention-readout {
  display: block;
  margin-top: 8px;
}

.claude-retention-file {
  overflow-wrap: anywhere;
}
</style>
