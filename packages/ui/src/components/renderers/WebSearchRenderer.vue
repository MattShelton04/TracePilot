<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { Globe, Search } from "lucide-vue-next";
import { computed } from "vue";
import { useExternalLinkHandler } from "../../composables/externalLinks";
import { mdReady, renderMarkdown } from "../../utils/markdownLoader";
import { toolCallStatus } from "../../utils/toolCallStatus";
import { parseWebSearchBody, webSearchSources } from "../../utils/webSearchResult";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import RecordedToolResponse from "./RecordedToolResponse.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();
const emit = defineEmits<{
  "load-full": [];
  "open-external": [url: string];
}>();
const externalLinkHandler = useExternalLinkHandler();
const status = computed(() => toolCallStatus(props.tc));
const query = computed(() => (typeof props.args?.query === "string" ? props.args.query : ""));
const body = computed(() => parseWebSearchBody(props.content));
const sources = computed(() =>
  webSearchSources(
    mdReady.value && body.value.recognized ? renderMarkdown(body.value.text) : "",
    body.value.citations,
  ),
);

function openSource(url: string) {
  if (externalLinkHandler) void externalLinkHandler(url);
  else emit("open-external", url);
}
</script>

<template>
  <RendererShell tool-name="Web Search" :status="status" :copy-text="content">
    <template #icon><Globe :size="16" /></template>
    <div class="web-search">
      <div v-if="query" class="ws-query-bar">
        <Search :size="14" class="ws-query-icon" aria-hidden="true" />
        <span class="ws-query-text">{{ query }}</span>
      </div>

      <RendererScrollRegion label="search response" :max-height="400" :key="`body-${tc?.toolCallId}`">
        <MarkdownContent v-if="body.text && body.recognized" class="ws-body" :content="body.text" :render="true" @open-external="emit('open-external', $event)" />
        <pre v-else-if="body.text" class="ws-body ws-raw-body">{{ body.text }}</pre>
        <p v-else class="ws-empty">{{ status === 'pending' ? 'Searching…' : status === 'error' ? 'The search returned no output.' : 'No search response returned.' }}</p>
      </RendererScrollRegion>

      <div v-if="sources.length" class="ws-sources">
        <div class="ws-sources-label">Linked sources <span>{{ sources.length }}</span></div>
        <RendererScrollRegion label="sources" :max-height="240" :key="`sources-${tc?.toolCallId}`">
          <div class="ws-source-grid">
            <a v-for="source in sources" :key="source.url" :href="source.url" :title="source.url" class="ws-source-card" @click.prevent="openSource(source.url)">
              <Globe :size="16" class="ws-source-icon" aria-hidden="true" />
              <span class="ws-source-info">
                <span class="ws-source-title">{{ source.title }}</span>
                <span class="ws-source-domain">{{ source.domain }}</span>
              </span>
            </a>
          </div>
        </RendererScrollRegion>
      </div>
      <div v-if="body.structured && body.recognized" class="ws-raw-response">
        <RecordedToolResponse :content="content" />
      </div>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.web-search { min-width: 0; font-size: 13px; }
.ws-query-bar { display: flex; align-items: flex-start; gap: 8px; padding: 12px; background: var(--canvas-inset); border-bottom: 1px solid var(--border-muted); }
.ws-query-icon { flex-shrink: 0; margin-top: 3px; color: var(--text-tertiary); }
.ws-query-text { min-width: 0; font-weight: 600; color: var(--text-primary); line-height: 1.6; overflow-wrap: anywhere; }
.ws-body { padding: 12px; line-height: 1.7; color: var(--text-secondary); font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.ws-body :deep(p:first-child), .ws-body :deep(h1:first-child), .ws-body :deep(h2:first-child), .ws-body :deep(h3:first-child), .ws-body :deep(h4:first-child), .ws-body :deep(h5:first-child), .ws-body :deep(h6:first-child) { margin-top: 0 !important; }
.ws-body :deep(p:last-child) { margin-bottom: 0; }
.ws-body :deep(pre) { max-width: 100%; overflow: auto; }
.ws-body :deep(table) { display: block; max-width: 100%; overflow: auto; }
.ws-body :deep(a) { overflow-wrap: anywhere; }
.ws-raw-body { margin: 0; white-space: pre-wrap; font-family: var(--font-mono, monospace); }
.ws-empty { margin: 0; padding: 12px; color: var(--text-tertiary); }
.ws-sources { border-top: 1px solid var(--border-muted); padding: 12px; }
.ws-sources-label { display: flex; gap: 8px; color: var(--text-tertiary); font-size: 12px; font-weight: 600; margin-bottom: 8px; }
.ws-sources-label span { font-weight: 400; font-variant-numeric: tabular-nums; }
.ws-source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 8px; }
.ws-source-card { display: flex; align-items: flex-start; gap: 8px; padding: 12px; min-width: 0; border: 1px solid var(--border-muted); border-radius: var(--radius-sm); text-decoration: none; color: inherit; background: var(--canvas-inset); }
.ws-source-card:hover { border-color: var(--accent-emphasis); background: var(--neutral-muted); }
.ws-source-card:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: -2px; }
.ws-source-icon { color: var(--accent-fg); flex-shrink: 0; margin-top: 2px; }
.ws-source-info { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
.ws-source-title { font-size: 13px; line-height: 1.5; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
.ws-source-domain { font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; }
.ws-raw-response { padding: 8px 12px; border-top: 1px solid var(--border-muted); }
</style>
