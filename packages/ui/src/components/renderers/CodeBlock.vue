<script setup lang="ts">
/**
 * CodeBlock — syntax-highlighted code display with line numbers.
 *
 * Uses a lightweight regex-based tokenizer (syntaxHighlight.ts) to
 * produce colored tokens. The `.syn-*` CSS classes are defined in this
 * component's scoped styles.
 */
import { computed, nextTick, ref, watch } from "vue";
import { detectLanguage, languageDisplayName } from "../../utils/languageDetection";
import { highlightLine } from "../../utils/syntaxHighlight";

const props = withDefaults(
  defineProps<{
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
    /**
     * When true the code block expands to fill its parent container and scrolling
     * is delegated to the parent. When false (default) an internal max-height of
     * 500px is applied so the block doesn't dominate inline conversation views.
     */
    fillHeight?: boolean;
    /** Case-insensitive literal query to highlight in the rendered source. */
    searchQuery?: string;
    /** One-based line containing the active search match. */
    activeSearchLine?: number;
    /** Zero-based character offset of the active match within its line. */
    activeSearchColumn?: number;
  }>(),
  {
    lineNumbers: true,
    startLine: 1,
    showLanguageBadge: true,
  },
);

const lang = computed(() => props.language ?? detectLanguage(props.filePath ?? ""));
const langDisplay = computed(() => languageDisplayName(lang.value));
const showNumbers = computed(() => props.lineNumbers);
const start = computed(() => props.startLine);

const lines = computed(() => {
  const raw = props.code.split("\n");
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
  return raw;
});

const visibleRange = computed(() => {
  const maxLines = props.maxLines ?? 0;
  if (maxLines <= 0 || lines.value.length <= maxLines) {
    return { start: 0, end: lines.value.length };
  }
  const activeIndex = (props.activeSearchLine ?? start.value) - start.value;
  if (activeIndex >= maxLines && activeIndex < lines.value.length) {
    const rangeStart = Math.max(
      0,
      Math.min(activeIndex - Math.floor(maxLines / 2), lines.value.length - maxLines),
    );
    return { start: rangeStart, end: rangeStart + maxLines };
  }
  return { start: 0, end: maxLines };
});

function highlightedLine(line: string, lineNumber: number): string {
  const query = props.searchQuery?.trim();
  if (!query) return highlightLine(line, lang.value);

  const lowerLine = line.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  let cursor = 0;
  let match = lowerLine.indexOf(lowerQuery);
  if (match < 0) return highlightLine(line, lang.value);

  let html = "";
  while (match >= 0) {
    html += highlightLine(line.slice(cursor, match), lang.value);
    const active = lineNumber === props.activeSearchLine && match === props.activeSearchColumn;
    html += `<mark class="code-search-match${active ? " code-search-match--active" : ""}">${highlightLine(line.slice(match, match + query.length), lang.value)}</mark>`;
    cursor = match + query.length;
    match = lowerLine.indexOf(lowerQuery, cursor);
  }
  return html + highlightLine(line.slice(cursor), lang.value);
}

const visibleLines = computed(() =>
  lines.value.slice(visibleRange.value.start, visibleRange.value.end).map((line, index) => {
    const sourceIndex = visibleRange.value.start + index;
    const lineNumber = start.value + sourceIndex;
    return {
      html: highlightedLine(line, lineNumber),
      lineNumber,
    };
  }),
);

const isCollapsed = computed(() => (props.maxLines ? lines.value.length > props.maxLines : false));

const hiddenCount = computed(() =>
  isCollapsed.value ? lines.value.length - visibleLines.value.length : 0,
);

const contentElement = ref<HTMLElement | null>(null);
watch(
  () => [
    props.searchQuery,
    props.activeSearchLine,
    props.activeSearchColumn,
    visibleRange.value.start,
  ],
  async () => {
    if (!props.searchQuery || props.activeSearchLine === undefined) return;
    await nextTick();
    const activeLine = contentElement.value?.querySelector<HTMLElement>(
      `[data-line-number="${props.activeSearchLine}"]`,
    );
    activeLine?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  },
  { flush: "post" },
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
  <div class="code-block" :class="{ 'code-block--fill': fillHeight }" :data-language="lang">
    <div v-if="filePath || showLanguageBadge" class="code-block-header">
      <span v-if="filePath" class="code-block-path" :title="filePath">
        {{ fileName(filePath) }}
      </span>
      <span v-if="showLanguageBadge" class="code-block-lang">{{ langDisplay }}</span>
    </div>
    <div ref="contentElement" class="code-block-content" :class="{ 'code-block-content--fill': fillHeight }">
      <table class="code-block-table" role="presentation">
        <tbody>
          <tr
            v-for="line in visibleLines"
            :key="line.lineNumber"
            class="code-line"
            :data-line-number="line.lineNumber"
          >
            <td v-if="showNumbers" class="code-line-number" :style="{ width: lineNumberWidth + 'ch' }">
              {{ line.lineNumber }}
            </td>
            <!-- eslint-disable-next-line vue/no-v-html -- input is HTML-escaped by highlightLine -->
            <td class="code-line-content"><pre v-html="line.html"></pre></td>
          </tr>
        </tbody>
      </table>
      <div v-if="isCollapsed" class="code-block-collapsed">
        <template v-if="visibleRange.start > 0">
          … showing lines {{ visibleRange.start + start }}–{{ visibleRange.end + start - 1 }} of
          {{ lines.length }}
        </template>
        <template v-else>… {{ hiddenCount }} more line{{ hiddenCount !== 1 ? 's' : '' }}</template>
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
/* Fill-height mode: become a flex column so the content area can take all
   remaining height from the parent and handle its own scroll. */
.code-block--fill {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
/* Fill mode: take all available height from the flex parent and scroll
   in both directions (long lines → horizontal, tall files → vertical). */
.code-block-content--fill {
  flex: 1;
  min-height: 0;
  overflow: auto;
  max-height: none;
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
  color: var(--text-secondary);
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

/* ── Syntax highlighting tokens ── */
.code-line-content :deep(.syn-keyword)  { color: var(--syn-keyword, #c084fc); }
.code-line-content :deep(.syn-type)     { color: var(--syn-type, #38bdf8); }
.code-line-content :deep(.syn-string)   { color: var(--syn-string, #34d399); }
.code-line-content :deep(.syn-number)   { color: var(--syn-number, #fb923c); }
.code-line-content :deep(.syn-comment)  { color: var(--text-tertiary); font-style: italic; }
.code-line-content :deep(.syn-func)     { color: var(--syn-func, #fbbf24); }
.code-line-content :deep(.syn-const)    { color: var(--syn-const, #818cf8); }
.code-line-content :deep(.syn-param)    { color: var(--syn-param, #f472b6); }
.code-line-content :deep(.syn-operator) { color: var(--text-tertiary); }
.code-line-content :deep(.syn-tag)      { color: var(--syn-tag, #fb7185); }
.code-line-content :deep(.syn-attr)     { color: var(--syn-attr, #38bdf8); }
.code-line-content :deep(.syn-punct)    { color: var(--text-tertiary); }
.code-line-content :deep(.syn-prop)     { color: var(--syn-prop, #93c5fd); }
.code-line-content :deep(.syn-regex)    { color: var(--syn-regex, #fb923c); }
.code-line-content :deep(.code-search-match) {
  border-radius: 2px;
  background: var(--color-search-mark-highlight-bg);
  color: inherit;
}
.code-line-content :deep(.code-search-match--active) {
  outline: 1px solid var(--accent-fg);
  background: var(--attention-muted, var(--color-search-mark-highlight-bg));
}
</style>
