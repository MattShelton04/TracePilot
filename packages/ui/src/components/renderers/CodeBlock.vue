<script setup lang="ts">
/**
 * CodeBlock — a lightweight syntax-highlighted code display.
 *
 * Shows code with line numbers, optional file path header, and language badge.
 * Uses CSS-only styling with monospace font; no external highlighting library.
 * Can be enhanced with Shiki later via the `highlighted` slot.
 */
import { computed } from "vue";
import { detectLanguage, languageDisplayName } from "../../utils/languageDetection";

const props = defineProps<{
  code: string;
  /** File path — used for language detection and display. */
  filePath?: string;
  /** Override language (skips auto-detection). */
  language?: string;
  /** Show line numbers (default: true). */
  lineNumbers?: boolean;
  /** Starting line number (default: 1). */
  startLine?: number;
  /** Max lines before collapsing (0 = unlimited). */
  maxLines?: number;
  /** Whether to show the language badge (default: true). */
  showLanguageBadge?: boolean;
}>();

const lang = computed(() => props.language ?? detectLanguage(props.filePath ?? ""));
const langDisplay = computed(() => languageDisplayName(lang.value));
const showNumbers = computed(() => props.lineNumbers !== false);
const start = computed(() => props.startLine ?? 1);

const lines = computed(() => {
  const raw = props.code.split("\n");
  // Remove trailing empty line (common in file content)
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
  return raw;
});

const visibleLines = computed(() => {
  if (props.maxLines && props.maxLines > 0 && lines.value.length > props.maxLines) {
    return lines.value.slice(0, props.maxLines);
  }
  return lines.value;
});

const isCollapsed = computed(() =>
  props.maxLines ? lines.value.length > props.maxLines : false
);

const hiddenCount = computed(() =>
  isCollapsed.value ? lines.value.length - (props.maxLines ?? 0) : 0
);

const lineNumberWidth = computed(() => {
  const maxNum = start.value + lines.value.length - 1;
  return Math.max(String(maxNum).length, 2);
});

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}
</script>

<template>
  <div class="code-block" :data-language="lang">
    <div v-if="filePath || showLanguageBadge !== false" class="code-block-header">
      <span v-if="filePath" class="code-block-path" :title="filePath">
        {{ fileName(filePath) }}
      </span>
      <span v-if="showLanguageBadge !== false" class="code-block-lang">{{ langDisplay }}</span>
    </div>
    <div class="code-block-content">
      <table class="code-block-table" role="presentation">
        <tbody>
          <tr v-for="(line, i) in visibleLines" :key="i" class="code-line">
            <td v-if="showNumbers" class="code-line-number" :style="{ width: lineNumberWidth + 'ch' }">
              {{ start + i }}
            </td>
            <td class="code-line-content"><pre>{{ line }}</pre></td>
          </tr>
        </tbody>
      </table>
      <div v-if="isCollapsed" class="code-block-collapsed">
        … {{ hiddenCount }} more line{{ hiddenCount !== 1 ? 's' : '' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-block {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  background: var(--canvas-default);
  overflow: hidden;
}
.code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--canvas-inset);
  border-bottom: 1px solid var(--border-muted);
}
.code-block-path {
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.code-block-lang {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  margin-left: 12px;
}
.code-block-content {
  overflow: auto;
  max-height: 500px;
}
.code-block-table {
  border-collapse: collapse;
  width: 100%;
}
.code-line {
  border: none;
}
.code-line:hover {
  background: var(--neutral-muted);
}
.code-line-number {
  text-align: right;
  padding: 0 10px 0 8px;
  color: var(--text-tertiary);
  user-select: none;
  vertical-align: top;
  white-space: nowrap;
  border-right: 1px solid var(--border-muted);
  opacity: 0.6;
}
.code-line-content {
  padding: 0 12px;
  white-space: pre;
}
.code-line-content pre {
  margin: 0;
  font: inherit;
  white-space: pre;
}
.code-block-collapsed {
  text-align: center;
  padding: 6px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  background: var(--canvas-inset);
  border-top: 1px solid var(--border-muted);
}
</style>
