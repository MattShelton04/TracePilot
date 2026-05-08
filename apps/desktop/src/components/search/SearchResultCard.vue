<script setup lang="ts">
import type { ContextSnippet } from "@tracepilot/client";
import { getResultContext } from "@tracepilot/client";
import type { SearchResult } from "@tracepilot/types";
import { CONTENT_TYPE_CONFIG, formatDateMedium, formatRelativeTime } from "@tracepilot/ui";
import { ref, watch } from "vue";
import SearchResultActions from "./SearchResultActions.vue";
import SearchResultExpandedDetails from "./SearchResultExpandedDetails.vue";
import SearchResultMeta from "./SearchResultMeta.vue";

const props = defineProps<{
  result: SearchResult;
  index: number;
  expanded: boolean;
  focused: boolean;
  sessionLink: string;
  /** Optional: total events in the session (for timeline position indicator) */
  sessionEventCount?: number;
}>();

defineEmits<{
  toggle: [];
  copy: [];
}>();

const ctConfig = CONTENT_TYPE_CONFIG;

function ctLookup(type: string) {
  return ctConfig[type as keyof typeof ctConfig];
}

// Contextual snippets: load lazily when expanded
const contextBefore = ref<ContextSnippet[]>([]);
const contextAfter = ref<ContextSnippet[]>([]);
const contextLoaded = ref(false);

watch(
  () => props.expanded,
  async (isExpanded) => {
    if (isExpanded && !contextLoaded.value) {
      try {
        const [before, after] = await getResultContext(props.result.id, 2);
        contextBefore.value = before;
        contextAfter.value = after;
        contextLoaded.value = true;
      } catch {
        // Allow retry on next expand — don't latch contextLoaded on failure
      }
    }
  },
);
</script>

<template>
  <div
    class="result-card"
    :class="{ expanded, 'result-focused': focused }"
    :data-result-index="index"
    :style="{ animationDelay: `${Math.min(index, 8) * 30}ms` }"
    @click="$emit('toggle')"
  >
    <div class="result-header">
      <span v-if="result.sessionRepository" class="badge badge-accent badge-xs">
        {{ result.sessionRepository }}
      </span>
      <span v-if="result.sessionBranch" class="badge badge-success badge-xs">
        {{ result.sessionBranch }}
      </span>
      <span v-if="result.timestampUnix != null" class="result-date" :title="formatDateMedium(result.timestampUnix)">
        {{ formatRelativeTime(result.timestampUnix) }}
      </span>
      <span
        class="ct-badge ct-badge--trailing"
        :style="{
          '--ct-bg': (ctConfig[result.contentType]?.color ?? '') + '20',
          '--ct-fg': ctConfig[result.contentType]?.color,
        }"
      >
        {{ ctConfig[result.contentType]?.label ?? result.contentType }}
      </span>
    </div>

    <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
    <div class="result-snippet" v-html="result.snippet" />

    <SearchResultMeta :result="result" :session-event-count="sessionEventCount">
      <template #trailing>
        <SearchResultActions :session-link="sessionLink" @copy="$emit('copy')" />
      </template>
    </SearchResultMeta>

    <!-- Expanded Details -->
    <div v-if="expanded" class="result-expanded">
      <!-- Contextual snippets: surrounding turns -->
      <div v-if="contextBefore.length > 0 || contextAfter.length > 0" class="context-strip">
        <div v-for="(ctx, ci) in contextBefore" :key="'b' + ci" class="context-item context-before">
          <span
            class="context-type-dot"
            :style="{ '--dot-color': ctLookup(ctx.contentType)?.color }"
          />
          <span class="context-label">{{ ctLookup(ctx.contentType)?.label ?? ctx.contentType }}</span>
          <span v-if="ctx.toolName" class="context-tool">{{ ctx.toolName }}</span>
          <span class="context-preview">{{ ctx.preview }}</span>
        </div>
        <div class="context-item context-current">
          <span class="context-type-dot" :style="{ '--dot-color': ctConfig[result.contentType]?.color }" />
          <span class="context-label context-label--current">▸ Current match</span>
        </div>
        <div v-for="(ctx, ci) in contextAfter" :key="'a' + ci" class="context-item context-after">
          <span
            class="context-type-dot"
            :style="{ '--dot-color': ctLookup(ctx.contentType)?.color }"
          />
          <span class="context-label">{{ ctLookup(ctx.contentType)?.label ?? ctx.contentType }}</span>
          <span v-if="ctx.toolName" class="context-tool">{{ ctx.toolName }}</span>
          <span class="context-preview">{{ ctx.preview }}</span>
        </div>
      </div>

      <SearchResultExpandedDetails :result="result" :session-link="sessionLink" variant="card" />
    </div>
  </div>
</template>

<style scoped>
.result-card {
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  cursor: pointer;
  transition: all var(--transition-normal);
  animation: fadeSlideIn 0.25s ease both;
}
.result-card:hover {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-md), 0 0 0 1px var(--border-glow);
}
.result-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.result-date {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.ct-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
  background: var(--ct-bg);
  color: var(--ct-fg);
}
.ct-badge--trailing {
  margin-left: auto;
}
.badge-xs {
  font-size: 0.625rem;
}
.context-label--current {
  font-weight: 600;
}
.result-snippet {
  font-size: 0.8125rem;
  line-height: 1.65;
  color: var(--text-secondary);
  margin-bottom: 10px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.result-snippet :deep(mark) {
  background: var(--color-search-mark-highlight-bg);
  color: var(--warning-fg);
  border-radius: 2px;
  padding: 0 2px;
}
.result-snippet :deep(code) {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.75rem;
  background: var(--neutral-subtle);
  padding: 1px 4px;
  border-radius: 3px;
}
.result-card.expanded .result-snippet {
  -webkit-line-clamp: unset;
  display: block;
}

/* ── Expanded details ────────────────────────────────────── */
.result-expanded {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
  animation: fadeSlideIn 0.2s ease both;
}

/* ── Focus indicator ─────────────────────────────────────── */
.result-focused {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}

/* ── Contextual snippets (surrounding turns) ─────────────── */
.context-strip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.6875rem;
}
.context-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  min-height: 20px;
}
.context-before, .context-after {
  opacity: 0.6;
}
.context-current {
  opacity: 1;
  background: var(--accent-subtle);
  margin: 2px -6px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.context-type-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--dot-color, var(--text-tertiary));
}
.context-label {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
  min-width: 80px;
}
.context-tool {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.5625rem;
  background: var(--neutral-subtle);
  padding: 0 4px;
  border-radius: 2px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.context-preview {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
