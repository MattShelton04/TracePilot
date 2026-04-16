<script setup lang="ts">
/**
 * EditDiffRenderer — renders edit tool results as a rich diff view.
 *
 * Features: unified/split toggle, line numbers, full-line backgrounds,
 * word-level inline highlights, and a "Modified" badge.
 */
import { computed, ref } from "vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const diffMode = ref<"unified" | "split">("unified");

const filePath = computed(() => {
  if (typeof props.args?.path === "string") return props.args.path;
  return undefined;
});

const oldStr = computed(() =>
  typeof props.args?.old_str === "string" ? props.args.old_str : null,
);

const newStr = computed(() =>
  typeof props.args?.new_str === "string" ? props.args.new_str : null,
);

const isDelete = computed(() => oldStr.value != null && !newStr.value);

// ── Line-level diff for unified/split views ──

interface DiffLine {
  type: "context" | "added" | "removed";
  oldNum?: number;
  newNum?: number;
  content: string;
}

/** Strip trailing empty entry from split (common for content ending with \n). */
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Convert word-level segments into line-level diff entries. */
const diffLines = computed<DiffLine[]>(() => {
  if (oldStr.value == null || newStr.value == null) return [];

  const oldLines = splitLines(oldStr.value);
  const newLines = splitLines(newStr.value);
  const lines: DiffLine[] = [];

  // Simple line-based diff using LCS on lines
  const m = oldLines.length;
  const n = newLines.length;

  if (m * n > 1_000_000) {
    // Too large — just show all old as removed, all new as added
    oldLines.forEach((l, i) => {
      lines.push({ type: "removed", oldNum: i + 1, content: l });
    });
    newLines.forEach((l, i) => {
      lines.push({ type: "added", newNum: i + 1, content: l });
    });
    return lines;
  }

  // Line-level LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const stack: DiffLine[] = [];
  let oi = m,
    ni = n;
  while (oi > 0 || ni > 0) {
    if (oi > 0 && ni > 0 && oldLines[oi - 1] === newLines[ni - 1]) {
      stack.push({ type: "context", oldNum: oi, newNum: ni, content: oldLines[oi - 1] });
      oi--;
      ni--;
    } else if (ni > 0 && (oi === 0 || dp[oi][ni - 1] >= dp[oi - 1][ni])) {
      stack.push({ type: "added", newNum: ni, content: newLines[ni - 1] });
      ni--;
    } else {
      stack.push({ type: "removed", oldNum: oi, content: oldLines[oi - 1] });
      oi--;
    }
  }

  stack.reverse();
  return stack;
});

const oldLineCount = computed(() => (oldStr.value ? splitLines(oldStr.value).length : 0));
const newLineCount = computed(() => (newStr.value ? splitLines(newStr.value).length : 0));

/** Actual diff stats based on LCS result, not raw line counts. */
const addedCount = computed(() => diffLines.value.filter((l) => l.type === "added").length);
const removedCount = computed(() => diffLines.value.filter((l) => l.type === "removed").length);
const contextCount = computed(() => diffLines.value.filter((l) => l.type === "context").length);

/** When all old lines appear as context (no removals), the edit only added new content. */
const isPureAddition = computed(() => removedCount.value === 0 && addedCount.value > 0);

/** Badge text based on the kind of edit. */
const editBadgeText = computed(() => {
  if (isDelete.value) return "Deleted";
  if (isPureAddition.value) return "Extended";
  if (addedCount.value === 0 && removedCount.value > 0) return "Trimmed";
  return "Modified";
});
const editBadgeClass = computed(() => {
  if (isDelete.value) return "edit-diff-badge--deleted";
  if (isPureAddition.value) return "edit-diff-badge--added";
  return "edit-diff-badge--modified";
});

