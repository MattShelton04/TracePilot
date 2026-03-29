<script setup lang="ts">
import { useSearchStore } from '@/stores/search';

const store = useSearchStore();
</script>

<template>
  <div class="browse-presets">
    <div class="browse-title">Browse your sessions</div>
    <div class="browse-subtitle">
      Use filters or try a quick preset to explore your session content.
    </div>
    <div class="browse-preset-grid">
      <button class="browse-preset-btn browse-preset-errors" @click="store.browseErrors()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <circle cx="8" cy="8" r="6" /><line x1="8" y1="5" x2="8" y2="9" /><circle cx="8" cy="11" r="0.5" fill="currentColor" />
        </svg>
        <span class="preset-label">All Errors</span>
        <span class="preset-desc">Errors &amp; tool failures</span>
      </button>
      <button class="browse-preset-btn browse-preset-user" @click="store.browseUserMessages()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        </svg>
        <span class="preset-label">User Messages</span>
        <span class="preset-desc">Your prompts &amp; requests</span>
      </button>
      <button class="browse-preset-btn browse-preset-tools" @click="store.browseToolCalls()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <path d="M4 2v12M12 2v12M2 6h12M2 10h12" />
        </svg>
        <span class="preset-label">Tool Calls</span>
        <span class="preset-desc">All tool invocations</span>
      </button>
      <button class="browse-preset-btn browse-preset-reasoning" @click="store.browseReasoning()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <circle cx="8" cy="8" r="6" /><path d="M6 6a2 2 0 1 1 2 2v1.5" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
        </svg>
        <span class="preset-label">Reasoning</span>
        <span class="preset-desc">AI thinking &amp; analysis</span>
      </button>
      <button class="browse-preset-btn browse-preset-results" @click="store.browseToolResults()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <rect x="2" y="2" width="12" height="12" rx="2" /><polyline points="5 8 7 10 11 6" />
        </svg>
        <span class="preset-label">Tool Results</span>
        <span class="preset-desc">Command outputs &amp; file contents</span>
      </button>
      <button class="browse-preset-btn browse-preset-subagents" @click="store.browseSubagents()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <circle cx="5" cy="5" r="3" /><circle cx="11" cy="11" r="3" /><line x1="7" y1="7" x2="9" y2="9" />
        </svg>
        <span class="preset-label">Sub-agents</span>
        <span class="preset-desc">Spawned agent activity</span>
      </button>
    </div>

    <!-- Recent Searches -->
    <div v-if="store.recentSearches.length > 0" class="recent-searches">
      <div class="recent-searches-header">
        <span class="recent-searches-title">Recent searches</span>
        <button class="recent-searches-clear" @click="store.clearRecentSearches()">Clear</button>
      </div>
      <div class="recent-searches-list">
        <button
          v-for="recent in store.recentSearches"
          :key="recent.query"
          class="recent-search-item"
          @click="store.applyRecentSearch(recent.query)"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
            <circle cx="7" cy="7" r="5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <span class="recent-query">{{ recent.query }}</span>
          <span class="recent-count">{{ recent.resultCount }} result{{ recent.resultCount !== 1 ? 's' : '' }}</span>
          <span
            role="button"
            tabindex="0"
            class="recent-remove"
            @click.stop="store.removeRecentSearch(recent.query)"
            @keydown.enter.stop="store.removeRecentSearch(recent.query)"
            title="Remove"
          >✕</span>
        </button>
      </div>
    </div>

    <div v-if="store.stats" class="empty-stats">
      <span class="empty-stat">
        <strong>{{ store.stats.totalSessions.toLocaleString() }}</strong> sessions indexed
      </span>
      <span class="empty-stat-sep">·</span>
      <span class="empty-stat">
        <strong>{{ store.stats.totalRows.toLocaleString() }}</strong> content rows
      </span>
    </div>
  </div>
</template>

<style scoped>
.browse-presets {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px 24px;
  text-align: center;
}
.browse-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.browse-subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  max-width: 460px;
  line-height: 1.5;
  margin-bottom: 24px;
}
.browse-preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  max-width: 520px;
  width: 100%;
  margin-bottom: 24px;
}
.browse-preset-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  text-align: center;
}
.browse-preset-btn:hover {
  border-color: var(--border-accent);
  background: var(--canvas-overlay);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.browse-preset-errors { color: #ef4444; }
.browse-preset-errors:hover { border-color: #ef4444; }
.browse-preset-user { color: #4ade80; }
.browse-preset-user:hover { border-color: #4ade80; }
.browse-preset-tools { color: #f59e0b; }
.browse-preset-tools:hover { border-color: #f59e0b; }
.browse-preset-reasoning { --preset-accent: #a78bfa; color: #a78bfa; }
.browse-preset-reasoning:hover { border-color: #a78bfa; }
.browse-preset-results { --preset-accent: #fb923c; color: #fb923c; }
.browse-preset-results:hover { border-color: #fb923c; }
.browse-preset-subagents { --preset-accent: #38bdf8; color: #38bdf8; }
.browse-preset-subagents:hover { border-color: #38bdf8; }
.preset-label {
  font-weight: 600;
  font-size: 0.8125rem;
  color: var(--text-primary);
}
.preset-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* ── Empty stats ─────────────────────────────────────────── */
.empty-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.empty-stat strong {
  color: var(--accent-fg);
}
.empty-stat-sep {
  opacity: 0.3;
}

/* ── Recent searches ─────────────────────────────────────── */
.recent-searches {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
  width: 100%;
  max-width: 520px;
}
.recent-searches-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.recent-searches-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.recent-searches-clear {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.recent-searches-clear:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}
.recent-searches-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recent-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}
.recent-search-item:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}
.recent-search-item svg {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.recent-query {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-count {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.recent-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0 4px;
  font-size: 0.75rem;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.recent-search-item:hover .recent-remove {
  opacity: 1;
}
.recent-remove:hover {
  color: var(--danger-fg);
}
</style>
