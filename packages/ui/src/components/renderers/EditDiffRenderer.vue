<script setup lang="ts">
/**
 * EditDiffRenderer — renders edit tool results as a rich diff view.
 *
 * Features: unified/split toggle, line numbers, full-line backgrounds,
 * and a "Modified" badge.
 */

import { FileEdit } from "lucide-vue-next";
import { computed, ref } from "vue";
import RendererShell from "../RendererShell.vue";

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

interface DiffLine {
  type: "context" | "added" | "removed";
  oldNum?: number;
  newNum?: number;
  content: string;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const diffLines = computed<DiffLine[]>(() => {
  if (oldStr.value == null || newStr.value == null) return [];

  const oldLines = splitLines(oldStr.value);
  const newLines = splitLines(newStr.value);
  const lines: DiffLine[] = [];

  const m = oldLines.length;
  const n = newLines.length;

  if (m * n > 1_000_000) {
    oldLines.forEach((l, i) => {
      lines.push({ type: "removed", oldNum: i + 1, content: l });
    });
    newLines.forEach((l, i) => {
      lines.push({ type: "added", newNum: i + 1, content: l });
    });
    return lines;
  }

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

const addedCount = computed(() => diffLines.value.filter((l) => l.type === "added").length);
const removedCount = computed(() => diffLines.value.filter((l) => l.type === "removed").length);
const contextCount = computed(() => diffLines.value.filter((l) => l.type === "context").length);

const isPureAddition = computed(() => removedCount.value === 0 && addedCount.value > 0);

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
</script>

<template>
  <RendererShell
    tool-name="Edit"
    status="success"
    :primary-hint="filePath"
    :copy-text="newStr ?? content"
  >
    <template #icon><FileEdit :size="16" /></template>
    <template v-if="oldStr != null && newStr != null" #tabs>
      <div class="edit-diff-tabs" role="tablist">
        <span class="edit-diff-badge" :class="editBadgeClass">{{ editBadgeText }}</span>
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
    </template>

    <div v-if="oldStr != null || isDelete" class="edit-diff-stats">
      <span v-if="removedCount > 0" class="edit-diff-stat edit-diff-stat--removed">−{{ removedCount }} line{{ removedCount !== 1 ? 's' : '' }}</span>
      <span v-if="addedCount > 0" class="edit-diff-stat edit-diff-stat--added">+{{ addedCount }} line{{ addedCount !== 1 ? 's' : '' }}</span>
      <span v-if="contextCount > 0" class="edit-diff-stat edit-diff-stat--context">{{ contextCount }} unchanged</span>
      <span v-if="isDelete" class="edit-diff-stat edit-diff-stat--removed">deleted</span>
    </div>

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
            <td class="diff-code">
              <pre>{{ line.content }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
              <td class="diff-code">
                <pre>{{ pair.left?.content ?? '' }}</pre>
              </td>
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
              <td class="diff-code">
                <pre>{{ pair.right?.content ?? '' }}</pre>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

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

    <pre v-else class="edit-diff-fallback">{{ content }}</pre>
    <button v-if="isTruncated" type="button" class="rs-trunc" @click="emit('load-full')">
      Output truncated — Show full
    </button>
  </RendererShell>
</template>

<style scoped>
.edit-diff-tabs {
  display: flex;
  gap: 6px;
  align-items: center;
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
  background: var(--warning-subtle);
  color: var(--warning-fg);
}
.edit-diff-badge--added {
  background: var(--success-subtle);
  color: var(--success-fg);
}
.edit-diff-badge--deleted {
  background: var(--danger-subtle);
  color: var(--danger-fg);
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
  background: var(--accent-muted);
  color: var(--accent-fg);
  border-color: var(--accent-emphasis);
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
.edit-diff-stat--removed { color: var(--danger-fg); }
.edit-diff-stat--added { color: var(--success-fg); }
.edit-diff-stat--context { color: var(--text-tertiary); }
.edit-diff-body {
  overflow: auto;
  max-height: 500px;
}

.diff-table {
  border-collapse: collapse;
  width: 100%;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
}
.diff-line { border: none; }
.diff-line--context { background: transparent; }
.diff-line--removed { background: var(--danger-subtle); }
.diff-line--added { background: var(--success-subtle); }
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
.diff-line--removed .diff-indicator { color: var(--danger-fg); }
.diff-line--added .diff-indicator { color: var(--success-fg); }
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
.diff-line--removed .diff-code { color: var(--danger-fg); }
.diff-line--added .diff-code { color: var(--success-fg); }
.diff-line--context .diff-code { color: var(--text-secondary); }

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
.rs-trunc {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--canvas-inset);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.rs-trunc:hover { color: var(--text-primary); background: var(--surface-tertiary); }
</style>
