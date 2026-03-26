<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { SearchResult } from '@tracepilot/types';
import type { ContextSnippet } from '@tracepilot/client';
import { getResultContext } from '@tracepilot/client';
import { CONTENT_TYPE_CONFIG, formatRelativeTime, formatDateMedium } from '@tracepilot/ui';

const props = defineProps<{
  result: SearchResult;
  index: number;
  expanded: boolean;
  focused: boolean;
  sessionLink: string;
  /** Optional: total events in the session (for timeline position indicator) */
  sessionEventCount?: number;
}>();

const emit = defineEmits<{
  toggle: [];
  copy: [];
}>();

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function handleCopy() {
  emit('copy');
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 1500);
}

const ctConfig = CONTENT_TYPE_CONFIG;

function ctLookup(type: string) {
  return ctConfig[type as keyof typeof ctConfig];
}

// Timeline position: what fraction through the session is this result?
const timelinePosition = computed(() => {
  if (props.result.eventIndex == null || !props.sessionEventCount || props.sessionEventCount < 2) return null;
  return Math.min(1, Math.max(0, props.result.eventIndex / props.sessionEventCount));
});

// Contextual snippets: load lazily when expanded
const contextBefore = ref<ContextSnippet[]>([]);
const contextAfter = ref<ContextSnippet[]>([]);
const contextLoaded = ref(false);

