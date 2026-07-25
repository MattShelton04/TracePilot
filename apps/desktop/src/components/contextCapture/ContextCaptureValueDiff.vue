<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  beforeValue?: unknown;
  afterValue?: unknown;
}>();

type DiffLine = {
  type: "context" | "added" | "removed";
  content: string;
  oldNumber?: number;
  newNumber?: number;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(canonical(value), null, 2) ?? String(value);
}

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function diffText(before: string, after: string): DiffLine[] {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const oldLength = oldLines.length;
  const newLength = newLines.length;

  // Avoid quadratic memory use for unusually large embedded values. The
  // fallback still shows every exact before/after line, just without shared
  // context alignment.
  if (oldLength * newLength > 500_000) {
    return [
      ...oldLines.map(
        (content, index): DiffLine => ({
          type: "removed",
          content,
          oldNumber: index + 1,
        }),
      ),
      ...newLines.map(
        (content, index): DiffLine => ({
          type: "added",
          content,
          newNumber: index + 1,
        }),
      ),
    ];
  }

  const lengths: number[][] = Array.from({ length: oldLength + 1 }, () =>
    Array(newLength + 1).fill(0),
  );
  for (let oldIndex = 1; oldIndex <= oldLength; oldIndex++) {
    for (let newIndex = 1; newIndex <= newLength; newIndex++) {
      lengths[oldIndex][newIndex] =
        oldLines[oldIndex - 1] === newLines[newIndex - 1]
          ? lengths[oldIndex - 1][newIndex - 1] + 1
          : Math.max(lengths[oldIndex - 1][newIndex], lengths[oldIndex][newIndex - 1]);
    }
  }

  const reversed: DiffLine[] = [];
  let oldIndex = oldLength;
  let newIndex = newLength;
  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && oldLines[oldIndex - 1] === newLines[newIndex - 1]) {
      reversed.push({
        type: "context",
        content: oldLines[oldIndex - 1],
        oldNumber: oldIndex,
        newNumber: newIndex,
      });
      oldIndex--;
      newIndex--;
    } else if (
      newIndex > 0 &&
      (oldIndex === 0 || lengths[oldIndex][newIndex - 1] >= lengths[oldIndex - 1][newIndex])
    ) {
      reversed.push({
        type: "added",
        content: newLines[newIndex - 1],
        newNumber: newIndex,
      });
      newIndex--;
    } else {
      reversed.push({
        type: "removed",
        content: oldLines[oldIndex - 1],
        oldNumber: oldIndex,
      });
      oldIndex--;
    }
  }
  return reversed.reverse();
}

const lines = computed(() =>
  diffText(formatValue(props.beforeValue), formatValue(props.afterValue)),
);
</script>

<template>
  <div class="value-diff" role="table" aria-label="Before and after value diff">
    <div
      v-for="(line, index) in lines"
      :key="index"
      class="value-diff__line"
      :class="`value-diff__line--${line.type}`"
      role="row"
      :aria-label="line.type === 'context' ? 'unchanged' : line.type"
    >
      <span class="value-diff__number" role="cell">{{ line.oldNumber ?? '' }}</span>
      <span class="value-diff__number" role="cell">{{ line.newNumber ?? '' }}</span>
      <span class="value-diff__indicator" aria-hidden="true">
        {{ line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' ' }}
      </span>
      <pre role="cell">{{ line.content }}</pre>
    </div>
  </div>
</template>

<style scoped>
.value-diff {
  overflow: auto;
  max-height: min(50vh, 520px);
  border-top: 1px solid var(--border-muted);
  background: var(--canvas-inset);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.6875rem;
  line-height: 1.55;
}

.value-diff__line {
  display: grid;
  grid-template-columns: 4ch 4ch 2ch minmax(max-content, 1fr);
  min-width: min-content;
}

.value-diff__line--removed {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.value-diff__line--added {
  background: var(--success-subtle);
  color: var(--success-fg);
}

.value-diff__line--context {
  color: var(--text-secondary);
}

.value-diff__number,
.value-diff__indicator {
  padding: 0 5px;
  color: var(--text-tertiary);
  text-align: right;
  user-select: none;
}

.value-diff__indicator {
  padding: 0 3px;
  text-align: center;
}

.value-diff__line--removed .value-diff__indicator {
  color: var(--danger-fg);
}

.value-diff__line--added .value-diff__indicator {
  color: var(--success-fg);
}

.value-diff pre {
  min-width: 0;
  margin: 0;
  padding: 0 10px 0 4px;
  font: inherit;
  white-space: pre;
}
</style>
