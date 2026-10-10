<script setup lang="ts">
/**
 * Explains that Claude Code deletes its own transcripts after
 * `cleanupPeriodDays`, so they leave TracePilot too, and how to keep them
 * longer. Dismissal is remembered on this machine.
 */
import { ActionButton, Banner, useLocalStorage } from "@tracepilot/ui";
import { ExternalLink, History } from "lucide-vue-next";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { openExternal } from "@/utils/openExternal";

const CLEANUP_DOCS_URL = "https://code.claude.com/docs/en/settings-reference#cleanupperioddays";

const dismissed = useLocalStorage<boolean>(STORAGE_KEYS.claudeRetentionNoticeDismissed, false);
</script>

<template>
  <div v-if="!dismissed" class="setting-row claude-retention-row">
    <Banner
      tone="info"
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
</style>
