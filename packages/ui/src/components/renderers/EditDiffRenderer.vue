<script setup lang="ts">
/**
 * EditDiffRenderer — renders edit tool results as an inline diff.
 *
 * Shows old_str → new_str with word-level diff highlighting.
 * Does NOT fabricate surrounding context — only displays what the tool provides.
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

const filePath = computed(() => {
  if (typeof props.args?.path === "string") return props.args.path;
  return undefined;
});

const oldStr = computed(() =>
  typeof props.args?.old_str === "string" ? props.args.old_str : null
);

const newStr = computed(() =>
  typeof props.args?.new_str === "string" ? props.args.new_str : null
);

const isDelete = computed(() => oldStr.value != null && !newStr.value);

/** Simple word-level diff: splits on whitespace/punctuation boundaries. */
interface DiffSegment {
  type: "equal" | "added" | "removed";
  value: string;
}

function computeWordDiff(oldText: string, newText: string): DiffSegment[] {
  // Tokenize into words and whitespace
  const tokenize = (text: string): string[] =>
    text.match(/\S+|\s+/g) ?? [];

  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  // Simple LCS-based diff (sufficient for the typically small old_str/new_str)
  const m = oldTokens.length;
  const n = newTokens.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffSegment[] = [];
  let i = m, j = n;
  const stack: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      stack.push({ type: "equal", value: oldTokens[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "added", value: newTokens[j - 1] });
      j--;
    } else {
      stack.push({ type: "removed", value: oldTokens[i - 1] });
      i--;
    }
  }

  // Reverse and merge adjacent same-type segments
  stack.reverse();
  for (const seg of stack) {
    if (result.length > 0 && result[result.length - 1].type === seg.type) {
      result[result.length - 1].value += seg.value;
    } else {
      result.push({ ...seg });
    }
  }

  return result;
}

const diffSegments = computed<DiffSegment[]>(() => {
  if (oldStr.value == null || newStr.value == null) return [];
  return computeWordDiff(oldStr.value, newStr.value);
});

const oldLines = computed(() => oldStr.value?.split("\n") ?? []);
const newLines = computed(() => newStr.value?.split("\n") ?? []);

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
    <!-- File path -->
    <div v-if="filePath" class="edit-diff-path" :title="filePath">
      <span class="edit-diff-path-icon">✏️</span>
      <span class="edit-diff-path-text">{{ filePath }}</span>
    </div>

    <!-- Word-level inline diff view -->
    <div v-if="oldStr != null && newStr != null" class="edit-diff-body">
      <div class="edit-diff-stats">
        <span class="edit-diff-stat edit-diff-stat--removed">−{{ oldLines.length }} line{{ oldLines.length !== 1 ? 's' : '' }}</span>
        <span class="edit-diff-stat edit-diff-stat--added">+{{ newLines.length }} line{{ newLines.length !== 1 ? 's' : '' }}</span>
      </div>
      <div class="edit-diff-inline" role="presentation">
        <span
          v-for="(seg, idx) in diffSegments"
          :key="idx"
          :class="{
            'diff-added': seg.type === 'added',
            'diff-removed': seg.type === 'removed',
            'diff-equal': seg.type === 'equal',
          }"
        >{{ seg.value }}</span>
      </div>
    </div>

    <!-- Delete-only case -->
    <div v-else-if="isDelete && oldStr" class="edit-diff-body">
      <div class="edit-diff-stats">
        <span class="edit-diff-stat edit-diff-stat--removed">−{{ oldLines.length }} line{{ oldLines.length !== 1 ? 's' : '' }} deleted</span>
      </div>
      <pre class="edit-diff-deleted">{{ oldStr }}</pre>
    </div>

    <!-- Fallback: show raw content -->
    <pre v-else class="edit-diff-fallback">{{ content }}</pre>
  </RendererShell>
</template>

<style scoped>
.edit-diff-path {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.75rem;
}
.edit-diff-path-icon {
  font-size: 0.875rem;
}
.edit-diff-path-text {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.edit-diff-body {
  padding: 8px 0;
}
.edit-diff-stats {
  display: flex;
  gap: 10px;
  padding: 0 12px 6px;
  font-size: 0.6875rem;
}
.edit-diff-stat {
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}
.edit-diff-stat--removed {
  color: var(--danger-fg, #f87171);
}
.edit-diff-stat--added {
  color: var(--success-fg, #34d399);
}
.edit-diff-inline {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  padding: 8px 12px;
  overflow: auto;
  max-height: 500px;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-equal {
  color: var(--text-secondary);
}
.diff-added {
  background: rgba(52, 211, 153, 0.15);
  color: var(--success-fg, #34d399);
  border-radius: 2px;
  padding: 0 1px;
}
.diff-removed {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger-fg, #f87171);
  text-decoration: line-through;
  border-radius: 2px;
  padding: 0 1px;
}
.edit-diff-deleted {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  padding: 8px 12px;
  margin: 0;
  color: var(--danger-fg, #f87171);
  background: rgba(248, 113, 113, 0.08);
  overflow: auto;
  max-height: 400px;
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