/** Split view: left (old) lines and right (new) lines aligned. */
const splitPairs = computed(() => {
  const pairs: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  const removedQueue: DiffLine[] = [];
  const addedQueue: DiffLine[] = [];

  function flushQueues() {
    const max = Math.max(removedQueue.length, addedQueue.length);
    for (let i = 0; i < max; i++) {
      pairs.push({
        left: removedQueue[i] ?? null,
        right: addedQueue[i] ?? null,
      });
    }
    removedQueue.length = 0;
    addedQueue.length = 0;
  }

  for (const line of diffLines.value) {
    if (line.type === "removed") {
      removedQueue.push(line);
    } else if (line.type === "added") {
      addedQueue.push(line);
    } else {
      flushQueues();
      pairs.push({ left: line, right: line });
    }
  }
  flushQueues();
  return pairs;
});

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}
</script>

<template>
  <RendererShell
    :label="filePath ? fileName(filePath) : 'Edit'"
    :copy-content="newStr ?? content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <!-- File path + badge + diff mode tabs -->
    <div class="edit-diff-header">
      <div class="edit-diff-path-group">
        <span v-if="filePath" class="edit-diff-path" :title="filePath">
          <span class="edit-diff-path-icon">📄</span>
          {{ filePath }}
        </span>
        <span class="edit-diff-badge" :class="editBadgeClass">{{ editBadgeText }}</span>
      </div>
      <div v-if="oldStr != null && newStr != null" class="edit-diff-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="diffMode === 'unified'"
          :class="['edit-diff-tab', { active: diffMode === 'unified' }]"
          @click="diffMode = 'unified'"
        >Unified</button>
        <button
          type="button"
          role="tab"
          :aria-selected="diffMode === 'split'"
          :class="['edit-diff-tab', { active: diffMode === 'split' }]"
          @click="diffMode = 'split'"
        >Split</button>
      </div>
    </div>

    <!-- Stats bar -->
    <div v-if="oldStr != null || isDelete" class="edit-diff-stats">
      <span v-if="removedCount > 0" class="edit-diff-stat edit-diff-stat--removed">−{{ removedCount }} line{{ removedCount !== 1 ? 's' : '' }}</span>
      <span v-if="addedCount > 0" class="edit-diff-stat edit-diff-stat--added">+{{ addedCount }} line{{ addedCount !== 1 ? 's' : '' }}</span>
      <span v-if="contextCount > 0" class="edit-diff-stat edit-diff-stat--context">{{ contextCount }} unchanged</span>
      <span v-if="isDelete" class="edit-diff-stat edit-diff-stat--removed">deleted</span>
    </div>

    <!-- Unified diff view -->
    <div v-if="oldStr != null && newStr != null && diffMode === 'unified'" class="edit-diff-body">
      <table class="diff-table" role="presentation">
        <tbody>
          <tr v-for="(line, idx) in diffLines" :key="idx" :class="['diff-line', `diff-line--${line.type}`]">
            <td class="diff-num diff-num--old">{{ line.oldNum ?? '' }}</td>
            <td class="diff-num diff-num--new">{{ line.newNum ?? '' }}</td>
            <td class="diff-indicator">
              <span v-if="line.type === 'removed'">−</span>
              <span v-else-if="line.type === 'added'">+</span>
              <span v-else>&nbsp;</span>
            </td>
            <td class="diff-code"><pre>{{ line.content }}</pre></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Split diff view -->
    <div v-else-if="oldStr != null && newStr != null && diffMode === 'split'" class="edit-diff-body">
      <div class="diff-split">
        <table class="diff-table diff-table--half" role="presentation">
          <tbody>
            <tr v-for="(pair, idx) in splitPairs" :key="'l-' + idx"
                :class="['diff-line', pair.left ? `diff-line--${pair.left.type}` : 'diff-line--empty']">
              <td class="diff-num">{{ pair.left?.oldNum ?? '' }}</td>
              <td class="diff-indicator">
                <span v-if="pair.left?.type === 'removed'">−</span>
                <span v-else>&nbsp;</span>
              </td>
              <td class="diff-code"><pre>{{ pair.left?.content ?? '' }}</pre></td>
            </tr>
          </tbody>
        </table>
        <table class="diff-table diff-table--half" role="presentation">
          <tbody>
            <tr v-for="(pair, idx) in splitPairs" :key="'r-' + idx"
                :class="['diff-line', pair.right ? `diff-line--${pair.right.type}` : 'diff-line--empty']">
              <td class="diff-num">{{ pair.right?.newNum ?? '' }}</td>
              <td class="diff-indicator">
                <span v-if="pair.right?.type === 'added'">+</span>
                <span v-else>&nbsp;</span>
              </td>
              <td class="diff-code"><pre>{{ pair.right?.content ?? '' }}</pre></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Delete-only case -->
    <div v-else-if="isDelete && oldStr" class="edit-diff-body">
      <table class="diff-table" role="presentation">
        <tbody>
          <tr v-for="(line, idx) in oldStr.split('\n')" :key="idx" class="diff-line diff-line--removed">
            <td class="diff-num">{{ idx + 1 }}</td>
            <td class="diff-indicator">−</td>
            <td class="diff-code"><pre>{{ line }}</pre></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Fallback: show raw content -->
    <pre v-else class="edit-diff-fallback">{{ content }}</pre>
  </RendererShell>
