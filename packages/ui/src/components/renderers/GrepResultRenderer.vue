<script setup lang="ts">
/**
 * GrepResultRenderer — renders grep tool results with grouped file matches,
 * amber pattern highlighting, context/match distinction, and separator gaps.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { File, Search } from "lucide-vue-next";
import { computed } from "vue";
import { normalizePath } from "../../utils/pathUtils";
import { toolCallStatus } from "../../utils/toolCallStatus";
import { parseSearchResults, type SearchMatch } from "../../utils/toolSearchResults";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
  tc?: TurnToolCall;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const pattern = computed(() =>
  typeof props.args?.pattern === "string" ? props.args.pattern : null,
);

const outputMode = computed(() => {
  const value = props.args?.output_mode;
  return value === "count" || value === "content" || value === "files_with_matches"
    ? value
    : "files_with_matches";
});

const status = computed(() => toolCallStatus(props.tc));
const parsed = computed(() => parseSearchResults(props.content, outputMode.value));
const parsedMatches = computed(() => parsed.value.matches);
const groupedByFile = computed(() => {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of parsedMatches.value) {
    const key = normalizePath(match.file);
    const rows = groups.get(key) ?? [];
    rows.push(match);
    groups.set(key, rows);
  }
  return [...groups.entries()].map(([file, matches]) => ({ file, matches }));
});
const fileCount = computed(() => groupedByFile.value.length);
const matchCount = computed(() =>
  outputMode.value === "count"
    ? parsedMatches.value.reduce((sum, match) => sum + Number(match.text), 0)
    : parsedMatches.value.filter((match) => !match.isContext).length,
);
const literalPattern = computed(() =>
  pattern.value &&
  (props.args?.["-F"] === true ||
    props.args?.fixed_strings === true ||
    !/[.*+?^${}()|[\]\\]/.test(pattern.value))
    ? pattern.value
    : null,
);

function highlightPattern(text: string): string {
  const literal = literalPattern.value;
  if (!literal) return escapeHtml(text);
  const insensitive = props.args?.["-i"] === true || props.args?.ignore_case === true;
  const lower = insensitive ? text.toLocaleLowerCase() : text;
  const needle = insensitive ? literal.toLocaleLowerCase() : literal;
  let cursor = 0;
  let match = lower.indexOf(needle);
  let html = "";
  while (match >= 0) {
    html += escapeHtml(text.slice(cursor, match));
    html += `<mark class="grep-highlight">${escapeHtml(text.slice(match, match + literal.length))}</mark>`;
    cursor = match + literal.length;
    match = lower.indexOf(needle, cursor);
  }
  return html + escapeHtml(text.slice(cursor));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasGap(matches: SearchMatch[], idx: number): boolean {
  if (idx === 0) return false;
  const prev = matches[idx - 1];
  const curr = matches[idx];
  if (prev.lineNum != null && curr.lineNum != null) {
    return curr.lineNum - prev.lineNum > 1;
  }
  return false;
}
</script>

<template>
  <RendererShell
     :tool-name="tc?.toolName === 'rg' ? 'Ripgrep' : 'Grep'"
    :status="status"
    :primary-hint="pattern ?? undefined"
    :copy-text="content"
  >
    <template #icon><Search :size="16" /></template>
    <div class="grep-result">
      <div class="grep-stats">
        <Search :size="12" class="grep-stat-icon" />
        <template v-if="outputMode !== 'files_with_matches'">
          <span class="grep-stat">{{ matchCount }} match{{ matchCount !== 1 ? 'es' : '' }}</span>
          <span class="grep-stat">in {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }}</span>
        </template>
        <span v-else class="grep-stat">{{ fileCount }} matching file{{ fileCount !== 1 ? 's' : '' }}</span>
        <span v-if="outputMode !== 'files_with_matches'" class="grep-mode-badge">{{ outputMode }}</span>
      </div>

      <RendererScrollRegion v-if="outputMode === 'content'" class="grep-groups" label="search results">
        <div v-for="{file, matches} in groupedByFile" :key="file" class="grep-file-group">
          <div class="grep-file-header">
            <File :size="12" class="grep-file-icon" />
            <span class="grep-file-path" :title="matches[0]?.file">{{ matches[0]?.file ?? file }}</span>
            <span class="grep-file-count">{{ matches.filter(m => !m.isContext).length }}</span>
          </div>
          <div class="grep-matches">
            <template v-for="(m, idx) in matches" :key="idx">
              <div v-if="hasGap(matches, idx)" class="grep-separator">⋯</div>
              <div :class="['grep-match-line', { 'grep-match-line--context': m.isContext }]">
                <span v-if="m.lineNum" class="grep-line-num">{{ m.lineNum }}</span>
                <!-- eslint-disable vue/no-v-html -->
                <span class="grep-line-text" v-html="highlightPattern(m.text)"></span>
              </div>
            </template>
          </div>
        </div>
      </RendererScrollRegion>

      <RendererScrollRegion v-else-if="outputMode === 'count'" class="grep-file-list" label="search results">
        <div v-for="(m, idx) in parsedMatches" :key="`${m.file}-${idx}`" class="grep-file-item">
          <File :size="12" class="grep-file-icon" />
          <span class="grep-file-path" :title="m.file">{{ m.file }}</span>
          <span v-if="m.text" class="grep-file-count">{{ m.text }}</span>
        </div>
      </RendererScrollRegion>

      <RendererScrollRegion v-else class="grep-file-list" label="search results">
        <div v-for="(m, idx) in parsedMatches" :key="`${m.file}-${idx}`" class="grep-file-item">
          <File :size="12" class="grep-file-icon" />
          <span class="grep-file-path" :title="m.file">{{ m.file }}</span>
        </div>
      </RendererScrollRegion>
      <p v-if="!parsedMatches.length && !parsed.notices.length" class="grep-empty">No matches found.</p>
      <pre v-if="parsed.notices.length" class="grep-notices">{{ parsed.notices.join('\n') }}</pre>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.grep-result {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
}
.grep-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.grep-stat-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.grep-stat {
  font-size: 12px;
  color: var(--text-tertiary);
}
.grep-mode-badge {
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--accent-muted);
  color: var(--accent-fg);
}
.grep-groups { min-width: 0; }
.grep-file-group {
  border-bottom: 1px solid var(--border-muted);
}
.grep-file-group:last-child { border-bottom: none; }
.grep-file-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--canvas-inset);
}
.grep-file-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.grep-file-path {
  color: var(--text-secondary);
  min-width: 0;
  overflow-wrap: anywhere;
  flex: 1;
}
.grep-file-count {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 0 6px;
  height: 16px;
  line-height: 16px;
  border-radius: 9999px;
  background: var(--warning-subtle);
  color: var(--warning-fg);
  flex-shrink: 0;
}
.grep-matches { padding: 4px 0; overflow-x: auto; }
.grep-separator {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.625rem;
  padding: 2px 0;

}
.grep-match-line {
  display: flex;
  min-width: max-content;
  padding: 2px 12px;
  background: var(--warning-subtle);
}
.grep-match-line:hover { background: var(--warning-muted); }
.grep-match-line--context {
  background: transparent;

}
.grep-match-line--context:hover {
  background: var(--neutral-muted);
  opacity: 0.8;
}
.grep-line-num {
  color: var(--text-tertiary);
  width: 4ch;
  text-align: right;
  padding-right: 10px;
  flex-shrink: 0;

}
.grep-line-text {
  white-space: pre;
  color: var(--text-secondary);
}
.grep-line-text :deep(.grep-highlight) {
  background: var(--warning-muted);
  color: var(--warning-fg);
  border-radius: 2px;
  padding: 0 1px;
}
.grep-file-list { min-width: 0; }
.grep-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
}
.grep-file-item:hover { background: var(--neutral-muted); }
.grep-notices, .grep-empty { margin: 0; padding: 12px; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.grep-stats { flex-wrap: wrap; }
</style>
