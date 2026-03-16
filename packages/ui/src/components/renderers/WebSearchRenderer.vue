<script setup lang="ts">
/**
 * WebSearchRenderer — renders web_search tool results with markdown body,
 * numbered source cards, and inline citation highlighting.
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

const query = computed(() =>
  typeof props.args?.query === "string" ? props.args.query : null
);

/** Extract URLs from markdown link format. */
const sources = computed<Array<{ title: string; url: string; domain: string }>>(() => {
  if (!props.content) return [];
  const matches = props.content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g);
  const seen = new Set<string>();
  const results: Array<{ title: string; url: string; domain: string }> = [];
  for (const m of matches) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      let domain = "";
      try { domain = new URL(m[2]).hostname.replace(/^www\./, ""); } catch { /* */ }
      results.push({ title: m[1], url: m[2], domain });
    }
  }
  return results;
});

/** Simple markdown → HTML (safe — escapes first, then applies formatting). */
const renderedBody = computed(() => {
  if (!props.content) return "";
  let html = escapeHtml(props.content);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="ws-inline-code">$1</code>');
  // Citation references like [1], [2] — BEFORE link conversion to avoid
  // corrupting URLs that contain bracketed numbers (e.g. ?a=[1])
  html = html.replace(
    /\[(\d+)\]/g,
    '<span class="ws-citation">$1</span>'
  );
  // Markdown links → clickable (after citations, so [text](url) still works
  // because link text won't be purely numeric like citation refs)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="ws-link">$1</a>'
  );
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}
</script>

<template>
  <RendererShell
    :label="query ? `🌐 ${query}` : 'Web Search'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="web-search">
      <!-- Query display -->
      <div v-if="query" class="ws-query-bar">
        <span class="ws-query-icon">🔍</span>
        <span class="ws-query-text">{{ query }}</span>
      </div>

      <!-- Rendered body with markdown formatting -->
      <!-- eslint-disable vue/no-v-html -->
      <div class="ws-body" v-html="renderedBody"></div>

      <!-- Source cards -->
      <div v-if="sources.length > 0" class="ws-sources">
        <div class="ws-sources-label">Sources ({{ sources.length }})</div>
        <div class="ws-source-grid">
          <a v-for="(src, idx) in sources" :key="src.url"
             :href="src.url" target="_blank" rel="noopener"
             class="ws-source-card">
            <span class="ws-source-num">{{ idx + 1 }}</span>
            <div class="ws-source-info">
              <span class="ws-source-title">{{ src.title }}</span>
              <span class="ws-source-domain">
                <img :src="faviconUrl(src.domain)" :alt="src.domain" width="12" height="12" class="ws-favicon" loading="lazy" />
                {{ src.domain }}
              </span>
            </div>
          </a>
        </div>
      </div>
    </div>
  </RendererShell>
</template>

<style scoped>
.web-search {
  font-size: 0.75rem;
}
.ws-query-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--canvas-inset);
  border-bottom: 1px solid var(--border-muted);
}
.ws-query-icon { font-size: 0.875rem; flex-shrink: 0; }
.ws-query-text {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-body {
  padding: 10px 12px;
  line-height: 1.7;
  color: var(--text-secondary);
  max-height: 400px;
  overflow: auto;
}
.ws-body :deep(strong) { color: var(--text-primary); font-weight: 600; }
.ws-body :deep(.ws-inline-code) {
  background: var(--neutral-muted);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
}
.ws-body :deep(.ws-link) {
  color: var(--accent-fg, #818cf8);
  text-decoration: none;
}
.ws-body :deep(.ws-link:hover) { text-decoration: underline; }
.ws-body :deep(.ws-citation) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-muted, rgba(99, 102, 241, 0.15));
  color: var(--accent-fg, #818cf8);
  font-size: 0.5625rem;
  font-weight: 700;
  vertical-align: super;
  margin: 0 1px;
  cursor: default;
}

/* ── Source cards ── */
.ws-sources {
  border-top: 1px solid var(--border-muted);
  padding: 8px 12px;
}
.ws-sources-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.ws-source-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px;
}
.ws-source-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  text-decoration: none;
  color: inherit;
  transition: all 0.15s;
}
.ws-source-card:hover {
  border-color: var(--accent-emphasis, #6366f1);
  background: var(--neutral-muted);
}
.ws-source-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent-muted, rgba(99, 102, 241, 0.15));
  color: var(--accent-fg, #818cf8);
  font-size: 0.625rem;
  font-weight: 700;
  flex-shrink: 0;
}
.ws-source-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  min-width: 0;
}
.ws-source-title {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-source-domain {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.5625rem;
  color: var(--text-tertiary);
}
.ws-favicon {
  border-radius: 2px;
}
</style>
