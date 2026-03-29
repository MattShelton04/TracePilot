<script setup lang="ts">
/**
 * MarkdownContent — renders markdown with markdown-it and sanitizes with DOMPurify.
 *
 * The parser is eagerly loaded at app startup via ensureMarkdownReady() in main.ts.
 * This component simply uses the shared singleton — no layout shift from async loading.
 */
import { computed, watchEffect } from 'vue';
import { mdReady, ensureMarkdownReady, renderMarkdown, escapeHtml } from '../utils/markdownLoader';

const props = withDefaults(defineProps<{
  /** Markdown text to render. */
  content: string;
  /** Maximum height before showing a scrollbar (CSS value). */
  maxHeight?: string;
  /** Whether to render markdown (true) or show as raw text (false). */
  render?: boolean;
}>(), {
  render: true
});

const emit = defineEmits<{
  'open-external': [url: string];
}>();

// Safety net: trigger load if not already started (shouldn't happen in practice)
watchEffect(() => {
  if (props.render && !mdReady.value) ensureMarkdownReady();
});

const rendered = computed(() => {
  if (!props.render) {
    return escapeHtml(props.content);
  }
  return renderMarkdown(props.content);
});

function handleLinkClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const link = target.closest('a');
  if (link) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      // Internal section link - prevent default to avoid 404 in SPA
      event.preventDefault();

      const id = href.slice(1).toLowerCase();
      const container = (event.currentTarget as HTMLElement);

      // 1. Try to find by ID (standard)
      let element = container.querySelector(`[id="${id}"], a[name="${id}"]`);

      // 2. If not found, try to find a header that matches the slug
      if (!element) {
        const headers = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (const h of Array.from(headers)) {
          const text = h.textContent || '';
          // Standard slugging: don't collapse multiple dashes if they come from multiple spaces/chars
          const slug = text.toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s/g, '-')
            .replace(/_/g, '-')
            .replace(/^-+|-+$/g, '');

          if (slug === id || slug.replace(/-+/g, '-') === id.replace(/-+/g, '-')) {
            element = h;
            break;
          }
        }
      }

      if (element) {
        // Use scroll-margin-top on the target element if possible,
        // otherwise just use scrollIntoView which is more reliable than manual relative math
        // in complex layouts.
        (element as HTMLElement).style.scrollMarginTop = '80px';
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      // External link - emit event for parent to handle (opens in external browser in Tauri)
      event.preventDefault();
      emit('open-external', href);
    }
  }
}
</script>

<template>
  <div
    class="markdown-content"
    :class="{
      'is-rendered': render && mdReady,
      'is-raw': !render,
    }"
    :style="maxHeight ? { maxHeight, overflowY: 'auto' } : undefined"
    @click="handleLinkClick"
    v-html="rendered" />
</template>

<style scoped>
.markdown-content {
  font-size: 0.8125rem;
  line-height: 1.6; /* Match global bubble line-height */
  color: var(--text-primary);
  word-break: break-word;
  font-family: inherit;
  margin: 0;
}

.markdown-content.is-rendered {
  /* Override parent bubbles that might have pre-wrap */
  white-space: normal !important;
}

.markdown-content.is-raw {
  white-space: pre-wrap !important;
}

/* Markdown Element Styles - Aggressive Resets */
:deep(p) {
  margin: 0 0 0.25rem 0 !important;
  padding: 0 !important;
}

:deep(p:last-child) {
  margin-bottom: 0 !important;
}

:deep(h1), :deep(h2), :deep(h3), :deep(h4) {
  margin: 1.25rem 0 0.5rem 0 !important;
  font-weight: 600;
  line-height: 1.3;
}

:deep(h1) { font-size: 1.25rem; }
:deep(h2) { font-size: 1.1rem; }
:deep(h3) { font-size: 1rem; }
:deep(h4) { font-size: 0.875rem; }

:deep(ul), :deep(ol) {
  margin: 0 0 0.75rem 0 !important;
  padding-left: 1.25rem !important;
}

:deep(li) {
  margin-bottom: 0.125rem !important;
}

:deep(li p) {
  margin: 0 !important;
}

:deep(code) {
  font-family: var(--font-mono, monospace);
  background: var(--canvas-subtle);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.75rem;
}

:deep(pre) {
  background: var(--canvas-inset);
  padding: 1rem;
  border-radius: var(--radius-md);
  overflow-x: auto;
  margin: 1rem 0;
  border: 1px solid var(--border-subtle);
}

:deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 0.75rem;
  color: inherit;
}

:deep(blockquote) {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border-left: 4px solid var(--border-accent);
  background: var(--canvas-subtle);
  color: var(--text-secondary);
}

:deep(a) {
  color: var(--accent-fg);
  text-decoration: none;
}

:deep(a:hover) {
  text-decoration: underline;
}

:deep(hr) {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 1.5rem 0;
}

:deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
}

:deep(th), :deep(td) {
  padding: 0.5rem;
  border: 1px solid var(--border-subtle);
  text-align: left;
}

:deep(th) {
  background: var(--canvas-subtle);
  font-weight: 600;
}
</style>
