<script setup lang="ts">
/**
 * GrepResultRenderer — renders grep tool results with grouped file matches.
 */
import { computed } from "vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  'load-full': [];
}>();

const pattern = computed(() =>
  typeof props.args?.pattern === "string" ? props.args.pattern : null
);

const outputMode = computed(() =>
  typeof props.args?.output_mode === "string" ? props.args.output_mode : "files_with_matches"
);

interface GrepMatch {
  file: string;
  lineNum?: number;
  text: string;
}

/** Parse grep output into structured matches. */
const parsedMatches = computed<GrepMatch[]>(() => {
  if (!props.content) return [];
  const lines = props.content.split("\n").filter(l => l.trim());

  return lines.map(line => {
    // Try to parse "file:line:content" format (handles Windows drive letters)
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      return { file: match[1], lineNum: parseInt(match[2]), text: match[3] };
    }
    // Try Windows drive-letter paths first: "C:\...:content"
    const winMatch = line.match(/^([A-Za-z]:\\.+?):(.+)$/);
    if (winMatch) {
      return { file: winMatch[1], text: winMatch[2] };
    }
    // Try "file:content" (no line numbers) — require path separators
    const match2 = line.match(/^(.+?):(.+)$/);
    if (match2 && (match2[1].includes("/") || match2[1].includes("\\"))) {
      return { file: match2[1], text: match2[2] };
    }
    // Plain file path
    return { file: line, text: "" };
  });
});

/** Group matches by file. */
const groupedByFile = computed(() => {
  const groups: Record<string, GrepMatch[]> = {};
  for (const m of parsedMatches.value) {
    if (!groups[m.file]) groups[m.file] = [];
    groups[m.file].push(m);
  }
  return groups;
});

const fileCount = computed(() => Object.keys(groupedByFile.value).length);
const matchCount = computed(() => {
  if (outputMode.value === "count") {
    // In count mode, text contains the per-file count — sum them
    return parsedMatches.value.reduce((sum, m) => {
      const n = parseInt(m.text);
      return sum + (isNaN(n) ? 1 : n);
    }, 0);
  }
  return parsedMatches.value.length;
});
</script>

<template>
  <RendererShell
    :label="pattern ? `grep /${pattern}/` : 'Grep Results'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="grep-result">
      <div class="grep-stats">
        <span class="grep-stat">🔍 {{ matchCount }} match{{ matchCount !== 1 ? 'es' : '' }}</span>
        <span class="grep-stat">in {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }}</span>
        <span v-if="outputMode !== 'files_with_matches'" class="grep-mode-badge">{{ outputMode }}</span>
      </div>

      <!-- File-grouped results (content mode) -->
      <div v-if="outputMode === 'content'" class="grep-groups">
        <div v-for="(matches, file) in groupedByFile" :key="file" class="grep-file-group">
          <div class="grep-file-header">
            <span class="grep-file-icon">📄</span>
            <span class="grep-file-path">{{ file }}</span>
            <span class="grep-file-count">{{ matches.length }}</span>
          </div>
          <div class="grep-matches">
            <div v-for="(m, idx) in matches" :key="idx" class="grep-match-line">
              <span v-if="m.lineNum" class="grep-line-num">{{ m.lineNum }}</span>
              <span class="grep-line-text">{{ m.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Count mode: show per-file match counts -->
      <div v-else-if="outputMode === 'count'" class="grep-file-list">
        <div v-for="m in parsedMatches" :key="m.file" class="grep-file-item">
          <span class="grep-file-icon">📄</span>
          <span class="grep-file-path">{{ m.file }}</span>
          <span v-if="m.text" class="grep-file-count">{{ m.text }}</span>
        </div>
      </div>

      <!-- File list mode (files_with_matches) -->
      <div v-else class="grep-file-list">
        <div v-for="m in parsedMatches" :key="m.file" class="grep-file-item">
          <span class="grep-file-icon">📄</span>
          <span class="grep-file-path">{{ m.file }}</span>
        </div>
      </div>
    </div>
  </RendererShell>
</template>

<style scoped>
.grep-result {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
}
.grep-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.grep-stat {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.grep-mode-badge {
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--accent-muted, rgba(99, 102, 241, 0.15));
  color: var(--accent-fg, #818cf8);
}
.grep-groups {
  max-height: 500px;
  overflow: auto;
}
.grep-file-group {
  border-bottom: 1px solid var(--border-muted);
}
.grep-file-group:last-child {
  border-bottom: none;
}
.grep-file-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--canvas-inset);
}
.grep-file-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}
.grep-file-path {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.grep-file-count {
  font-size: 0.625rem;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--neutral-muted);
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.grep-matches {
  padding: 2px 0;
}
.grep-match-line {
  display: flex;
  padding: 1px 12px;
}
.grep-match-line:hover {
  background: var(--neutral-muted);
}
.grep-line-num {
  color: var(--text-tertiary);
  width: 4ch;
  text-align: right;
  padding-right: 10px;
  flex-shrink: 0;
  opacity: 0.6;
}
.grep-line-text {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}
.grep-file-list {
  max-height: 400px;
  overflow: auto;
}
.grep-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
}
.grep-file-item:hover {
  background: var(--neutral-muted);
}
</style>
