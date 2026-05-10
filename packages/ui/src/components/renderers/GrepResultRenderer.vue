<script setup lang="ts">
/**
 * GrepResultRenderer — renders grep tool results with grouped file matches,
 * amber pattern highlighting, context/match distinction, and separator gaps.
 */

import { File, Search } from "lucide-vue-next";
import { computed } from "vue";
import { normalizePath } from "../../utils/pathUtils";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const pattern = computed(() =>
  typeof props.args?.pattern === "string" ? props.args.pattern : null,
);

const outputMode = computed(() =>
  typeof props.args?.output_mode === "string" ? props.args.output_mode : "files_with_matches",
);

interface GrepMatch {
  file: string;
  lineNum?: number;
  text: string;
  isContext?: boolean;
}

const parsedMatches = computed<GrepMatch[]>(() => {
  if (!props.content) return [];
  const lines = props.content
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim());

  const results: GrepMatch[] = [];

  for (const line of lines) {
    if (line === "--") continue;

    const winMatchLine = line.match(/^([A-Za-z]:\\.+?):(\d+):(.*)$/);
    if (winMatchLine) {
      results.push({
        file: winMatchLine[1],
        lineNum: parseInt(winMatchLine[2], 10),
        text: winMatchLine[3],
        isContext: false,
      });
      continue;
    }

    const winCtxLine = line.match(/^([A-Za-z]:\\.+?)-(\d+)-(.*)$/);
    if (winCtxLine) {
      results.push({
        file: winCtxLine[1],
        lineNum: parseInt(winCtxLine[2], 10),
        text: winCtxLine[3],
        isContext: true,
      });
      continue;
    }

    const unixMatchLine = line.match(/^(.+?):(\d+):(.*)$/);
    if (unixMatchLine) {
      results.push({
        file: unixMatchLine[1],
        lineNum: parseInt(unixMatchLine[2], 10),
        text: unixMatchLine[3],
        isContext: false,
      });
      continue;
    }

    const unixCtxLine = line.match(/^(.+?)-(\d+)-(.*)$/);
    if (unixCtxLine && (unixCtxLine[1].includes("/") || unixCtxLine[1].includes("\\"))) {
      results.push({
        file: unixCtxLine[1],
        lineNum: parseInt(unixCtxLine[2], 10),
        text: unixCtxLine[3],
        isContext: true,
      });
      continue;
    }

    const winBare = line.match(/^([A-Za-z]:\\.+?):(.+)$/);
    if (winBare) {
      results.push({ file: winBare[1], text: winBare[2] });
      continue;
    }

    const unixBare = line.match(/^(.+?):(.+)$/);
    if (unixBare && (unixBare[1].includes("/") || unixBare[1].includes("\\"))) {
      results.push({ file: unixBare[1], text: unixBare[2] });
      continue;
    }

    results.push({ file: line.trim(), text: "", isContext: false });
  }

  return results;
});

const groupedByFile = computed(() => {
  const groups: Record<string, GrepMatch[]> = {};
  for (const m of parsedMatches.value) {
    const key = normalizePath(m.file);
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
});

const fileCount = computed(() => Object.keys(groupedByFile.value).length);
const matchCount = computed(() => {
  if (outputMode.value === "count") {
    return parsedMatches.value.reduce((sum, m) => {
      const n = parseInt(m.text, 10);
      return sum + (Number.isNaN(n) ? 1 : n);
    }, 0);
  }
  return parsedMatches.value.filter((m) => !m.isContext).length;
});

function highlightPattern(text: string): string {
  if (!pattern.value) return escapeHtml(text);
  try {
    return escapeHtml(text).replace(
      new RegExp(`(${escapeRegex(escapeHtml(pattern.value))})`, "gi"),
      '<span class="grep-highlight">$1</span>',
    );
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasGap(matches: GrepMatch[], idx: number): boolean {
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
    tool-name="Grep"
    status="success"
    :primary-hint="pattern ?? undefined"
    :copy-text="content"
  >
    <template #icon><Search :size="16" /></template>
    <div class="grep-result">
      <div class="grep-stats">
        <Search :size="12" class="grep-stat-icon" />
        <span class="grep-stat">{{ matchCount }} match{{ matchCount !== 1 ? 'es' : '' }}</span>
        <span class="grep-stat">in {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }}</span>
        <span v-if="outputMode !== 'files_with_matches'" class="grep-mode-badge">{{ outputMode }}</span>
      </div>

      <div v-if="outputMode === 'content'" class="grep-groups">
        <div v-for="(matches, _key) in groupedByFile" :key="_key" class="grep-file-group">
          <div class="grep-file-header">
            <File :size="12" class="grep-file-icon" />
            <span class="grep-file-path">{{ matches[0]?.file ?? _key }}</span>
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
      </div>

      <div v-else-if="outputMode === 'count'" class="grep-file-list">
        <div v-for="m in parsedMatches" :key="m.file" class="grep-file-item">
          <File :size="12" class="grep-file-icon" />
          <span class="grep-file-path">{{ m.file }}</span>
          <span v-if="m.text" class="grep-file-count">{{ m.text }}</span>
        </div>
      </div>

      <div v-else class="grep-file-list">
        <div v-for="m in parsedMatches" :key="m.file" class="grep-file-item">
          <File :size="12" class="grep-file-icon" />
          <span class="grep-file-path">{{ m.file }}</span>
        </div>
      </div>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
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
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.grep-stat-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.grep-stat {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.grep-mode-badge {
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--accent-muted);
  color: var(--accent-fg);
}
.grep-groups {
  max-height: 500px;
  overflow: auto;
}
.grep-file-group {
  border-bottom: 1px solid var(--border-muted);
}
.grep-file-group:last-child { border-bottom: none; }
.grep-file-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--canvas-inset);
}
.grep-file-icon {
  color: var(--text-tertiary);
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
.grep-matches { padding: 2px 0; }
.grep-separator {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.625rem;
  padding: 2px 0;
  opacity: 0.5;
}
.grep-match-line {
  display: flex;
  padding: 1px 12px;
  background: var(--warning-subtle);
}
.grep-match-line:hover { background: var(--warning-muted); }
.grep-match-line--context {
  background: transparent;
  opacity: 0.6;
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
  opacity: 0.5;
}
.grep-line-text {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}
.grep-line-text :deep(.grep-highlight) {
  background: var(--warning-muted);
  color: var(--warning-fg);
  border-radius: 2px;
  padding: 0 1px;
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
.grep-file-item:hover { background: var(--neutral-muted); }
</style>
