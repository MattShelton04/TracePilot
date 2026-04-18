<script setup lang="ts">
import type { ContentTypeStyle } from "@tracepilot/ui";
import { formatDateMedium, formatRelativeTime } from "@tracepilot/ui";
import type { SessionGroup } from "@/stores/search";

defineProps<{
  groupedResults: SessionGroup[];
  collapsedGroups: Set<string>;
  expandedResults: Set<number>;
  resultIndexMap: Map<number, number>;
  focusedResultIndex: number | null;
  hasMore: boolean;
  contentTypeConfig: Record<string, ContentTypeStyle>;
  sessionLink: (sessionId: string, turnNumber: number | null, eventIndex: number | null) => string;
}>();

defineEmits<{
  "toggle-group-collapse": [sessionId: string];
  "filter-by-session": [sessionId: string, sessionSummary: string | null];
  "toggle-expand": [resultId: number];
}>();
</script>

<template>
  <div class="results-grouped">
    <div
      v-for="(group, gIdx) in groupedResults"
      :key="group.sessionId"
      class="session-group"
      :style="{ animationDelay: `${Math.min(gIdx, 6) * 40}ms` }"
    >
      <div class="session-group-header" @click="$emit('toggle-group-collapse', group.sessionId)">
        <span class="session-group-chevron" :class="{ collapsed: collapsedGroups.has(group.sessionId) }">▾</span>
        <div class="session-group-title">
          {{ group.sessionSummary || group.sessionId.slice(0, 12) + '…' }}
        </div>
        <div v-if="group.sessionRepository || group.sessionBranch" class="session-group-badges">
          <span v-if="group.sessionRepository" class="badge badge-accent" style="font-size: 0.5625rem">{{ group.sessionRepository }}</span>
          <span v-if="group.sessionBranch" class="badge badge-success" style="font-size: 0.5625rem">{{ group.sessionBranch }}</span>
        </div>
        <div class="session-group-actions">
          <span class="session-group-count">{{ group.results.length }}{{ hasMore ? '+' : '' }} match{{ group.results.length !== 1 ? 'es' : '' }}</span>
          <button
            class="session-group-filter-btn"
            title="Filter search to this session"
            @click.stop="$emit('filter-by-session', group.sessionId, group.sessionSummary)"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
              <path d="M2 4h12M4 8h8M6 12h4" />
            </svg>
          </button>
          <router-link
            :to="`/session/${group.sessionId}/conversation`"
            class="session-group-goto-btn"
            title="Go to session"
            @click.stop
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </router-link>
        </div>
      </div>
      <div v-if="!collapsedGroups.has(group.sessionId)" class="session-group-results">
        <div
          v-for="result in group.results"
          :key="result.id"
          class="session-group-result"
          :class="{ expanded: expandedResults.has(result.id), 'result-focused': resultIndexMap.get(result.id) === focusedResultIndex }"
          :data-result-index="resultIndexMap.get(result.id)"
          @click="$emit('toggle-expand', result.id)"
        >
          <div class="session-group-result-row">
            <span
              class="ct-badge"
              :style="{
                '--ct-bg': (contentTypeConfig[result.contentType]?.color ?? '') + '20',
                '--ct-fg': contentTypeConfig[result.contentType]?.color,
              }"
            >
              {{ contentTypeConfig[result.contentType]?.label ?? result.contentType }}
            </span>
            <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
            <span class="session-group-snippet" v-html="result.snippet" />
            <span class="session-group-result-meta">
              <span v-if="result.timestampUnix != null" class="session-group-timestamp" :title="formatDateMedium(result.timestampUnix)">
                {{ formatRelativeTime(result.timestampUnix) }}
              </span>
              <span v-if="result.turnNumber != null">T{{ result.turnNumber }}</span>
              <span v-if="result.toolName" class="tool-name-badge">{{ result.toolName }}</span>
            </span>
            <router-link
              :to="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
              class="session-group-view-btn"
              @click.stop
            >→</router-link>
          </div>
          <!-- Expanded details -->
          <div v-if="expandedResults.has(result.id)" class="session-group-expanded">
            <!-- Full snippet (un-truncated) -->
            <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
            <div class="result-snippet" v-html="result.snippet" />
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
            <router-link
              :to="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
              class="expanded-view-btn"
              @click.stop
            >
              Open in Session Viewer →
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* -- Session-grouped results -- */
.results-grouped {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.session-group {
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  animation: resultFadeIn var(--transition-fast) ease both;
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.session-group-header:hover {
  background: var(--state-hover-overlay);
}

.session-group-chevron {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  transition: transform var(--transition-fast);
}

.session-group-chevron.collapsed {
  transform: rotate(-90deg);
}

.session-group-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.session-group-badges {
  display: flex;
  gap: 4px;
}

.session-group-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.session-group-count {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.session-group-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--border-muted);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.session-group-filter-btn:hover {
  color: var(--accent-fg);
  border-color: var(--accent-fg);
  background: var(--accent-subtle);
}

.session-group-goto-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
  color: var(--text-secondary);
  text-decoration: none;
  transition: all var(--transition-fast);
}

.session-group-goto-btn:hover {
  border-color: var(--success-emphasis);
  color: var(--success-fg);
  background: var(--success-subtle);
}

.session-group-results {
  display: flex;
  flex-direction: column;
}

.session-group-result {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-muted);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.session-group-result:last-child {
  border-bottom: none;
}

.session-group-result:hover {
  background: var(--canvas-subtle);
}

.session-group-result.expanded {
  background: var(--canvas-subtle);
}

.session-group-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
}

.session-group-result.expanded .session-group-snippet {
  display: none;
}

.session-group-expanded {
  padding: 0 16px 12px 36px;
}

.session-group-snippet {
  flex: 1;
  font-size: 0.75rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.session-group-snippet :deep(mark) {
  background: rgba(251, 191, 36, 0.22);
  color: var(--warning-fg);
  border-radius: 2px;
  padding: 0 2px;
}

.session-group-result-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.session-group-timestamp {
  color: var(--text-placeholder);
  font-size: 0.5625rem;
}

.session-group-view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  text-decoration: none;
  font-size: 0.75rem;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.session-group-view-btn:hover {
  color: var(--accent-fg);
  background: var(--accent-subtle);
}

.ct-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.5625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  background: var(--ct-bg);
  color: var(--ct-fg);
}

.tool-name-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font-size: 0.5625rem;
  font-family: 'JetBrains Mono', monospace;
}

.result-snippet {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin-bottom: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.result-snippet :deep(mark) {
  background: rgba(251, 191, 36, 0.22);
  color: var(--warning-fg);
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 500;
}

.expanded-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.expanded-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.expanded-label {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.expanded-value {
  font-size: 0.75rem;
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.expanded-mono {
  font-family: 'JetBrains Mono', monospace;
}
.expanded-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-fg);
  border-radius: var(--radius-sm);
  text-decoration: none;
  transition: all var(--transition-fast);
}
.expanded-view-btn:hover {
  background: var(--accent-emphasis);
  color: white;
}
</style>