watch(() => props.expanded, async (isExpanded) => {
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
});
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
      <span v-if="result.sessionRepository" class="badge badge-accent" style="font-size: 0.625rem">
        {{ result.sessionRepository }}
      </span>
      <span v-if="result.sessionBranch" class="badge badge-success" style="font-size: 0.625rem">
        {{ result.sessionBranch }}
      </span>
      <span v-if="result.timestampUnix != null" class="result-date" :title="formatDateMedium(result.timestampUnix)">
        {{ formatRelativeTime(result.timestampUnix) }}
      </span>
      <span
        class="ct-badge"
        :style="{
          background: ctConfig[result.contentType]?.color + '20',
          color: ctConfig[result.contentType]?.color,
        }"
        style="margin-left: auto"
      >
        {{ ctConfig[result.contentType]?.label ?? result.contentType }}
      </span>
    </div>

    <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
    <div class="result-snippet" v-html="result.snippet" />

    <div class="result-meta">
      <span v-if="result.sessionSummary" class="result-session-summary" :title="result.sessionSummary">
        {{ result.sessionSummary.length > 50 ? result.sessionSummary.slice(0, 50) + '…' : result.sessionSummary }}
      </span>
      <span v-if="result.sessionSummary" class="result-meta-sep">·</span>
      <span v-if="result.turnNumber != null">Turn {{ result.turnNumber }}</span>
      <span v-if="result.turnNumber != null" class="result-meta-sep">·</span>
      <span>{{ result.contentType.replace(/_/g, ' ') }}</span>
      <template v-if="result.toolName">
        <span class="result-meta-sep">·</span>
        <span class="tool-name-badge">{{ result.toolName }}</span>
      </template>
      <!-- Timeline position indicator -->
      <span v-if="timelinePosition != null" class="timeline-spark" :title="`${Math.round(timelinePosition * 100)}% through session`">
        <span class="timeline-spark-track">
          <span class="timeline-spark-dot" :style="{ left: `${timelinePosition * 100}%` }" />
        </span>
      </span>
      <router-link :to="sessionLink" class="result-view-btn" @click.stop>
        View in session
      </router-link>
      <button
        class="result-copy-btn"
        :class="{ 'result-copy-btn--copied': copied }"
        :title="copied ? 'Copied!' : 'Copy content'"
        @click.stop="handleCopy"
      >
        <svg v-if="!copied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
          <rect x="5" y="5" width="9" height="9" rx="1" /><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
        </svg>
        <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
          <polyline points="3 8 6.5 11.5 13 5" />
        </svg>
      </button>
    </div>

    <!-- Expanded Details -->
    <div v-if="expanded" class="result-expanded">
      <!-- Contextual snippets: surrounding turns -->
      <div v-if="contextBefore.length > 0 || contextAfter.length > 0" class="context-strip">
        <div v-for="(ctx, ci) in contextBefore" :key="'b' + ci" class="context-item context-before">
          <span
            class="context-type-dot"
            :style="{ background: ctLookup(ctx.contentType)?.color ?? '#888' }"
          />
          <span class="context-label">{{ ctLookup(ctx.contentType)?.label ?? ctx.contentType }}</span>
          <span v-if="ctx.toolName" class="context-tool">{{ ctx.toolName }}</span>
          <span class="context-preview">{{ ctx.preview }}</span>
        </div>
        <div class="context-item context-current">
          <span class="context-type-dot" :style="{ background: ctConfig[result.contentType]?.color ?? '#888' }" />
          <span class="context-label" style="font-weight: 600">▸ Current match</span>
        </div>
        <div v-for="(ctx, ci) in contextAfter" :key="'a' + ci" class="context-item context-after">
          <span
            class="context-type-dot"
            :style="{ background: ctLookup(ctx.contentType)?.color ?? '#888' }"
          />
          <span class="context-label">{{ ctLookup(ctx.contentType)?.label ?? ctx.contentType }}</span>
          <span v-if="ctx.toolName" class="context-tool">{{ ctx.toolName }}</span>
          <span class="context-preview">{{ ctx.preview }}</span>
        </div>
      </div>

      <div class="expanded-grid">
        <div v-if="result.sessionSummary" class="expanded-item">
          <span class="expanded-label">Session</span>
          <span class="expanded-value">{{ result.sessionSummary }}</span>
        </div>
        <div class="expanded-item">
          <span class="expanded-label">Session ID</span>
          <span class="expanded-value expanded-mono">{{ result.sessionId }}</span>
        </div>
        <div v-if="result.turnNumber != null" class="expanded-item">
          <span class="expanded-label">Turn</span>
          <span class="expanded-value">{{ result.turnNumber }}</span>
        </div>
        <div v-if="result.toolName" class="expanded-item">
          <span class="expanded-label">Tool</span>
          <span class="expanded-value expanded-mono">{{ result.toolName }}</span>
        </div>
        <div v-if="result.eventIndex != null" class="expanded-item">
          <span class="expanded-label">Event Index</span>
          <span class="expanded-value">{{ result.eventIndex }}</span>
        </div>
        <div v-if="result.timestampUnix != null" class="expanded-item">
          <span class="expanded-label">Timestamp</span>
          <span class="expanded-value">{{ formatDateMedium(result.timestampUnix) }}</span>
        </div>
      </div>
      <router-link :to="sessionLink" class="expanded-view-btn" @click.stop>
        Open in Session Viewer →
      </router-link>
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
  background: rgba(251, 191, 36, 0.22);
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
.result-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.result-meta-sep { opacity: 0.3; }
.result-session-summary {
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.tool-name-badge {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.625rem;
  background: var(--neutral-subtle);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.result-view-btn {
  margin-left: auto;
  color: var(--accent-fg);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.6875rem;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-emphasis);
  transition: all var(--transition-fast);
  white-space: nowrap;
  flex-shrink: 0;
}
.result-view-btn:hover {
  background: var(--accent-emphasis);
  color: #fff;
}
.result-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.675rem;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.result-copy-btn:hover {
  color: var(--accent-fg);
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
}
.result-copy-btn--copied {
  color: var(--success-fg, #22c55e);
  border-color: var(--success-fg, #22c55e);
  background: rgba(34, 197, 94, 0.08);
}

/* ── Expanded details ────────────────────────────────────── */
.result-expanded {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
  animation: fadeSlideIn 0.2s ease both;
}
.expanded-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin-bottom: 12px;
}
.expanded-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.expanded-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.expanded-value {
  font-size: 0.75rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expanded-mono {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.6875rem;
}
.expanded-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  color: var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 500;
  text-decoration: none;
  font-family: inherit;
  transition: all var(--transition-fast);
}
.expanded-view-btn:hover {
  background: var(--accent-muted);
}

/* ── Focus indicator ─────────────────────────────────────── */
.result-focused {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}

/* ── Timeline position indicator ──────────────────────────── */
.timeline-spark {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
}
.timeline-spark-track {
  position: relative;
  width: 40px;
  height: 4px;
  background: var(--neutral-subtle);
  border-radius: 2px;
}
.timeline-spark-dot {
  position: absolute;
  top: -1px;
  width: 6px;
  height: 6px;
  background: var(--accent-fg);
  border-radius: 50%;
  transform: translateX(-50%);
  transition: left var(--transition-fast);
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