</template>

<style scoped>
.edit-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-muted);
  background: rgba(255, 255, 255, 0.02);
}
.edit-diff-path-group {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.edit-diff-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.edit-diff-path-icon {
  margin-right: 4px;
}
.edit-diff-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}
.edit-diff-badge--modified {
  background: rgba(251, 191, 36, 0.15);
  color: var(--warning-fg, #fbbf24);
}
.edit-diff-badge--added {
  background: rgba(52, 211, 153, 0.15);
  color: var(--success-fg, #34d399);
}
.edit-diff-badge--deleted {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger-fg, #f87171);
}
.edit-diff-tabs {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.edit-diff-tab {
  font-size: 0.625rem;
  font-weight: 500;
  padding: 2px 8px;
  border: 1px solid var(--border-muted);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
}
.edit-diff-tab:hover {
  background: var(--neutral-muted);
  color: var(--text-secondary);
}
.edit-diff-tab.active {
  background: var(--accent-muted, rgba(99, 102, 241, 0.15));
  color: var(--accent-fg, #818cf8);
  border-color: var(--accent-emphasis, #6366f1);
}
.edit-diff-stats {
  display: flex;
  gap: 10px;
  padding: 4px 12px;
  font-size: 0.6875rem;
  border-bottom: 1px solid var(--border-muted);
}
.edit-diff-stat {
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}
.edit-diff-stat--removed { color: var(--danger-fg, #f87171); }
.edit-diff-stat--added { color: var(--success-fg, #34d399); }
.edit-diff-stat--context { color: var(--text-tertiary); }
.edit-diff-body {
  overflow: auto;
  max-height: 500px;
}

/* ── Diff table ── */
.diff-table {
  border-collapse: collapse;
  width: 100%;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
}
.diff-line { border: none; }
.diff-line--context { background: transparent; }
.diff-line--removed { background: rgba(251, 113, 133, 0.08); }
.diff-line--added { background: rgba(52, 211, 153, 0.08); }
.diff-line--empty { background: var(--canvas-inset); }
.diff-num {
  text-align: right;
  padding: 0 6px;
  color: var(--text-tertiary);
  opacity: 0.5;
  user-select: none;
  vertical-align: top;
  white-space: nowrap;
  width: 1%;
  min-width: 3ch;
}
.diff-indicator {
  width: 1%;
  padding: 0 4px;
  text-align: center;
  user-select: none;
  vertical-align: top;
}
.diff-line--removed .diff-indicator { color: var(--danger-fg, #f87171); }
.diff-line--added .diff-indicator { color: var(--success-fg, #34d399); }
.diff-line--context .diff-indicator { color: var(--text-tertiary); }
.diff-code {
  padding: 0 12px;
  white-space: pre;
}
.diff-code pre {
  margin: 0;
  font: inherit;
  white-space: pre;
}
.diff-line--removed .diff-code { color: var(--danger-fg, #f87171); }
.diff-line--added .diff-code { color: var(--success-fg, #34d399); }
.diff-line--context .diff-code { color: var(--text-secondary); }

/* ── Split view ── */
.diff-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
.diff-split .diff-table--half {
  border-right: 1px solid var(--border-muted);
}
.diff-split .diff-table--half:last-child {
  border-right: none;
}

.edit-diff-fallback {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 10px 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 400px;
  overflow: auto;
}
</style>
