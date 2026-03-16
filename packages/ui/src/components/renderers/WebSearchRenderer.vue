<script setup lang="ts">
/**
 * WebSearchRenderer — renders web_search tool results with source links.
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

/** Try to extract URLs from the content (markdown link format). */
const sources = computed<Array<{ title: string; url: string }>>(() => {
  if (!props.content) return [];
  const matches = props.content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g);
  const seen = new Set<string>();
  const results: Array<{ title: string; url: string }> = [];
  for (const m of matches) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      results.push({ title: m[1], url: m[2] });
    }
  }
  return results;
});
</script>

<template>
  <RendererShell
    :label="query ? `🌐 ${query}` : 'Web Search'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="web-search">
      <pre class="web-search-body">{{ content }}</pre>
      <div v-if="sources.length > 0" class="web-search-sources">
        <div class="web-search-sources-label">Sources ({{ sources.length }})</div>
        <div v-for="src in sources" :key="src.url" class="web-search-source">
          <span class="web-search-source-icon">🔗</span>
          <a :href="src.url" target="_blank" rel="noopener" class="web-search-link">
            {{ src.title }}
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
.web-search-body {
  margin: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  line-height: 1.6;
  max-height: 400px;
  overflow: auto;
  font-family: inherit;
}
.web-search-sources {
  border-top: 1px solid var(--border-muted);
  padding: 8px 12px;
}
.web-search-sources-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.web-search-source {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.web-search-source-icon {
  font-size: 0.6875rem;
  flex-shrink: 0;
}
.web-search-link {
  color: var(--accent-fg, #818cf8);
  text-decoration: none;
  font-size: 0.6875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.web-search-link:hover {
  text-decoration: underline;
}
</style>
