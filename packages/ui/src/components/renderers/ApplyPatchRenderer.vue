<script setup lang="ts">
/**
 * ApplyPatchRenderer — renders apply_patch raw patch grammar as file cards.
 *
 * Unlike the edit tool, apply_patch arguments are a raw patch string that may
 * touch multiple files. The parser below preserves that explicit structure
 * instead of trying to infer old/new source strings.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { computed, ref } from "vue";
import CodeBlock from "./CodeBlock.vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

type PatchOperation = "add" | "update" | "delete";
type PatchLineType = "context" | "added" | "removed" | "hunk" | "meta";

interface PatchLine {
  type: PatchLineType;
  content: string;
}

interface PatchFile {
  operation: PatchOperation;
  path: string;
  moveTo?: string;
  lines: PatchLine[];
}

const showRaw = ref(false);

const rawPatch = computed(() => {
  if (typeof props.tc.arguments === "string") return props.tc.arguments;
  if (props.content.startsWith("*** Begin Patch")) return props.content;
  return "";
});

const patchFiles = computed(() => parsePatch(rawPatch.value));

const addedLineCount = computed(() =>
  patchFiles.value.reduce(
    (sum, file) => sum + file.lines.filter((line) => line.type === "added").length,
    0,
  ),
);

const removedLineCount = computed(() =>
  patchFiles.value.reduce(
    (sum, file) => sum + file.lines.filter((line) => line.type === "removed").length,
    0,
  ),
);

const hunkCount = computed(() =>
  patchFiles.value.reduce(
    (sum, file) => sum + file.lines.filter((line) => line.type === "hunk").length,
    0,
  ),
);

const operationSummary = computed(() => {
  const counts = new Map<PatchOperation, number>();
  for (const file of patchFiles.value) {
    counts.set(file.operation, (counts.get(file.operation) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([operation, count]) => ({ operation, count }));
});

function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;

  for (const rawLine of patch.split(/\r?\n/)) {
    const addMatch = rawLine.match(/^\*\*\* Add File: (.+)$/);
    const updateMatch = rawLine.match(/^\*\*\* Update File: (.+)$/);
    const deleteMatch = rawLine.match(/^\*\*\* Delete File: (.+)$/);
    const moveMatch = rawLine.match(/^\*\*\* Move to: (.+)$/);

    if (addMatch) {
      current = { operation: "add", path: addMatch[1], lines: [] };
      files.push(current);
      continue;
    }

    if (updateMatch) {
      current = { operation: "update", path: updateMatch[1], lines: [] };
      files.push(current);
      continue;
    }

    if (deleteMatch) {
      current = { operation: "delete", path: deleteMatch[1], lines: [] };
      files.push(current);
      continue;
    }

    if (moveMatch && current) {
      current.moveTo = moveMatch[1];
      continue;
    }

    if (
      !current ||
      rawLine === "*** Begin Patch" ||
      rawLine === "*** End Patch" ||
      rawLine === "*** End of File"
    ) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      current.lines.push({ type: "hunk", content: rawLine });
    } else if (rawLine.startsWith("+")) {
      current.lines.push({ type: "added", content: rawLine.slice(1) });
    } else if (rawLine.startsWith("-")) {
      current.lines.push({ type: "removed", content: rawLine.slice(1) });
    } else if (rawLine.startsWith(" ")) {
      current.lines.push({ type: "context", content: rawLine.slice(1) });
    } else if (rawLine.trim()) {
      current.lines.push({ type: "meta", content: rawLine });
    }
  }

  return files;
}

function operationLabel(operation: PatchOperation): string {
  switch (operation) {
    case "add":
      return "Added";
    case "delete":
      return "Deleted";
    case "update":
      return "Updated";
  }
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function addedFileContent(file: PatchFile): string {
  return file.lines.map((line) => line.content).join("\n");
}
</script>

<template>
  <RendererShell
    :label="patchFiles.length === 1 ? fileName(patchFiles[0].path) : 'Apply Patch'"
    :copy-content="rawPatch || content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div v-if="patchFiles.length > 0" class="patch-renderer">
      <div class="patch-summary">
        <span class="patch-summary-item">{{ patchFiles.length }} file{{ patchFiles.length !== 1 ? 's' : '' }}</span>
        <span v-if="addedLineCount" class="patch-summary-item patch-summary-item--added">+{{ addedLineCount }}</span>
        <span v-if="removedLineCount" class="patch-summary-item patch-summary-item--removed">-{{ removedLineCount }}</span>
        <span v-if="hunkCount" class="patch-summary-item">{{ hunkCount }} hunk{{ hunkCount !== 1 ? 's' : '' }}</span>
        <span
          v-for="entry in operationSummary"
          :key="entry.operation"
          :class="['patch-op-chip', `patch-op-chip--${entry.operation}`]"
        >
          {{ operationLabel(entry.operation) }} {{ entry.count }}
        </span>
      </div>

      <div class="patch-file-list">
        <section
          v-for="(file, fileIndex) in patchFiles"
          :key="`${file.operation}-${file.path}-${fileIndex}`"
          class="patch-file-card"
        >
          <header class="patch-file-header">
            <div class="patch-file-title">
              <span :class="['patch-file-badge', `patch-file-badge--${file.operation}`]">
                {{ operationLabel(file.operation) }}
              </span>
              <span class="patch-file-path" :title="file.path">{{ file.path }}</span>
            </div>
            <span v-if="file.moveTo" class="patch-move-target" :title="file.moveTo">
              -> {{ file.moveTo }}
            </span>
          </header>

          <CodeBlock
            v-if="file.operation === 'add'"
            :code="addedFileContent(file)"
            :file-path="file.path"
            :max-lines="120"
          />

          <div v-else-if="file.operation === 'update'" class="patch-diff-body">
            <table class="patch-diff-table" role="presentation">
              <tbody>
                <tr
                  v-for="(line, lineIndex) in file.lines"
                  :key="lineIndex"
                  :class="['patch-line', `patch-line--${line.type}`]"
                >
                  <td class="patch-line-indicator">
                    <span v-if="line.type === 'added'">+</span>
                    <span v-else-if="line.type === 'removed'">-</span>
                    <span v-else-if="line.type === 'hunk'">@@</span>
                    <span v-else>&nbsp;</span>
                  </td>
                  <td class="patch-line-code"><pre>{{ line.content }}</pre></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="patch-delete-body">
            This patch deletes <code>{{ file.path }}</code>.
          </div>
        </section>
      </div>

      <button type="button" class="patch-raw-toggle" @click="showRaw = !showRaw">
        {{ showRaw ? 'Hide raw patch' : 'Show raw patch' }}
      </button>
      <pre v-if="showRaw" class="patch-raw">{{ rawPatch }}</pre>
    </div>

    <pre v-else class="patch-fallback">{{ content || rawPatch }}</pre>
  </RendererShell>
</template>

<style scoped>
.patch-renderer {
  font-size: 0.75rem;
}
.patch-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-muted);
  background:
    radial-gradient(circle at top left, rgba(52, 211, 153, 0.09), transparent 35%),
    radial-gradient(circle at top right, rgba(248, 113, 113, 0.07), transparent 34%),
    var(--canvas-inset);
}
.patch-summary-item,
.patch-op-chip {
  border: 1px solid var(--border-muted);
  border-radius: 9999px;
  padding: 2px 8px;
  color: var(--text-secondary);
  background: var(--canvas-default);
  font-weight: 600;
}
.patch-summary-item--added,
.patch-op-chip--add {
  color: var(--success-fg, #34d399);
  border-color: rgba(52, 211, 153, 0.32);
  background: rgba(52, 211, 153, 0.09);
}
.patch-summary-item--removed,
.patch-op-chip--delete {
  color: var(--danger-fg, #f87171);
  border-color: rgba(248, 113, 113, 0.32);
  background: rgba(248, 113, 113, 0.09);
}
.patch-op-chip--update {
  color: var(--warning-fg, #fbbf24);
  border-color: rgba(251, 191, 36, 0.32);
  background: rgba(251, 191, 36, 0.09);
}
.patch-file-list {
  display: flex;
  flex-direction: column;
}
.patch-file-card {
  border-bottom: 1px solid var(--border-muted);
}
.patch-file-card:last-child {
  border-bottom: none;
}
.patch-file-header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.02);
}
.patch-file-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.patch-file-badge {
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.patch-file-badge--add {
  color: var(--success-fg, #34d399);
  background: rgba(52, 211, 153, 0.14);
}
.patch-file-badge--update {
  color: var(--warning-fg, #fbbf24);
  background: rgba(251, 191, 36, 0.14);
}
.patch-file-badge--delete {
  color: var(--danger-fg, #f87171);
  background: rgba(248, 113, 113, 0.14);
}
.patch-file-path,
.patch-move-target {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.patch-move-target {
  color: var(--text-tertiary);
  flex-shrink: 1;
}
.patch-diff-body {
  max-height: 520px;
  overflow: auto;
}
.patch-diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
}
.patch-line--added {
  background: rgba(52, 211, 153, 0.08);
}
.patch-line--removed {
  background: rgba(248, 113, 113, 0.08);
}
.patch-line--hunk {
  background: rgba(99, 102, 241, 0.1);
}
.patch-line-indicator {
  width: 3ch;
  padding: 0 8px;
  text-align: right;
  color: var(--text-tertiary);
  user-select: none;
  vertical-align: top;
}
.patch-line--added .patch-line-indicator,
.patch-line--added .patch-line-code {
  color: var(--success-fg, #34d399);
}
.patch-line--removed .patch-line-indicator,
.patch-line--removed .patch-line-code {
  color: var(--danger-fg, #f87171);
}
.patch-line--hunk .patch-line-indicator,
.patch-line--hunk .patch-line-code {
  color: var(--accent-fg, #818cf8);
}
.patch-line-code {
  padding: 0 12px 0 0;
  color: var(--text-secondary);
  white-space: pre;
}
.patch-line-code pre {
  margin: 0;
  font: inherit;
  white-space: pre;
}
.patch-delete-body {
  padding: 10px 12px;
  color: var(--text-secondary);
}
.patch-delete-body code {
  font-family: 'JetBrains Mono', monospace;
  color: var(--danger-fg, #f87171);
}
.patch-raw-toggle {
  width: 100%;
  border: none;
  border-top: 1px solid var(--border-muted);
  padding: 7px 10px;
  background: var(--canvas-inset);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 700;
}
.patch-raw-toggle:hover {
  color: var(--text-secondary);
  background: var(--neutral-muted);
}
.patch-raw,
.patch-fallback {
  margin: 0;
  padding: 10px 12px;
  max-height: 420px;
  overflow: auto;
  color: var(--text-secondary);
  background: var(--canvas-default);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
