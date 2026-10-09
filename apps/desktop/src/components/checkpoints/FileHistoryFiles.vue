<script setup lang="ts">
/**
 * FileHistoryFiles — the tracked files of one file-history checkpoint, with
 * an inline read-only viewer for the version the user opens.
 */
import type { FileCheckpoint, FileVersion, FileVersionContent } from "@tracepilot/client";
import { Badge, CodeBlock, formatTime } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  checkpoint: FileCheckpoint;
  /** `<checkpoint>:<backup>` of the open version, if any. */
  openKey: string | null;
  content: FileVersionContent | null;
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  toggle: [key: string, backup: string];
}>();

const changed = computed(() => props.checkpoint.files.filter((file) => file.changed).length);

function keyOf(file: FileVersion): string {
  return `${props.checkpoint.number}:${file.backup}`;
}
</script>

<template>
  <p class="fh-meta">
    <template v-if="checkpoint.timestamp">{{ formatTime(checkpoint.timestamp) }} · </template>
    {{ checkpoint.files.length }} tracked, {{ changed }} changed
  </p>
  <ul class="fh-files" aria-label="Tracked files">
    <li v-for="file in checkpoint.files" :key="file.path" class="fh-file" data-testid="file-history-file">
      <div class="fh-file-row">
        <span class="fh-path" :title="file.path">{{ file.path }}</span>
        <Badge v-if="file.backup == null" variant="neutral" size="sm">Not created yet</Badge>
        <Badge v-else-if="file.changed" variant="accent" size="sm">Changed</Badge>
        <span v-if="file.version != null" class="fh-version">v{{ file.version }}</span>
        <button
          v-if="file.backup"
          class="fh-view"
          :aria-expanded="openKey === keyOf(file)"
          @click="emit('toggle', keyOf(file), file.backup)"
        >
          {{ openKey === keyOf(file) ? "Hide" : "View" }}
        </button>
      </div>
      <div v-if="file.backup && openKey === keyOf(file)" class="fh-viewer">
        <p v-if="loading" class="fh-status">Loading…</p>
        <p v-else-if="error" class="fh-status fh-status--error">{{ error }}</p>
        <p v-else-if="content?.binary" class="fh-status">Binary file; no preview.</p>
        <template v-else-if="content">
          <CodeBlock :code="content.content" :file-path="file.path" />
          <p v-if="content.truncated" class="fh-status">Showing the first 1 MiB.</p>
        </template>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.fh-meta,
.fh-status {
  margin: 0 0 8px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.fh-status--error {
  color: var(--danger-fg);
}

.fh-files {
  list-style: none;
  margin: 0;
  padding: 0;
}

.fh-file {
  border-bottom: 1px solid var(--border-subtle);
}

.fh-file:last-child {
  border-bottom: none;
}

.fh-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.fh-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-primary);
}

.fh-version {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.fh-view {
  padding: 2px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.fh-view:hover {
  color: var(--text-primary);
  background: var(--surface-secondary);
}

.fh-viewer {
  padding: 4px 0 8px;
}
</style>
