<script setup lang="ts">
/**
 * ViewCodeRenderer — renders view tool results with line numbers and language detection.
 */
import { computed } from "vue";
import RendererShell from "./RendererShell.vue";
import CodeBlock from "./CodeBlock.vue";
import { detectLanguage } from "../../utils/languageDetection";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  'load-full': [];
}>();

const filePath = computed(() =>
  typeof props.args?.path === "string" ? props.args.path : undefined
);

const viewRange = computed<[number, number] | null>(() => {
  const r = props.args?.view_range;
  if (Array.isArray(r) && r.length === 2) {
    return [Number(r[0]), Number(r[1])];
  }
  return null;
});

const startLine = computed(() => viewRange.value?.[0] ?? 1);

/** Detect if this is a directory listing (no file extension AND not a known filename). */
const isDirectoryListing = computed(() => {
  if (!filePath.value) return false;
  const lastSegment = filePath.value.replace(/\\/g, "/").split("/").pop() ?? "";
  // Check against known extensionless filenames (Dockerfile, Makefile, etc.)
  if (detectLanguage(filePath.value) !== "text") return false;
  // No extension and not a recognized filename → likely a directory
  if (!lastSegment.includes(".")) return true;
  return false;
});

const lineCount = computed(() => {
  const lines = props.content.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
});
</script>

<template>
  <RendererShell
    :label="filePath ?? 'View'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div v-if="filePath" class="view-code-info">
      <span class="view-code-badge">👁 {{ lineCount }} line{{ lineCount !== 1 ? 's' : '' }}</span>
      <span v-if="viewRange" class="view-code-range">
        Lines {{ viewRange[0] }}–{{ viewRange[1] === -1 ? 'end' : viewRange[1] }}
      </span>
    </div>
    <!-- Directory listing -->
    <pre v-if="isDirectoryListing" class="view-code-dir">{{ content }}</pre>
    <!-- Code file -->
    <CodeBlock
      v-else
      :code="content"
      :file-path="filePath"
      :start-line="startLine"
      :max-lines="2000"
      :show-language-badge="true"
    />
  </RendererShell>
</template>

<style scoped>
.view-code-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-muted);
}
.view-code-badge {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.view-code-range {
  font-size: 0.6875rem;
  color: var(--accent-fg, #818cf8);
  font-family: 'JetBrains Mono', monospace;
}
.view-code-dir {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  padding: 10px 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 500px;
  overflow: auto;
}
</style>
